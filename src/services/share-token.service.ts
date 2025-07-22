// services/share-token.service.ts

import { ServiceResponse } from "types/service.types";
import mongoose from "mongoose";
import * as crypto from 'crypto';
import { Event } from "@models/event.model";
import { ActivityLog } from "@models/activity-log.model";
import { logger } from "@utils/logger";
import { MODEL_NAMES } from "@models/names";

// ============= UTILITY FUNCTIONS =============

const generateTimeSeriesData = (participants: any[], startDate: Date, endDate: Date) => {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const timeSeries = [];

    for (let i = 0; i < days; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);

        const dayParticipants = participants.filter(p => {
            const joinDate = p.participation.joined_at || p.created_at;
            return joinDate >= date && joinDate < nextDate;
        });

        timeSeries.push({
            date: date.toISOString().split('T')[0],
            joins: dayParticipants.length,
            active_joins: dayParticipants.filter(p => p.participation.status === 'active').length
        });
    }

    return timeSeries;
};

export const getEventSharingStatusService = async (
    eventId: string,
    userId: string
): Promise<ServiceResponse<any>> => {
    return null
};

// ============= TOKEN VALIDATION HELPERS =============


export const generateShareableLink = (token: string): string => {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `${baseUrl}/join/${token}`;
};


export const getShareTokenDetailsService = async (data: {
    tokenId: string;
    requesterId?: string;
}): Promise<ServiceResponse<any>> => {
    try {
        const { tokenId, requesterId } = data;

        // Find event by share_token
        const event = await Event.findOne({ share_token: tokenId }).populate([
            {
                path: 'created_by',
                select: 'name email avatar_url',
            },
            {
                path: 'co_hosts.user_id',
                select: 'name email avatar_url',
            },
        ]);

        if (!event) {
            logger.warn(`[getShareTokenDetailsService] Share token ${tokenId} not found`);
            return {
                status: false,
                code: 404,
                message: 'Share token not found',
                data: null,
                error: { message: 'Token not found' },
                other: null,
            };
        }

        // Check share_settings
        if (!event.share_settings.is_active) {
            logger.warn(`[getShareTokenDetailsService] Share token ${tokenId} is inactive`);
            return {
                status: false,
                code: 403,
                message: 'Share token is inactive',
                data: null,
                error: { message: 'Token is inactive' },
                other: null,
            };
        }

        if (event.share_settings.expires_at && new Date(event.share_settings.expires_at) < new Date()) {
            logger.warn(`[getShareTokenDetailsService] Share token ${tokenId} has expired`);
            return {
                status: false,
                code: 403,
                message: 'Share token has expired',
                data: null,
                error: { message: 'Token has expired' },
                other: null,
            };
        }

        // Check permissions
        if (!event.permissions.can_view) {
            logger.warn(`[getShareTokenDetailsService] Viewing not allowed for event ${event._id}`);
            return {
                status: false,
                code: 403,
                message: 'Viewing this event is not allowed',
                data: null,
                error: { message: 'Viewing not permitted' },
                other: null,
            };
        }

        // Prepare event details
        const eventDetails = {
            _id: event._id.toString(),
            title: event.title,
            description: event.description,
            start_date: event.start_date.toISOString(),
            end_date: event.end_date ? event.end_date.toISOString() : undefined,
            template: event.template,
            visibility: event.visibility,
            cover_image: event.cover_image.url ? { url: event.cover_image.url } : undefined,
            location: event.location.name ? { name: event.location.name } : undefined,
            permissions: {
                can_view: event.permissions.can_view,
                can_upload: event.permissions.can_upload,
                can_download: event.permissions.can_download,
                require_approval: event.permissions.require_approval,
            },
            created_by: {
                _id: event.created_by._id.toString(),
            },
            stats: {
                participants: 0,
            },
            share_settings: {
                is_active: event.share_settings.is_active,
                expires_at: event.share_settings.expires_at ? event.share_settings.expires_at.toISOString() : undefined,
            },
        };

        // Set FRONTEND_URL or fallback
        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

        return {
            status: true,
            code: 200,
            message: 'Share token details retrieved successfully',
            data: {
                event: eventDetails,
                invitation_link: `${FRONTEND_URL}/join/${event.share_token}`,
            },
            error: null,
            other: null,
        };
    } catch (error) {
        logger.error(`[getShareTokenDetailsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: 'Failed to get share token details',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            },
            other: null,
        };
    }
};

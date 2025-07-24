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


export const validateShareToken = async (shareToken: string): Promise<{
    valid: boolean;
    reason?: string;
    event_id?: string;
    permissions?: any;
    shareToken?: any;
}> => {
    try {
        // Find event by share_token (reusing your existing logic)
        const event = await Event.findOne({ share_token: shareToken }).populate([
            {
                path: 'created_by',
                select: 'name email avatar_url',
            }
        ]);

        if (!event) {
            return { valid: false, reason: "Share token not found" };
        }

        // Check if share_settings is active
        if (!event.share_settings?.is_active) {
            return { valid: false, reason: "Share token is inactive" };
        }

        // Check expiration
        if (event.share_settings.expires_at && new Date(event.share_settings.expires_at) < new Date()) {
            return { valid: false, reason: "Share token has expired" };
        }

        // Check if viewing is allowed
        if (!event.permissions?.can_view) {
            return { valid: false, reason: "Viewing this event is not allowed" };
        }

        return {
            valid: true,
            event_id: event._id.toString(),
            permissions: {
                view: event.permissions.can_view,
                upload: event.permissions.can_upload,
                download: event.permissions.can_download,
                moderate: false, // Guests can't moderate
                delete: false,   // Guests can't delete
                requireApproval: event.permissions.require_approval
            },
            shareToken: {
                token: shareToken,
                event_id: event._id,
                permissions: event.permissions,
                share_settings: event.share_settings
            }
        };
    } catch (error) {
        console.error('validateShareToken error:', error);
        return { valid: false, reason: "Token validation error" };
    }
};

export const validateGuestShareToken = async (
    shareToken: string,
    userEmail?: string,
    authToken?: string
): Promise<{
    valid: boolean;
    reason?: string;
    event_id?: string;
    permissions?: any;
    eventData?: any;
    requiresAuth?: boolean;
    visibility?: string;
}> => {
    try {
        // Find event by share_token
        const event = await Event.findOne({ share_token: shareToken }).populate([
            {
                path: 'created_by',
                select: 'name email avatar_url',
            },
            {
                path: 'co_hosts.user_id',
                select: 'name email avatar_url',
            }
        ]);

        if (!event) {
            return { valid: false, reason: "Share token not found" };
        }

        // Check if share_settings is active
        if (!event.share_settings?.is_active) {
            return { valid: false, reason: "Share token is inactive" };
        }

        // Check expiration
        if (event.share_settings.expires_at && new Date(event.share_settings.expires_at) < new Date()) {
            return { valid: false, reason: "Share token has expired" };
        }

        const visibility = event?.visibility || event.visibility;

        // Handle different visibility levels
        switch (visibility) {
            case 'private':
                // Private events should not be accessible via share token for guests
                // Only owners/co-hosts should access via /events/[eventid]
                return {
                    valid: false,
                    reason: "This is a private event. Please use the direct event link if you're an owner or co-host."
                };

            case 'invited_only':
                // Invite-only requires authentication
                if (!authToken || !userEmail) {
                    return {
                        valid: false,
                        reason: "This event requires you to log in to access.",
                        requiresAuth: true,
                        visibility
                    };
                }

                // Check if user is invited
                const isInvited = await checkIfUserIsInvited(event._id.toString(), userEmail);
                if (!isInvited) {
                    return {
                        valid: false,
                        reason: "You are not invited to this event. Please contact the event host for access."
                    };
                }
                break;

            case 'anyone_with_link':
            default:
                // Anyone with link can access without authentication
                break;
        }

        // Set guest permissions
        const permissions = {
            view: event.permissions?.can_view ?? true,
            upload: event.permissions?.can_upload ?? false,
            download: event.permissions?.can_download ?? true,
            moderate: false, // Guests can't moderate
            delete: false,   // Guests can't delete
            requireApproval: event.permissions?.require_approval ?? false
        };

        return {
            valid: true,
            event_id: event._id.toString(),
            permissions,
            visibility,
            eventData: {
                _id: event._id.toString(),
                title: event.title,
                description: event.description,
                cover_image: event.cover_image,
                location: event.location,
                start_date: event.start_date,
                end_date: event.end_date,
                template: event.template,
                permissions: event.permissions,
                share_settings: event.share_settings,
                created_by: event.created_by
            }
        };
    } catch (error) {
        console.error('validateGuestShareToken error:', error);
        return { valid: false, reason: "Token validation error" };
    }
};

const checkIfUserIsInvited = async (eventId: string, userEmail: string): Promise<boolean> => {
    try {
        // Check in EventParticipant model
        // const participant = await EventParticipant.findOne({
        //     event_id: new mongoose.Types.ObjectId(eventId),
        //     'identity.email': userEmail.toLowerCase(),
        //     'participation.status': { $in: ['active', 'pending', 'invited'] }
        // });
        
        // if (participant) return true;

        // Also check in invited_guests array if you have one in Event model
        // const event = await Event.findById(eventId);
        // if (event?.invited_guests && Array.isArray(event.invited_guests)) {
        //     return event.invited_guests.some(
        //         guest => guest.email?.toLowerCase() === userEmail.toLowerCase()
        //     );
        // }

        return false;
    } catch (error) {
        console.error('Error checking invitation status:', error);
        return false;
    }
};

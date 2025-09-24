// ====================================
// 5. services/event/access/share-token.service.ts - MAIN SERVICE
// ====================================

import mongoose from "mongoose";
import { Event } from "@models/event.model";
import { logger } from "@utils/logger";

// Import our modular services
import { shareValidationService } from './share-validation.service';
import { accessControlService } from './access-control.service';
import { eventResponseService } from './event-response.service';

import type { ShareTokenValidation } from './access.types';

export class ShareTokenService {
    /**
     * 🚀 MAIN: Get share token details with full access control
     */
    async getShareTokenDetails({
        tokenId,
        requesterId,
    }: {
        tokenId: string;
        requesterId?: string;
    }) {
        try {
            // Find event by share_token - only select necessary fields
            const event = await Event.findOne({ 
                share_token: tokenId 
            })
            .select('_id title description start_date location cover_image visibility share_settings permissions created_by co_hosts')
            .lean();

            if (!event) {
                return {
                    status: false,
                    code: 404,
                    message: 'Share token not found',
                    data: null,
                    error: { message: 'Invalid share token' },
                    other: null,
                };
            }

            // Validate share settings
            const validationError = shareValidationService.validateShareSettings(event.share_settings);
            if (validationError) {
                return validationError;
            }

            // Determine user access level
            const userAccess = accessControlService.determineUserAccess(event, requesterId);

            // Build clean response based on access level
            const eventResponse = eventResponseService.buildEventResponse(event, userAccess);

            return {
                status: true,
                code: 200,
                message: 'Event details retrieved successfully',
                data: {
                    event: eventResponse,
                    access: {
                        canJoin: userAccess.canJoin,
                        requiresAuth: userAccess.requiresAuth,
                        role: userAccess.role
                    }
                },
                error: null,
                other: null,
            };

        } catch (error: any) {
            logger.error(`[getShareTokenDetails] Error: ${error.message}`);
            return {
                status: false,
                code: 500,
                message: 'Failed to retrieve event details',
                data: null as any,
                error: { message: error.message },
                other: null as any,
            };
        }
    }

    /**
     * 🔒 GUEST: Validate guest access to event via share token
     */
    async validateGuestShareToken(
        shareToken: string,
        userEmail?: string,
        authToken?: string
    ): Promise<ShareTokenValidation> {
        try {
            // Find event with populated data
            const event = await Event.findOne({ share_token: shareToken })
                .populate([
                    {
                        path: 'created_by',
                        select: 'name email avatar_url',
                    },
                    {
                        path: 'co_hosts.user_id',
                        select: 'name email avatar_url',
                    }
                ])
                .lean();

            if (!event) {
                return { valid: false, reason: "Share token not found" };
            }

            // Validate share settings
            const validationError = shareValidationService.validateShareSettings(event.share_settings);
            if (validationError) {
                return { valid: false, reason: validationError.message };
            }

            const visibility = event.visibility;

            // Check visibility access
            const accessCheck = shareValidationService.checkVisibilityAccess(
                visibility, 
                authToken, 
                userEmail
            );
            
            if (!accessCheck.valid) {
                return {
                    valid: false,
                    reason: accessCheck.reason,
                    requiresAuth: accessCheck.requiresAuth,
                    visibility
                };
            }

            // Get guest permissions
            const userAccess = accessControlService.determineUserAccess(event);
            const permissions = accessControlService.getEventPermissions(event, userAccess);

            return {
                valid: true,
                event_id: event._id.toString(),
                permissions,
                visibility,
                eventData: eventResponseService.buildDetailedEventData(event)
            };

        } catch (error: any) {
            logger.error('validateGuestShareToken error:', error);
            return { valid: false, reason: "Token validation error" };
        }
    }

    /**
     * 🔧 LEGACY: Simple share token validation (backwards compatibility)
     */
    async validateShareToken(shareToken: string): Promise<{
        valid: boolean;
        reason?: string;
        event_id?: string;
        permissions?: any;
        shareToken?: any;
    }> {
        try {
            const event = await Event.findOne({ share_token: shareToken })
                .populate([
                    {
                        path: 'created_by',
                        select: 'name email avatar_url',
                    }
                ])
                .lean();

            if (!event) {
                return { valid: false, reason: "Share token not found" };
            }

            const validationError = shareValidationService.validateShareSettings(event.share_settings);
            if (validationError) {
                return { valid: false, reason: validationError.message };
            }

            if (!event.permissions?.can_view) {
                return { valid: false, reason: "Viewing this event is not allowed" };
            }

            const userAccess = accessControlService.determineUserAccess(event);
            const permissions = accessControlService.getEventPermissions(event, userAccess);

            return {
                valid: true,
                event_id: event._id.toString(),
                permissions,
                shareToken: {
                    token: shareToken,
                    event_id: event._id,
                    permissions: event.permissions,
                    share_settings: event.share_settings
                }
            };
        } catch (error: any) {
            logger.error('validateShareToken error:', error);
            return { valid: false, reason: "Token validation error" };
        }
    }
}

// Singleton instance
export const shareTokenService = new ShareTokenService();
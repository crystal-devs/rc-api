// middlewares/event-access.middleware.ts
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";
import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";

// Clean role types
export type EventRole = 'creator' | 'co_host' | 'moderator' | 'guest' | 'viewer' | 'authenticated_guest';

// FIXED: Updated EventAccess interface to match actual usage
export interface EventAccess {
    eventId: string;
    role: EventRole;
    participantId?: string; // Made optional since token access won't have this
    canView: boolean;
    canUpload: boolean;
    canDownload: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canManageParticipants: boolean;
    canInviteOthers: boolean;
    canModerateContent: boolean;
    canApproveContent: boolean;
    canExportData: boolean;
    canManageSettings: boolean;
    canViewAnalytics: boolean;
    canTransferOwnership: boolean;
    // Legacy aliases
    canManageGuests: boolean;
    canManageContent: boolean;
    // Context - made optional for token access
    joinMethod?: string;
    joinedAt?: Date;
    lastActivity?: Date;
}

/**
 * Middleware to check if user has access to an event
 * Adds event access info to req.eventAccess
 */
export const eventAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        // Get event_id from params - handle different route patterns
        const event_id = req.params.event_id || req.params.eventId || req.params.id;
        const userId = req.user._id.toString();

        console.log(`🔍 [eventAccessMiddleware] Raw params:`, req.params);
        console.log(`🔍 [eventAccessMiddleware] Extracted event_id: ${event_id}`);
        console.log(`🔍 [eventAccessMiddleware] Checking access for user ${userId} to event ${event_id}`);

        // Validate event_id
        if (!event_id) {
            console.log(`❌ [eventAccessMiddleware] No event_id found in params`);
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Event ID is required",
                data: null,
                error: { message: "Missing event ID in request params" },
                other: null
            });
        }

        if (!mongoose.Types.ObjectId.isValid(event_id)) {
            console.log(`❌ [eventAccessMiddleware] Invalid ObjectId format: ${event_id}`);
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Valid event ID is required",
                data: null,
                error: { message: "Invalid ObjectId format" },
                other: null
            });
        }

        // Query the event
        console.log(`🔍 [eventAccessMiddleware] Querying database for event: ${event_id}`);
        const event = await Event.findById(event_id).lean();

        if (!event) {
            console.log(`❌ [eventAccessMiddleware] Event ${event_id} not found in database`);
            return sendResponse(res, {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: { message: "Event not found" },
                other: null
            });
        }

        console.log(`✅ [eventAccessMiddleware] Event found: ${event.title}`);
        console.log(`🔍 [eventAccessMiddleware] Event created_by: ${event.created_by.toString()}`);

        // Get user's participant record
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(event_id),
            status: 'active'
        }).lean();

        console.log(`🔍 [eventAccessMiddleware] Participant record:`, participant ? {
            role: participant.role,
            status: participant.status,
            permissions: participant.permissions
        } : 'Not found');

        // Check if user has access to this event
        if (!participant) {
            console.log(`❌ [eventAccessMiddleware] FINAL DENIAL: No active participant record found for user ${userId} in event ${event_id}`);
            console.log(`❌ [eventAccessMiddleware] Event owner: ${event.created_by.toString()}`);
            console.log(`❌ [eventAccessMiddleware] User ID: ${userId}`);

            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: "Access denied - not an active participant" },
                other: null
            });
        }

        // FIXED: Proper type handling for permissions
        const effectivePermissions = participant.permissions || {};

        console.log(`🔍 [eventAccessMiddleware] Effective permissions:`, effectivePermissions);

        // FIXED: Proper boolean conversion and type safety
        req.eventAccess = {
            eventId: event_id,
            role: participant.role as EventRole,
            participantId: participant._id?.toString() || "",

            // Basic access permissions - ensure boolean values
            canView: Boolean(effectivePermissions.can_view),
            canUpload: Boolean(effectivePermissions.can_upload),
            canDownload: Boolean(effectivePermissions.can_download),

            // Management permissions
            canEdit: Boolean(effectivePermissions.can_edit_event),
            canDelete: Boolean(effectivePermissions.can_delete_event),
            canManageParticipants: Boolean(effectivePermissions.can_manage_participants),
            canInviteOthers: Boolean(effectivePermissions.can_invite_others),

            // Content permissions
            canModerateContent: Boolean(effectivePermissions.can_moderate_content),
            canApproveContent: Boolean(effectivePermissions.can_approve_content),
            canExportData: Boolean(effectivePermissions.can_export_data),

            // Settings and analytics
            canManageSettings: Boolean(effectivePermissions.can_manage_settings),
            canViewAnalytics: Boolean(effectivePermissions.can_view_analytics),
            canTransferOwnership: Boolean(effectivePermissions.can_transfer_ownership),

            // Legacy aliases for backward compatibility
            canManageGuests: Boolean(effectivePermissions.can_manage_participants),
            canManageContent: Boolean(effectivePermissions.can_moderate_content),

            // FIXED: Proper date handling
            joinMethod: typeof participant.join_method === 'string' ? participant.join_method : undefined,
            joinedAt: participant.joined_at && typeof participant.joined_at === 'string'
                ? new Date(participant.joined_at)
                : participant.joined_at && typeof participant.joined_at === 'number'
                    ? new Date(participant.joined_at)
                    : participant.joined_at && participant.joined_at instanceof Date
                        ? participant.joined_at
                        : new Date(),
            lastActivity: participant.last_activity_at && typeof participant.last_activity_at === 'string'
                ? new Date(participant.last_activity_at)
                : participant.last_activity_at && typeof participant.last_activity_at === 'number'
                    ? new Date(participant.last_activity_at)
                    : participant.last_activity_at && participant.last_activity_at instanceof Date
                        ? participant.last_activity_at
                        : new Date()
        }
        next();
    } catch (error: any) {
        console.error(`💥 [eventAccessMiddleware] Error: ${error.message}`);
        console.error(`💥 [eventAccessMiddleware] Stack: ${error.stack}`);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Error checking event access",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        });
    }
};

/**
 * Middleware to check if user can manage guests
 */
export const requireGuestManagementAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    if (!req.eventAccess?.canManageGuests) {
        return sendResponse(res, {
            status: false,
            code: 403,
            message: "You don't have permission to manage guests for this event",
            data: null,
            error: { message: "Guest management access required" },
            other: null
        });
    }
    next();
};

/**
 * Token access middleware for guest pages
 * Handles both authenticated and unauthenticated users
 */
export const tokenAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { token_id } = req.params;

        if (!token_id || typeof token_id !== 'string') {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Valid token ID is required',
                data: null,
                error: { message: 'Invalid or missing token ID' },
                other: null,
            });
        }

        // Find event by share_token
        const event = await Event.findOne({ share_token: token_id })
            .select('_id title visibility share_settings permissions created_by')
            .lean();

        if (!event) {
            logger.warn(`[tokenAccessMiddleware] Share token ${token_id} not found`);
            return sendResponse(res, {
                status: false,
                code: 404,
                message: 'Share token not found',
                data: null,
                error: { message: 'Token not found' },
                other: null,
            });
        }

        const eventId = event._id.toString();

        // Validate share settings
        const validationError = validateShareSettings(event.share_settings, token_id, eventId);
        if (validationError) {
            return sendResponse(res, validationError);
        }

        // Check password if required
        const passwordError = checkEventPassword(event.share_settings, req.headers['x-event-password'], token_id);
        if (passwordError) {
            return sendResponse(res, passwordError);
        }

        // Get user ID if authenticated (optional)
        const userId = req.user?._id?.toString();

        console.log(`🔍 [tokenAccessMiddleware] Processing token ${token_id}`);
        console.log(`🔍 [tokenAccessMiddleware] User authenticated: ${!!userId}`);
        console.log(`🔍 [tokenAccessMiddleware] Event visibility: ${event.visibility}`);

        // Handle visibility-based access with optional user
        const accessResult = await handleEventVisibility(event, userId);
        if (!accessResult.success) {
            return sendResponse(res, accessResult.error);
        }

        // Set clean event access
        req.eventAccess = accessResult.eventAccess!;
        logger.info(`[tokenAccessMiddleware] Access granted: ${accessResult.eventAccess!.role} for token ${token_id}`);

        next();
    } catch (error: any) {
        logger.error(`[tokenAccessMiddleware] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: 'Error checking token access',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};

// ============= HELPER FUNCTIONS =============

function validateShareSettings(shareSettings: any, tokenId: string, eventId: string): any {
    if (!shareSettings?.is_active) {
        logger.warn(`[tokenAccessMiddleware] Share token ${tokenId} is inactive for event ${eventId}`);
        return {
            status: false,
            code: 403,
            message: 'Share token is inactive',
            data: null as any,
            error: { message: 'Token is inactive' },
            other: null as any,
        };
    }

    if (shareSettings?.expires_at && new Date(shareSettings.expires_at) < new Date()) {
        logger.warn(`[tokenAccessMiddleware] Share token ${tokenId} has expired for event ${eventId}`);
        return {
            status: false,
            code: 403,
            message: 'Share token has expired',
            data: null as any,
            error: { message: 'Token has expired' },
            other: null as any,
        };
    }

    return null;
}

function checkEventPassword(shareSettings: any, providedPassword: any, tokenId: string): any {
    if (shareSettings?.password) {
        if (!providedPassword || providedPassword !== shareSettings.password) {
            logger.warn(`[tokenAccessMiddleware] Password required for token ${tokenId}`);
            return {
                status: false,
                code: 401,
                message: 'Password required',
                data: null as any,
                error: { message: 'password_required' },
                other: null as any,
            };
        }
    }
    return null;
}

async function handleEventVisibility(event: any, userId?: string): Promise<{
    success: boolean;
    eventAccess?: EventAccess;
    error?: any;
}> {
    const eventId = event._id.toString();

    console.log(`🔍 [handleEventVisibility] Processing visibility: ${event.visibility}`);
    console.log(`🔍 [handleEventVisibility] User ID: ${userId || 'none'}`);

    // FIXED: Complete EventAccess objects with all required properties
    switch (event.visibility) {
        case 'anyone_with_link':
            console.log('✅ [handleEventVisibility] Public access granted');
            return {
                success: true,
                eventAccess: {
                    eventId,
                    role: 'guest' as EventRole,
                    canView: true,
                    canUpload: Boolean(event.permissions?.can_upload),
                    canDownload: Boolean(event.permissions?.can_download),
                    canEdit: false,
                    canDelete: false,
                    canManageParticipants: false,
                    canInviteOthers: false,
                    canModerateContent: false,
                    canApproveContent: false,
                    canExportData: false,
                    canManageSettings: false,
                    canViewAnalytics: false,
                    canTransferOwnership: false,
                    canManageGuests: false,
                    canManageContent: false,
                }
            };

        case 'invited_only':
            if (!userId) {
                console.log('❌ [handleEventVisibility] Auth required for invited_only');
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 401,
                        message: 'Authentication required',
                        data: null as any,
                        error: { message: 'You must be logged in to access this event' },
                        other: null as any,
                    }
                };
            }

            console.log('✅ [handleEventVisibility] Authenticated access granted for invited_only');
            return {
                success: true,
                eventAccess: {
                    eventId,
                    role: 'authenticated_guest' as EventRole,
                    canView: true,
                    canUpload: Boolean(event.permissions?.can_upload),
                    canDownload: Boolean(event.permissions?.can_download),
                    canEdit: false,
                    canDelete: false,
                    canManageParticipants: false,
                    canInviteOthers: false,
                    canModerateContent: false,
                    canApproveContent: false,
                    canExportData: false,
                    canManageSettings: false,
                    canViewAnalytics: false,
                    canTransferOwnership: false,
                    canManageGuests: false,
                    canManageContent: false,
                }
            };

        case 'private':
            if (!userId) {
                console.log('❌ [handleEventVisibility] Private event - no user');
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 403,
                        message: 'This event is private',
                        data: null as any,
                        error: { message: 'This event is private and not accessible' },
                        other: null as any,
                    }
                };
            }

            // For private events, check via EventParticipant model
            const participant = await EventParticipant.findOne({
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: new mongoose.Types.ObjectId(eventId),
                status: 'active'
            }).lean();

            if (
                !participant ||
                typeof participant.role !== 'string' ||
                !['creator', 'co_host'].includes(participant.role)
            ) {
                console.log(`❌ [handleEventVisibility] Private event - access denied for user ${userId}`);
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 403,
                        message: 'Access denied to private event',
                        data: null as any,
                        error: { message: 'This event is private and you don\'t have access' },
                        other: null as any,
                    }
                };
            }

            console.log(`✅ [handleEventVisibility] Private event access granted - role: ${participant.role}`);
            return {
                success: true,
                eventAccess: {
                    eventId,
                    role: participant.role as EventRole,
                    participantId: participant._id?.toString(),
                    canView: true,
                    canUpload: true,
                    canDownload: true,
                    canEdit: Boolean(participant.permissions?.can_edit_event),
                    canDelete: Boolean(participant.permissions?.can_delete_event),
                    canManageParticipants: Boolean(participant.permissions?.can_manage_participants),
                    canInviteOthers: Boolean(participant.permissions?.can_invite_others),
                    canModerateContent: Boolean(participant.permissions?.can_moderate_content),
                    canApproveContent: Boolean(participant.permissions?.can_approve_content),
                    canExportData: Boolean(participant.permissions?.can_export_data),
                    canManageSettings: Boolean(participant.permissions?.can_manage_settings),
                    canViewAnalytics: Boolean(participant.permissions?.can_view_analytics),
                    canTransferOwnership: Boolean(participant.permissions?.can_transfer_ownership),
                    canManageGuests: Boolean(participant.permissions?.can_manage_participants),
                    canManageContent: Boolean(participant.permissions?.can_moderate_content),
                    joinMethod: typeof participant.join_method === 'string' ? participant.join_method : undefined,
                    joinedAt: participant.joined_at && typeof participant.joined_at === 'string'
                        ? new Date(participant.joined_at)
                        : undefined,
                    lastActivity: participant.last_activity_at && typeof participant.last_activity_at === 'string'
                        ? new Date(participant.last_activity_at)
                        : undefined,

                }
            };

        default:
            console.log(`❌ [handleEventVisibility] Unknown visibility: ${event.visibility}`);
            return {
                success: false,
                error: {
                    status: false,
                    code: 400,
                    message: 'Invalid event configuration',
                    data: null as any,
                    error: { message: 'Unknown event visibility type' },
                    other: null as any,
                }
            };
    }
}

// Update your injectedRequest type
declare module "types/injected-types" {
    interface injectedRequest {
        eventAccess?: EventAccess;
    }
}
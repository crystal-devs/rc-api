// middlewares/event-access.middleware.ts
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";
import { Event } from "@models/event.model";

// Clean role types
export type EventRole = 'owner' | 'co_host' | 'guest' | 'authenticated_guest';

// Clean event access interface
export interface EventAccess {
    eventId: string;
    role: EventRole;
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canManageGuests: boolean;
    canManageContent: boolean;
    canUpload?: boolean;
    canDownload?: boolean;
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
        console.log(`🔍 [eventAccessMiddleware] Co-hosts count: ${event.co_hosts ? event.co_hosts.length : 0}`);

        // Determine user role in the event
        const userRole = getUserRoleInEvent(event, userId);

        if (!userRole) {
            console.log(`❌ [eventAccessMiddleware] FINAL DENIAL: No role found for user ${userId} in event ${event_id}`);
            console.log(`❌ [eventAccessMiddleware] Event owner: ${event.created_by.toString()}`);
            console.log(`❌ [eventAccessMiddleware] User ID: ${userId}`);
            console.log(`❌ [eventAccessMiddleware] Co-hosts: ${JSON.stringify(event.co_hosts, null, 2)}`);

            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: "Access denied" },
                other: null
            });
        }

        // Get user permission details if they are a co-host
        const userPermission = getUserPermissionDetails(event, userId);

        // Add event access info to request
        req.eventAccess = {
            eventId: event_id,
            role: userRole,
            canView: true,
            canEdit: ['owner', 'co_host'].includes(userRole),
            canDelete: userRole === 'owner',
            canManageGuests: ['owner', 'co_host'].includes(userRole) && 
                (!userPermission?.permissions || userPermission.permissions.manage_guests !== false),
            canManageContent: ['owner', 'co_host'].includes(userRole) && 
                (!userPermission?.permissions || userPermission.permissions.manage_content !== false)
        };

        console.log(`✅ [eventAccessMiddleware] ACCESS GRANTED: User ${userId} has role ${userRole} in event ${event_id}`);
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
            .select('_id title visibility share_settings permissions created_by co_hosts')
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
        console.log(`🔍 [tokenAccessMiddleware] User authenticated: ${!!userId}`,  req.headers);
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

    switch (event.visibility) {
        case 'anyone_with_link':
            console.log('✅ [handleEventVisibility] Public access granted');
            return {
                success: true,
                eventAccess: {
                    eventId,
                    role: 'guest',
                    canView: true,
                    canEdit: false,
                    canDelete: false,
                    canManageGuests: false,
                    canManageContent: false,
                    canUpload: event.permissions?.can_upload || false,
                    canDownload: event.permissions?.can_download || false,
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
                    role: 'authenticated_guest',
                    canView: true,
                    canEdit: false,
                    canDelete: false,
                    canManageGuests: false,
                    canManageContent: false,
                    canUpload: event.permissions?.can_upload || false,
                    canDownload: event.permissions?.can_download || false,
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

            // Check if user has access to private event
            const userRole = getUserRoleInEvent(event, userId);
            if (!userRole || !(['owner', 'co_host'] as EventRole[]).includes(userRole)) {
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

            console.log(`✅ [handleEventVisibility] Private event access granted - role: ${userRole}`);
            return {
                success: true,
                eventAccess: {
                    eventId,
                    role: userRole,
                    canView: true,
                    canEdit: true,
                    canDelete: userRole === 'owner',
                    canManageGuests: true,
                    canManageContent: true,
                    canUpload: true,
                    canDownload: true,
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

function getUserRoleInEvent(event: any, userId: string): EventRole | null {
    // Check if user is the event creator
    if (event.created_by && event.created_by.toString() === userId) {
        return 'owner';
    }

    // Check if user is an approved co-host
    if (event.co_hosts && event.co_hosts.length > 0) {
        const coHost = event.co_hosts.find(
            (coHost: any) => coHost.user_id.toString() === userId && coHost.status === 'approved'
        );
        if (coHost) return 'co_host';
    }

    return null;
}

function getUserPermissionDetails(event: any, userId: string): any {
    // If user is owner, they have all permissions
    if (event.created_by && event.created_by.toString() === userId) {
        return {
            permissions: {
                manage_guests: true,
                manage_content: true,
                manage_settings: true,
                approve_content: true
            }
        };
    }

    // Check if user is a co-host and get their specific permissions
    if (event.co_hosts && event.co_hosts.length > 0) {
        const coHost = event.co_hosts.find(
            (coHost: any) => coHost.user_id.toString() === userId && coHost.status === 'approved'
        );
        if (coHost) {
            return coHost;
        }
    }

    return null;
}

// Update your injectedRequest type
declare module "types/injected-types" {
    interface injectedRequest {
        eventAccess?: EventAccess;
    }
}
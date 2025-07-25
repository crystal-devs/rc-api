// middlewares/event-access.middleware.ts
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import { AccessControl } from "@models/access.model";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";
import { MODEL_NAMES } from "@models/names";
import { Event } from "@models/event.model";

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

        // Simple query - just get the event and check access in JavaScript
        console.log(`🔍 [eventAccessMiddleware] Querying database for event: ${event_id}`);
        const event = await Event.findById(event_id).lean();

        if (!event) {
            console.log(`❌ [eventAccessMiddleware] Event ${event_id} not found in database`);

            // Debug: Try to find any event with similar ID
            const similarEvents = await Event.find({}).select('_id title').limit(5).lean();
            console.log(`🔍 [eventAccessMiddleware] Sample events in DB:`, similarEvents.map(e => ({ id: e._id.toString(), title: e.title })));

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

        let role: 'owner' | 'co_host' | 'guest' | 'viewer' | null = null;
        let userPermission: any = null;

        // Check if user is owner
        if (event.created_by.toString() === userId) {
            role = "owner";
            console.log(`✅ [eventAccessMiddleware] User ${userId} is OWNER of event ${event_id}`);
        }
        // Check if user is co-host
        else if (event.co_hosts && Array.isArray(event.co_hosts) && event.co_hosts.length > 0) {
            console.log(`🔍 [eventAccessMiddleware] Checking co_hosts array (${event.co_hosts.length} entries):`);

            event.co_hosts.forEach((ch, index) => {
                console.log(`  Co-host ${index}: user_id=${ch.user_id.toString()}, status=${ch.status}, matches=${ch.user_id.toString() === userId}`);
            });

            const coHostEntry = event.co_hosts.find(coHost => {
                const coHostUserId = coHost.user_id.toString();
                const isApproved = coHost.status === 'approved';
                const matches = coHostUserId === userId;

                return matches && isApproved;
            });

            if (coHostEntry) {
                role = "co_host";
                userPermission = coHostEntry;
                console.log(`✅ [eventAccessMiddleware] User ${userId} is APPROVED CO-HOST of event ${event_id}`);
            } else {
                console.log(`❌ [eventAccessMiddleware] User ${userId} not found as approved co-host in event ${event_id}`);
            }
        } else {
            console.log(`🔍 [eventAccessMiddleware] No co_hosts array found or it's empty`);
        }

        // If still no role, check AccessControl as fallback
        if (!role) {
            console.log(`🔍 [eventAccessMiddleware] Checking AccessControl for user ${userId}`);

            try {
                const accessControl = await AccessControl.findOne({
                    resource_id: new mongoose.Types.ObjectId(event_id),
                    resource_type: "event",
                    "permissions.user_id": new mongoose.Types.ObjectId(userId)
                }).lean();

                if (accessControl) {
                    userPermission = accessControl.permissions.find(
                        p => p.user_id.toString() === userId
                    );
                    role = userPermission?.role;
                    console.log(`✅ [eventAccessMiddleware] Found AccessControl role: ${role} for user ${userId}`);
                } else {
                    console.log(`❌ [eventAccessMiddleware] No AccessControl found for user ${userId}`);
                }
            } catch (accessControlError) {
                console.log(`⚠️ [eventAccessMiddleware] AccessControl query failed:`, accessControlError.message);
                // Continue without AccessControl
            }
        }

        // Final access check
        if (!role) {
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

        // Add event access info to request
        req.eventAccess = {
            eventId: event_id,
            role,
            canView: true,
            canEdit: ['owner', 'co_host'].includes(role),
            canDelete: role === 'owner',
            canManageGuests: ['owner', 'co_host'].includes(role) && (!userPermission?.permissions || userPermission.permissions.manage_guests !== false),
            canManageContent: ['owner', 'co_host', 'moderator'].includes(role) && (!userPermission?.permissions || userPermission.permissions.manage_content !== false)
        };

        console.log(`✅ [eventAccessMiddleware] ACCESS GRANTED: User ${userId} has role ${role} in event ${event_id}`);
        next();
    } catch (error) {
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
 * Middleware to check if user can edit the event
 */
export const requireEventEditAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    if (!req.eventAccess?.canEdit) {
        return sendResponse(res, {
            status: false,
            code: 403,
            message: "You don't have permission to edit this event",
            data: null,
            error: { message: "Edit access required" },
            other: null
        });
    }
    next();
};

/**
 * Middleware to check if user can delete the event
 */
export const requireEventDeleteAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    if (!req.eventAccess?.canDelete) {
        return sendResponse(res, {
            status: false,
            code: 403,
            message: "You don't have permission to delete this event",
            data: null,
            error: { message: "Delete access required" },
            other: null
        });
    }
    next();
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
 * Middleware to check token access with relaxed rules for unlisted events
 * This will bypass authentication for unlisted events
 */
export const tokenAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { token_id } = req.params;

        // Validate token_id
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
        const event = await Event.findOne({ share_token: token_id }).select(
            '_id visibility share_settings permissions'
        );

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

        // Check share_settings
        if (!event.share_settings.is_active) {
            logger.warn(`[tokenAccessMiddleware] Share token ${token_id} is inactive for event ${eventId}`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: 'Share token is inactive',
                data: null,
                error: { message: 'Token is inactive' },
                other: null,
            });
        }

        if (event.share_settings.expires_at && new Date(event.share_settings.expires_at) < new Date()) {
            logger.warn(`[tokenAccessMiddleware] Share token ${token_id} has expired for event ${eventId}`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: 'Share token has expired',
                data: null,
                error: { message: 'Token has expired' },
                other: null,
            });
        }

        // If visibility is anyone_with_link, allow access without authentication
        if (event.visibility === 'anyone_with_link') {
            req.eventAccess = {
                eventId,
                role: 'viewer',
                canView: event.permissions.can_view,
                canEdit: false,
                canDelete: false,
                canManageGuests: false,
                canManageContent: false,
            };
            logger.info(`[tokenAccessMiddleware] Granted viewer access for token ${token_id} (anyone_with_link)`);
            return next();
        }

        // For invited_only or private, require authentication
        if (!req.user || !req.user._id) {
            logger.warn(`[tokenAccessMiddleware] Authentication required for token ${token_id}`);
            return sendResponse(res, {
                status: false,
                code: 401,
                message: 'Authentication required',
                data: null,
                error: { message: 'You must be logged in to access this resource' },
                other: null,
            });
        }

        const userId = req.user._id.toString();

        // Check user access to event
        const accessControl = await AccessControl.findOne({
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: 'event',
            'permissions.user_id': new mongoose.Types.ObjectId(userId),
        }).lean();

        if (!accessControl) {
            logger.warn(`[tokenAccessMiddleware] User ${userId} has no access to event ${eventId} via token ${token_id}`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: 'Access denied' },
                other: null,
            });
        }

        // Extract user's role and permissions
        const userPermission = accessControl.permissions.find(
            (p) => p.user_id.toString() === userId
        );

        if (!userPermission) {
            logger.warn(`[tokenAccessMiddleware] No permissions found for user ${userId} in event ${eventId}`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: 'Access denied' },
                other: null,
            });
        }

        // Add event access info to request
        req.eventAccess = {
            eventId,
            role: userPermission.role,
            canView: event.permissions.can_view,
            canEdit: ['owner', 'co_host'].includes(userPermission.role),
            canDelete: userPermission.role === 'owner',
            canManageGuests: ['owner', 'co_host'].includes(userPermission.role),
            canManageContent: ['owner', 'co_host', 'moderator'].includes(userPermission.role),
        };

        logger.info(`[tokenAccessMiddleware] Granted access for user ${userId} to event ${eventId} with role ${userPermission.role}`);
        next();
    } catch (error) {
        logger.error(`[tokenAccessMiddleware] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: 'Error checking token access',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            },
            other: null,
        });
    }
};

// Add to your injectedRequest type
declare module "types/injected-types" {
    interface injectedRequest {
        eventAccess?: {
            eventId: string;
            role: 'owner' | 'co_host' | 'moderator' | 'guest' | 'viewer';
            canView: boolean;
            canEdit: boolean;
            canDelete: boolean;
            canManageGuests: boolean;
            canManageContent: boolean;
        };
    }
}
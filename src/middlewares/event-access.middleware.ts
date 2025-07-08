// middlewares/event-access.middleware.ts
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import { AccessControl } from "@models/access.model";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";
import { MODEL_NAMES } from "@models/names";

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
        const { event_id } = req.params;
        const userId = req.user._id.toString();

        // Validate event_id
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Valid event ID is required",
                data: null,
                error: { message: "Invalid or missing event ID" },
                other: null
            });
        }

        // Check user access to event
        const accessControl = await AccessControl.findOne({
            resource_id: new mongoose.Types.ObjectId(event_id),
            resource_type: "event",
            "permissions.user_id": new mongoose.Types.ObjectId(userId)
        }).lean();

        if (!accessControl) {
            logger.warn(`[eventAccessMiddleware] User ${userId} attempted to access event ${event_id} without permission`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: "Access denied" },
                other: null
            });
        }

        // Extract user's role and permissions for this event
        const userPermission = accessControl.permissions.find(
            p => p.user_id.toString() === userId
        );

        if (!userPermission) {
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
            role: userPermission.role,
            canView: true, // If they have access, they can view
            canEdit: ['owner', 'co_host'].includes(userPermission.role),
            canDelete: userPermission.role === 'owner',
            canManageGuests: ['owner', 'co_host'].includes(userPermission.role),
            canManageContent: ['owner', 'co_host', 'moderator'].includes(userPermission.role)
        };

        next();
    } catch (error) {
        logger.error(`[eventAccessMiddleware] Error: ${error.message}`);
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
 * Middleware to check event access via token ID
 * This will find the event ID from the token and then check access
 */
export const tokenBasedEventAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { token_id } = req.params;
        const userId = req.user._id.toString();

        // Validate token_id
        if (!token_id || !mongoose.Types.ObjectId.isValid(token_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Valid token ID is required",
                data: null,
                error: { message: "Invalid or missing token ID" },
                other: null
            });
        }

        // Find token to get event ID
        const shareToken = await mongoose.model(MODEL_NAMES.SHARE_TOKEN).findById(token_id);
        if (!shareToken) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: "Share token not found",
                data: null,
                error: { message: "Token not found" },
                other: null
            });
        }

        // Get the event ID from token
        const event_id = shareToken.event_id.toString();

        // Check user access to event
        const accessControl = await AccessControl.findOne({
            resource_id: new mongoose.Types.ObjectId(event_id),
            resource_type: "event",
            "permissions.user_id": new mongoose.Types.ObjectId(userId)
        }).lean();

        if (!accessControl) {
            logger.warn(`[tokenBasedEventAccessMiddleware] User ${userId} attempted to access event ${event_id} via token ${token_id} without permission`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: "Access denied" },
                other: null
            });
        }

        // Extract user's role and permissions for this event
        const userPermission = accessControl.permissions.find(
            p => p.user_id.toString() === userId
        );

        if (!userPermission) {
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
            role: userPermission.role,
            canView: true, // If they have access, they can view
            canEdit: ['owner', 'co_host'].includes(userPermission.role),
            canDelete: userPermission.role === 'owner',
            canManageGuests: ['owner', 'co_host'].includes(userPermission.role),
            canManageContent: ['owner', 'co_host', 'moderator'].includes(userPermission.role)
        };

        next();
    } catch (error) {
        logger.error(`[tokenBasedEventAccessMiddleware] Error: ${error.message}`);
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
 * Middleware to check token access with relaxed rules for unlisted events
 * This will bypass authentication for unlisted events
 */
export const publicTokenAccessMiddleware = async (
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
                message: "Valid token ID is required",
                data: null,
                error: { message: "Invalid or missing token ID" },
                other: null
            });
        }

        // Find token to get event ID
        const shareToken = await mongoose.model(MODEL_NAMES.SHARE_TOKEN).findOne({ token: token_id })
            .populate({
                path: 'event_id',
                select: 'privacy.visibility'
            });

        if (!shareToken) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: "Share token not found",
                data: null,
                error: { message: "Token not found" },
                other: null
            });
        }

        // Get the event ID and check if it's unlisted
        const event_id = shareToken.event_id._id.toString();
        const isUnlisted = shareToken.event_id.privacy?.visibility === 'unlisted';

        // If unlisted, allow access without authentication
        if (isUnlisted) {
            // Add basic event access info to request
            req.eventAccess = {
                eventId: event_id,
                role: 'viewer',
                canView: true,
                canEdit: false,
                canDelete: false,
                canManageGuests: false,
                canManageContent: false
            };
            return next();
        }

        // For non-unlisted events, require authentication
        if (!req.user) {
            return sendResponse(res, {
                status: false,
                code: 401,
                message: "Authentication required",
                data: null,
                error: { message: "You must be logged in to access this resource" },
                other: null
            });
        }

        const userId = req.user._id.toString();

        // Check user access to event
        const accessControl = await AccessControl.findOne({
            resource_id: new mongoose.Types.ObjectId(event_id),
            resource_type: "event",
            "permissions.user_id": new mongoose.Types.ObjectId(userId)
        }).lean();

        if (!accessControl) {
            logger.warn(`[publicTokenAccessMiddleware] User ${userId} attempted to access event ${event_id} via token ${token_id} without permission`);
            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: "Access denied" },
                other: null
            });
        }

        // Extract user's role and permissions for this event
        const userPermission = accessControl.permissions.find(
            p => p.user_id.toString() === userId
        );

        if (!userPermission) {
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
            role: userPermission.role,
            canView: true, // If they have access, they can view
            canEdit: ['owner', 'co_host'].includes(userPermission.role),
            canDelete: userPermission.role === 'owner',
            canManageGuests: ['owner', 'co_host'].includes(userPermission.role),
            canManageContent: ['owner', 'co_host', 'moderator'].includes(userPermission.role)
        };

        next();
    } catch (error) {
        logger.error(`[publicTokenAccessMiddleware] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Error checking token access",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
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
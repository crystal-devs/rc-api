// middlewares/participant-access.middleware.ts
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";

/**
 * Middleware to check if user can manage participants
 * Requires eventAccessMiddleware to be run first
 */
export const requireParticipantManagementAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.eventAccess) {
            logger.error('[requireParticipantManagementAccess] No eventAccess found - eventAccessMiddleware must run first');
            return sendResponse(res, {
                status: false,
                message: "Event access validation required",
                data: null,
                error: { message: "eventAccessMiddleware must run before participant middleware" }
            });
        }

        if (!req.eventAccess.canManageParticipants) {
            logger.warn(`[requireParticipantManagementAccess] User ${req.user._id} denied participant management access to event ${req.eventAccess.eventId}`);
            return sendResponse(res, {
                status: false,
                message: "You don't have permission to manage participants for this event",
                data: null,
                error: { 
                    message: "Participant management access required",
                    required_permission: "can_manage_participants",
                    user_role: req.eventAccess.role
                }
            });
        }

        logger.info(`[requireParticipantManagementAccess] User ${req.user._id} granted participant management access to event ${req.eventAccess.eventId}`);
        next();

    } catch (error: any) {
        logger.error(`[requireParticipantManagementAccess] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            message: "Error checking participant management permissions",
            data: null,
            error: { message: error.message }
        });
    }
};

/**
 * Middleware to check if user can invite participants
 * Less restrictive than full participant management
 */
export const requireInviteAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.eventAccess) {
            return sendResponse(res, {
                status: false,
                message: "Event access validation required",
                data: null,
                error: { message: "eventAccessMiddleware must run before invite middleware" }
            });
        }

        if (!req.eventAccess.canInviteOthers) {
            logger.warn(`[requireInviteAccess] User ${req.user._id} denied invite access to event ${req.eventAccess.eventId}`);
            return sendResponse(res, {
                status: false,
                message: "You don't have permission to invite participants to this event",
                data: null,
                error: { 
                    message: "Invite access required",
                    required_permission: "can_invite_others",
                    user_role: req.eventAccess.role
                }
            });
        }

        next();

    } catch (error: any) {
        logger.error(`[requireInviteAccess] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            message: "Error checking invite permissions",
            data: null,
            error: { message: error.message }
        });
    }
};

/**
 * Middleware to check if user can moderate content
 */
export const requireContentModerationAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.eventAccess) {
            return sendResponse(res, {
                status: false,
                message: "Event access validation required",
                data: null,
                error: { message: "eventAccessMiddleware must run before moderation middleware" }
            });
        }

        if (!req.eventAccess.canModerateContent) {
            return sendResponse(res, {
                status: false,
                message: "You don't have permission to moderate content for this event",
                data: null,
                error: { 
                    message: "Content moderation access required",
                    required_permission: "can_moderate_content",
                    user_role: req.eventAccess.role
                }
            });
        }

        next();

    } catch (error: any) {
        logger.error(`[requireContentModerationAccess] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            message: "Error checking content moderation permissions",
            data: null,
            error: { message: error.message }
        });
    }
};

/**
 * Middleware to check if user can view analytics
 */
export const requireAnalyticsAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.eventAccess) {
            return sendResponse(res, {
                status: false,
                message: "Event access validation required",
                data: null
            });
        }

        if (!req.eventAccess.canViewAnalytics) {
            return sendResponse(res, {
                status: false,
                message: "You don't have permission to view analytics for this event",
                data: null,
                error: { 
                    message: "Analytics access required",
                    required_permission: "can_view_analytics",
                    user_role: req.eventAccess.role
                }
            });
        }

        next();

    } catch (error: any) {
        logger.error(`[requireAnalyticsAccess] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            message: "Error checking analytics permissions",
            data: null,
            error: { message: error.message }
        });
    }
};

/**
 * Middleware to check if user can manage event settings
 */
export const requireEventManagementAccess = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.eventAccess) {
            return sendResponse(res, {
                status: false,
                message: "Event access validation required",
                data: null
            });
        }

        if (!req.eventAccess.canManageSettings) {
            return sendResponse(res, {
                status: false,
                message: "You don't have permission to manage settings for this event",
                data: null,
                error: { 
                    message: "Event management access required",
                    required_permission: "can_manage_settings",
                    user_role: req.eventAccess.role
                }
            });
        }

        next();

    } catch (error: any) {
        logger.error(`[requireEventManagementAccess] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            message: "Error checking event management permissions",
            data: null,
            error: { message: error.message }
        });
    }
};

/**
 * Flexible permission checker - pass required permissions as parameters
 */
export const requirePermissions = (permissions: string[]) => {
    return async (req: injectedRequest, res: Response, next: NextFunction) => {
        try {
            if (!req.eventAccess) {
                return sendResponse(res, {
                    status: false,
                    message: "Event access validation required",
                    data: null
                });
            }

            const missingPermissions = permissions.filter(permission => {
                return !req.eventAccess![permission as keyof typeof req.eventAccess];
            });

            if (missingPermissions.length > 0) {
                return sendResponse(res, {
                    status: false,
                    message: "You don't have the required permissions for this action",
                    data: null,
                    error: {
                        message: "Insufficient permissions",
                        missing_permissions: missingPermissions,
                        user_role: req.eventAccess.role
                    }
                });
            }

            next();

        } catch (error: any) {
            logger.error(`[requirePermissions] Error: ${error.message}`);
            return sendResponse(res, {
                status: false,
                message: "Error checking permissions",
                data: null,
                error: { message: error.message }
            });
        }
    };
};
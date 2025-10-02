// =================================================================
// controllers/participant.controller.ts - HTTP Layer Only
// =================================================================

import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { sendResponse, handleControllerError } from "@utils/express.util";
import * as participantService from "@services/participant.service";

// Input validation helper
const validateObjectId = (id: string, fieldName: string) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Valid ${fieldName} is required`);
    }
};

// Get event participants with filtering and pagination
export const getEventParticipantsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        validateObjectId(event_id, 'event ID');

        // Extract query parameters with defaults
        const {
            role,
            status,
            search,
            page = '1',
            limit = '20',
            sortBy = 'joined_at',
            sortOrder = 'desc'
        } = req.query;

        // Parse and validate parameters
        const parsedPage = parseInt(page as string, 10);
        const parsedLimit = Math.min(parseInt(limit as string, 10), 100); // Cap at 100

        if (isNaN(parsedPage) || parsedPage < 1) {
            return sendResponse(res, {
                status: false,
                message: 'Page must be a positive integer',
                data: null
            });
        }

        if (isNaN(parsedLimit) || parsedLimit < 1) {
            return sendResponse(res, {
                status: false,
                message: 'Limit must be a positive integer (max 100)',
                data: null
            });
        }

        // Parse role and status arrays
        const roleFilter = role ? (typeof role === 'string' ? [role] : role as string[]) : undefined;
        const statusFilter = status ? (typeof status === 'string' ? [status] : status as string[]) : undefined;

        // Validate sort order
        if (sortOrder && !['asc', 'desc'].includes(sortOrder as string)) {
            return sendResponse(res, {
                status: false,
                message: 'Sort order must be "asc" or "desc"',
                data: null
            });
        }

        const filters = {
            role: roleFilter,
            status: statusFilter,
            search: search as string,
            page: parsedPage,
            limit: parsedLimit,
            sortBy: sortBy as string,
            sortOrder: sortOrder as 'asc' | 'desc'
        };

        // Call service
        const response = await participantService.getEventParticipants(event_id, filters);
        sendResponse(res, response);

    } catch (error) {
        logger.error('Error in getEventParticipantsController:', error);
        handleControllerError(res, error, 'getEventParticipantsController');
    }
};

// Invite participants (bulk support)
export const inviteParticipantsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const { invites, personalMessage, expiresInHours, autoApprove } = req.body;
        const invitedBy = req.user._id.toString();

        validateObjectId(event_id, 'event ID');

        // Validate invites array
        if (!Array.isArray(invites) || invites.length === 0) {
            return sendResponse(res, {
                status: false,
                message: 'Invites array is required and cannot be empty',
                data: null
            });
        }

        if (invites.length > 50) {
            return sendResponse(res, {
                status: false,
                message: 'Cannot invite more than 50 participants at once',
                data: null
            });
        }

        // Validate each invite
        for (const invite of invites) {
            if (!invite.email && !invite.phone) {
                return sendResponse(res, {
                    status: false,
                    message: 'Each invite must have either email or phone',
                    data: null
                });
            }

            if (invite.role && !['co_host', 'moderator', 'guest', 'viewer'].includes(invite.role)) {
                return sendResponse(res, {
                    status: false,
                    message: 'Invalid role. Use: co_host, moderator, guest, viewer',
                    data: null
                });
            }
        }

        // Validate optional parameters
        const options: any = {};
        if (personalMessage) {
            options.personalMessage = personalMessage.trim();
        }

        if (expiresInHours !== undefined) {
            const parsedHours = parseInt(expiresInHours, 10);
            if (isNaN(parsedHours) || parsedHours < 1 || parsedHours > 8760) {
                return sendResponse(res, {
                    status: false,
                    message: 'expiresInHours must be between 1 and 8760 (1 year)',
                    data: null
                });
            }
            options.expiresInHours = parsedHours;
        }

        if (autoApprove !== undefined) {
            options.autoApprove = Boolean(autoApprove);
        }

        // Call service
        const response = await participantService.inviteParticipants(event_id, invites, invitedBy, options);
        sendResponse(res, response);

    } catch (error) {
        logger.error('Error in inviteParticipantsController:', error);
        handleControllerError(res, error, 'inviteParticipantsController');
    }
};

// Update participant permissions/role
export const updateParticipantController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, participant_id } = req.params;
        const { role, permissions, status } = req.body;
        const updatedBy = req.user._id.toString();

        validateObjectId(event_id, 'event ID');
        validateObjectId(participant_id, 'participant ID');

        // Validate updates
        const updates: any = {};

        if (role) {
            if (!['co_host', 'moderator', 'guest', 'viewer'].includes(role)) {
                return sendResponse(res, {
                    status: false,
                    message: 'Invalid role. Use: co_host, moderator, guest, viewer',
                    data: null
                });
            }
            updates.role = role;
        }

        if (permissions) {
            if (typeof permissions !== 'object' || Array.isArray(permissions)) {
                return sendResponse(res, {
                    status: false,
                    message: 'Permissions must be an object with boolean values',
                    data: null
                });
            }
            updates.permissions = permissions;
        }

        if (status) {
            if (!['active', 'pending', 'blocked', 'removed'].includes(status)) {
                return sendResponse(res, {
                    status: false,
                    message: 'Invalid status. Use: active, pending, blocked, removed',
                    data: null
                });
            }
            updates.status = status;
        }

        if (Object.keys(updates).length === 0) {
            return sendResponse(res, {
                status: false,
                message: 'At least one field (role, permissions, status) must be provided',
                data: null
            });
        }

        // Call service
        const response = await participantService.updateParticipant(event_id, participant_id, updates, updatedBy);
        sendResponse(res, response);

    } catch (error) {
        logger.error('Error in updateParticipantController:', error);
        handleControllerError(res, error, 'updateParticipantController');
    }
};

// Remove participant
export const removeParticipantController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, participant_id } = req.params;
        const { permanent } = req.query;
        const removedBy = req.user._id.toString();

        validateObjectId(event_id, 'event ID');
        validateObjectId(participant_id, 'participant ID');

        const isPermanent = permanent === 'true';

        // Call service
        const response = await participantService.removeParticipant(event_id, participant_id, removedBy, isPermanent);
        sendResponse(res, response);

    } catch (error) {
        logger.error('Error in removeParticipantController:', error);
        handleControllerError(res, error, 'removeParticipantController');
    }
};

// Get participant activity logs
export const getParticipantActivityController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, participant_id } = req.params;
        const { page = '1', limit = '50', actions, dateFrom, dateTo } = req.query;

        validateObjectId(event_id, 'event ID');
        validateObjectId(participant_id, 'participant ID');

        // Parse and validate parameters
        const parsedPage = parseInt(page as string, 10);
        const parsedLimit = Math.min(parseInt(limit as string, 10), 100);

        if (isNaN(parsedPage) || parsedPage < 1) {
            return sendResponse(res, {
                status: false,
                message: 'Page must be a positive integer',
                data: null
            });
        }

        if (isNaN(parsedLimit) || parsedLimit < 1) {
            return sendResponse(res, {
                status: false,
                message: 'Limit must be a positive integer (max 100)',
                data: null
            });
        }

        // Parse optional filters
        const options: any = {
            page: parsedPage,
            limit: parsedLimit
        };

        if (actions) {
            options.actions = typeof actions === 'string' ? [actions] : actions as string[];
        }

        if (dateFrom) {
            options.dateFrom = new Date(dateFrom as string);
            if (isNaN(options.dateFrom.getTime())) {
                return sendResponse(res, {
                    status: false,
                    message: 'Invalid dateFrom format',
                    data: null
                });
            }
        }

        if (dateTo) {
            options.dateTo = new Date(dateTo as string);
            if (isNaN(options.dateTo.getTime())) {
                return sendResponse(res, {
                    status: false,
                    message: 'Invalid dateTo format',
                    data: null
                });
            }
        }

        // Call service
        const response = await participantService.getParticipantActivity(event_id, participant_id, options);
        sendResponse(res, response);

    } catch (error) {
        logger.error('Error in getParticipantActivityController:', error);
        handleControllerError(res, error, 'getParticipantActivityController');
    }
};

// Get participant statistics
export const getParticipantStatsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, participant_id } = req.params;

        validateObjectId(event_id, 'event ID');
        validateObjectId(participant_id, 'participant ID');

        // Call service
        const response = await participantService.getParticipantStats(event_id, participant_id);
        sendResponse(res, response);

    } catch (error) {
        logger.error('Error in getParticipantStatsController:', error);
        handleControllerError(res, error, 'getParticipantStatsController');
    }
};
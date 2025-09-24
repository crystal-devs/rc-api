// =================================================================
// 2. controllers/cohost.controller.ts - HTTP Layer Only
// =================================================================

import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import * as cohostService from "@services/cohost.service";

// Input validation helper
const validateObjectId = (id: string, fieldName: string) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Valid ${fieldName} is required`);
    }
};

// Get co-host invite details
export const getCoHostInviteController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();
        console.log(event_id, 'event_idevent_idevent_id')
        // Input validation
        validateObjectId(event_id, 'event ID');

        // Permission check
        const hasPermission = await cohostService.checkParticipantManagementPermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to view co-host invite for this event",
                data: null
            });
            return;
        }

        // Get invite details
        const response = await cohostService.getCoHostInviteDetails(event_id);
        const statusCode = response.status ? 200 : 404;
        res.status(statusCode).json(response);

    } catch (error) {
        logger.error('Error in getCoHostInviteController:', error);
        res.status(400).json({
            status: false,
            message: error.message || 'Bad request',
            data: null
        });
    }
};

// Join as co-host
export const joinAsCoHostController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { token } = req.params;
        const userId = req.user._id.toString();

        // Input validation
        if (!token) {
            res.status(400).json({
                status: false,
                message: 'Co-host invite token is required',
                data: null
            });
            return;
        }

        // Call service
        const response = await cohostService.joinAsCoHost(token, userId);
        const statusCode = response.status ? 200 : 400;
        res.status(statusCode).json(response);

    } catch (error) {
        logger.error('Error in joinAsCoHostController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Manage co-host
export const manageCoHostController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, user_id } = req.params;
        const { action } = req.body;
        const adminUserId = req.user._id.toString();

        // Input validation
        validateObjectId(event_id, 'event ID');
        validateObjectId(user_id, 'user ID');

        const validActions = ['approve', 'reject', 'remove', 'block', 'unblock'];
        if (!action || !validActions.includes(action)) {
            res.status(400).json({
                status: false,
                message: 'Valid action is required (approve, reject, remove, block, unblock)',
                data: null
            });
            return;
        }

        // Permission check
        const hasPermission = await cohostService.checkParticipantManagementPermission(event_id, adminUserId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to manage co-hosts for this event",
                data: null
            });
            return;
        }

        // Call service
        const response = await cohostService.manageCoHost(event_id, user_id, action, adminUserId);
        const statusCode = response.status ? 200 : 400;
        res.status(statusCode).json(response);

    } catch (error) {
        logger.error('Error in manageCoHostController:', error);
        res.status(400).json({
            status: false,
            message: error.message || 'Bad request',
            data: null
        });
    }
};

// Get event co-hosts
export const getEventCoHostsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();

        // Input validation
        validateObjectId(event_id, 'event ID');

        // Permission check - users need to be active participants to view co-hosts
        const userParticipant = await cohostService.checkParticipantManagementPermission(event_id, userId);
        if (!userParticipant) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to view co-hosts for this event",
                data: null
            });
            return;
        }

        // Call service
        const response = await cohostService.getEventCoHosts(event_id);
        const statusCode = response.status ? 200 : 404;
        res.status(statusCode).json(response);

    } catch (error) {
        logger.error('Error in getEventCoHostsController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
}

// Add these missing functions to your cohost.controller.ts file:

// Create co-host invite
export const createCoHostInviteController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();
        const { maxUses, expiresInHours, personalMessage } = req.body;

        console.log(userId, 'eventidiasdf')
        // Input validation
        validateObjectId(event_id, 'event ID');

        // Permission check
        const hasPermission = await cohostService.checkParticipantManagementPermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to create co-host invites for this event",
                data: null
            });
            return;
        }

        // Validate optional parameters
        const options: any = {};
        if (maxUses !== undefined) {
            const parsedMaxUses = parseInt(maxUses);
            if (isNaN(parsedMaxUses) || parsedMaxUses < 1 || parsedMaxUses > 100) {
                res.status(400).json({
                    status: false,
                    message: 'maxUses must be between 1 and 100',
                    data: null
                });
                return;
            }
            options.maxUses = parsedMaxUses;
        }

        if (expiresInHours !== undefined) {
            const parsedHours = parseInt(expiresInHours);
            if (isNaN(parsedHours) || parsedHours < 1 || parsedHours > 8760) { // Max 1 year
                res.status(400).json({
                    status: false,
                    message: 'expiresInHours must be between 1 and 8760 (1 year)',
                    data: null
                });
                return;
            }
            options.expiresInHours = parsedHours;
        }

        if (personalMessage) {
            options.personalMessage = personalMessage.trim();
        }

        // Call service
        const response = await cohostService.createCoHostInvite(event_id, userId, options);
        const statusCode = response.status ? 201 : 400;
        res.status(statusCode).json(response);

    } catch (error) {
        logger.error('Error in createCoHostInviteController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Revoke co-host invite
export const revokeCoHostInviteController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, invitation_id } = req.params;
        const userId = req.user._id.toString();

        // Input validation
        validateObjectId(event_id, 'event ID');
        validateObjectId(invitation_id, 'invitation ID');

        // Permission check
        const hasPermission = await cohostService.checkParticipantManagementPermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to revoke co-host invites for this event",
                data: null
            });
            return;
        }

        // Call service
        const response = await cohostService.revokeCoHostInvite(event_id, invitation_id, userId);
        const statusCode = response.status ? 200 : 400;
        res.status(statusCode).json(response);

    } catch (error) {
        logger.error('Error in revokeCoHostInviteController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import * as eventService from "@services/event.service";
import * as cohostService from "@services/cohost.service";
import { sendResponse } from "@utils/express.util";
import mongoose from "mongoose";

export const generateCoHostInviteController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { event_id } = req.params;
        const { expires_in_hours = 24, max_uses = 10 } = req.body;
        const userId = req.user._id.toString();

        // Validate input
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        const hasPermission = await eventService.checkUpdatePermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to manage co-hosts for this event",
                data: null
            });
            return;
        }

        const response = await cohostService.generateCoHostInviteToken(event_id, userId, expires_in_hours, max_uses);
        console.log('Co-host invite token generated:', response);
        // Ensure proper response structure
        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(400).json(response);
        }
    } catch (error) {
        console.error('Error in generateCoHostInviteController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Get co-host invite details
export const getCoHostInviteController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        const hasPermission = await eventService.checkUpdatePermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to view co-host invite for this event",
                data: null
            });
            return;
        }

        const response = await cohostService.getCoHostInviteDetails(event_id);

        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(404).json(response);
        }
    } catch (error) {
        console.error('Error in getCoHostInviteController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Deactivate co-host invite
export const deactivateCoHostInviteController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        const hasPermission = await eventService.checkUpdatePermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to manage co-hosts for this event",
                data: null
            });
            return;
        }

        const response = await cohostService.deactivateCoHostInvite(event_id, userId);

        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(400).json(response);
        }
    } catch (error) {
        console.error('Error in deactivateCoHostInviteController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Join as co-host
export const joinAsCoHostController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { token } = req.params;
        const userId = req.user._id.toString();

        if (!token) {
            res.status(400).json({
                status: false,
                message: 'Co-host invite token is required',
                data: null
            });
            return;
        }

        const response = await cohostService.joinAsCoHost(token, userId);

        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(400).json(response);
        }
    } catch (error) {
        console.error('Error in joinAsCoHostController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Manage co-host (approve/reject/remove)
export const manageCoHostController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { event_id, user_id } = req.params;
        const { action } = req.body;
        const adminUserId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        if (!user_id || !mongoose.Types.ObjectId.isValid(user_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid user ID is required',
                data: null
            });
            return;
        }

        const validActions = ['approve', 'reject', 'remove'];
        if (!action || !validActions.includes(action)) {
            res.status(400).json({
                status: false,
                message: 'Valid action is required (approve, reject, remove)',
                data: null
            });
            return;
        }

        const hasPermission = await eventService.checkUpdatePermission(event_id, adminUserId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to manage co-hosts for this event",
                data: null
            });
            return;
        }

        const response = await cohostService.manageCoHost(event_id, user_id, action, adminUserId);

        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(400).json(response);
        }
    } catch (error) {
        console.error('Error in manageCoHostController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

// Get event co-hosts
export const getEventCoHostsController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        const hasPermission = await cohostService.checkViewPermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to view co-hosts for this event",
                data: null
            });
            return;
        }

        const response = await cohostService.getEventCoHosts(event_id);

        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(404).json(response);
        }
    } catch (error) {
        console.error('Error in getEventCoHostsController:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};
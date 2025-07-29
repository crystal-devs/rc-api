import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import * as eventService from "@services/event.service";
import * as cohostService from "@services/cohost.service";
import { sendResponse } from "@utils/express.util";
import mongoose from "mongoose";
import { Event } from "@models/event.model";

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

        // 🔥 KEY FIX: Return the response even for "already co-host" case
        if (response.status) {
            res.status(200).json(response);
        } else {
            // Don't return 400 for "already co-host" - return 200 with the event_id
            if (response.message.includes('already a co-host') && response.data?.event_id) {
                res.status(200).json({
                    ...response,
                    status: true, // Change to true so frontend can redirect
                    message: 'You are already a co-host for this event'
                });
            } else {
                res.status(400).json(response);
            }
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

        // Updated to include block and unblock actions
        const validActions = ['approve', 'reject', 'remove', 'block', 'unblock'];
        if (!action || !validActions.includes(action)) {
            res.status(400).json({
                status: false,
                message: 'Valid action is required (approve, reject, remove, block, unblock)',
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

        console.log('🔍 [getEventCoHostsController] Params:', req.params);
        console.log('🔍 [getEventCoHostsController] Event ID:', event_id);
        console.log('🔍 [getEventCoHostsController] User ID:', userId);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            console.log('❌ [getEventCoHostsController] Invalid event ID');
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        // Simplified permission check - just check if user has access to the event
        const event = await Event.findById(event_id).select('created_by co_hosts');
        
        if (!event) {
            console.log('❌ [getEventCoHostsController] Event not found');
            res.status(404).json({
                status: false,
                message: 'Event not found',
                data: null
            });
            return;
        }

        // Check if user is creator or co-host
        const isCreator = event.created_by.toString() === userId;
        const isCoHost = event.co_hosts.some(ch => 
            ch.user_id.toString() === userId && ch.status === 'approved'
        );

        if (!isCreator && !isCoHost) {
            console.log('❌ [getEventCoHostsController] No permission');
            res.status(403).json({
                status: false,
                message: "You don't have permission to view co-hosts for this event",
                data: null
            });
            return;
        }

        console.log('✅ [getEventCoHostsController] Permission granted, fetching co-hosts');
        const response = await cohostService.getEventCoHosts(event_id);

        console.log('📊 [getEventCoHostsController] Service response:', response);

        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(404).json(response);
        }
    } catch (error) {
        console.error('💥 [getEventCoHostsController] Error:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            data: null
        });
    }
};

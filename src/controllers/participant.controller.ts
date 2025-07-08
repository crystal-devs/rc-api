import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import * as participantService from "@services/participant.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";

export const getEventParticipantsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        console.log('===== GET EVENT PARTICIPANTS REQUEST =====');
        console.log('Request params:', req.params);
        const { event_id } = trimObject(req.params);
        const {
            page = 1,
            limit = 20,
            status = 'all',
            role = 'all',
            search = '',
            sort = '-participation.joined_at'
        } = trimObject(req.query);

        const filters = {
            eventId: event_id,
            requesterId: req.user._id.toString(),
            page: Math.max(1, parseInt(page as string)),
            limit: Math.min(100, Math.max(1, parseInt(limit as string))),
            status: status as string,
            role: role as string,
            search: search as string,
            sort: sort as string
        };

        const response = await participantService.getEventParticipantsService(filters);
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const inviteParticipantsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const {
            participants,
            message = '',
            send_immediately = true,
            default_role = 'guest',
            custom_permissions
        } = trimObject(req.body);

        if (!Array.isArray(participants) || participants.length === 0) {
            throw new Error("At least one participant is required");
        }

        // Validate participants
        const validParticipants = participants.map(p => {
            if (!p.email || !p.name) {
                throw new Error("Each participant must have email and name");
            }
            return {
                email: p.email.toLowerCase().trim(),
                name: p.name.trim(),
                role: p.role || default_role,
                permissions: p.permissions || custom_permissions || undefined
            };
        });

        const response = await participantService.inviteParticipantsService({
            eventId: event_id,
            invitedBy: req.user._id.toString(),
            participants: validParticipants,
            message,
            sendImmediately: send_immediately
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getParticipantDetailsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, participant_id } = trimObject(req.params);

        if (!mongoose.Types.ObjectId.isValid(participant_id)) {
            throw new Error("Valid participant ID is required");
        }

        const response = await participantService.getParticipantDetailsService({
            eventId: event_id,
            participantId: participant_id,
            requesterId: req.user._id.toString()
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const updateParticipantController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, participant_id } = trimObject(req.params);
        const updateData = trimObject(req.body);

        if (!mongoose.Types.ObjectId.isValid(participant_id)) {
            throw new Error("Valid participant ID is required");
        }

        const response = await participantService.updateParticipantService({
            eventId: event_id,
            participantId: participant_id,
            updatedBy: req.user._id.toString(),
            updateData
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const removeParticipantController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, participant_id } = trimObject(req.params);
        const { reason = '' } = trimObject(req.body);

        if (!mongoose.Types.ObjectId.isValid(participant_id)) {
            throw new Error("Valid participant ID is required");
        }

        const response = await participantService.removeParticipantService({
            eventId: event_id,
            participantId: participant_id,
            removedBy: req.user._id.toString(),
            reason
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getParticipantActivityController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, participant_id } = trimObject(req.params);
        const {
            page = 1,
            limit = 20,
            type = 'all',
            date_from,
            date_to
        } = trimObject(req.query);

        if (!mongoose.Types.ObjectId.isValid(participant_id)) {
            throw new Error("Valid participant ID is required");
        }

        const response = await participantService.getParticipantActivityService({
            eventId: event_id,
            participantId: participant_id,
            requesterId: req.user._id.toString(),
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            type: type as string,
            dateFrom: date_from ? new Date(date_from as string) : undefined,
            dateTo: date_to ? new Date(date_to as string) : undefined
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const bulkUpdateParticipantsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const {
            participant_ids,
            action, // 'update_permissions', 'change_role', 'remove'
            data
        } = trimObject(req.body);

        if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
            throw new Error("At least one participant ID is required");
        }

        const validIds = participant_ids.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validIds.length === 0) {
            throw new Error("No valid participant IDs provided");
        }

        const response = await participantService.bulkUpdateParticipantsService({
            eventId: event_id,
            participantIds: validIds,
            action,
            data,
            updatedBy: req.user._id.toString()
        });

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const exportParticipantsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const {
            format = 'csv',
            include_activity = false,
            status_filter = 'active'
        } = trimObject(req.query);

        const response = await participantService.exportParticipantsService({
            eventId: event_id,
            requesterId: req.user._id.toString(),
            format: format as string,
            includeActivity: include_activity === 'true',
            statusFilter: status_filter as string
        });

        if (response.status) {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="event_${event_id}_participants.csv"`);
            res.send(response.data);
        } else {
            sendResponse(res, response);
        }
    } catch (error) {
        next(error);
    }
};
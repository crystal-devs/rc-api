import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express"
import { injectedRequest } from "types/injected-types"
import * as eventService from "@services/event.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { createDefaultAlbumForEvent } from "@services/album.service";
import { getEventSharingStatusService } from "@services/share-token.service";

export const createeventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        let { title, description, start_date, end_date, is_private = false, cover_image, location, template, accessType } = trimObject(req.body);
        // Validate required fields
        if (!title) throw new Error("Title is a required field");

        // Validate date logic
        if (start_date && end_date && start_date > end_date) {
            throw new Error("Start date must be before end date");
        }
        else if (start_date) start_date = new Date(start_date)
        else if (end_date) end_date = new Date(end_date)

        // Type checking
        if (typeof title !== "string" || typeof description !== "string") {
            throw new Error("Invalid data type for title or description");
        }
        if (start_date && !(start_date instanceof Date)) {
            throw new Error("Invalid data type for start_date");
        }
        if (end_date && !(end_date instanceof Date)) {
            throw new Error("Invalid data type for end_date");
        }

        const response = await eventService.createEventService({
            title,
            description,
            start_date,
            end_date,
            created_by: new mongoose.Types.ObjectId(req.user._id),
            is_private,
            is_shared: false,
            created_at: new Date(),
            cover_image: cover_image || "",
            location: location || "",
            template: template || "custom",
        });

        // If event created successfully, create a default album
        if (response.status && response.data && response.data._id) {
            await createDefaultAlbumForEvent(
                response.data._id.toString(),
                req.user._id.toString()
            );
        }

        sendResponse(res, response);
    } catch (_err) {
        next(_err)
    }
}

export const getUsereventsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const user_id = req.user._id.toString(); // we will defenetly get the user id from the auth middleware
        const response = await eventService.geteventsByeventIdOrUserId({ user_id });
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
}

export const geteventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        console.log(event_id, 'event id')
        if (!event_id) throw new Error("event id is required");
        const response = await eventService.geteventsByeventIdOrUserId({ event_id });
        console.log(response, 'response')
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
}

export const updateeventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        let { title, description, start_date, end_date, is_private, share_settings } = trimObject(req.body);
        const { event_id } = trimObject(req.params);
        console.log(req.body, 'req.body');
        // Validate event_id
        if (!event_id) throw new Error("event ID is required");

        // Initialize update object
        const updateData: any = {};

        // Conditionally add fields to update object
        if (title) {
            if (typeof title !== "string") throw new Error("Invalid data type for title");
            updateData.title = title;
        }
        if (description) {
            if (typeof description !== "string") throw new Error("Invalid data type for description");
            updateData.description = description;
        }
        if (start_date) {
            start_date = new Date(start_date)
            if (!(start_date instanceof Date)) throw new Error("Invalid data type for start_date");
            updateData.start_date = start_date;
        }
        if (end_date) {
            end_date = new Date(end_date)
            if (!(end_date instanceof Date)) throw new Error("Invalid data type for end_date");
            updateData.end_date = end_date;
        }

        // Validate date logic if both dates are present
        if (updateData.start_date && updateData.end_date && updateData.start_date > updateData.end_date) {
            throw new Error("Start date must be before end date");
        }
        updateData.is_private = is_private !== undefined ? is_private : false;
        if (share_settings) updateData.share_settings = share_settings;
        console.log(updateData, 'updateData')
        // Perform the update
        const response = await eventService.updateeventService(event_id, updateData);
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
}

export const deleteEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);

        // Validate event_id
        if (!event_id) {
            throw new Error("Event ID is required");
        }

        const user_id = req.user._id.toString();

        console.log(`[deleteEventController] Deleting event: ${event_id} by user: ${user_id}`);

        // Call the delete event service
        const response = await eventService.deleteEventService(event_id, user_id);

        console.log(`[deleteEventController] Delete response: ${JSON.stringify(response)}`);

        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
}

// Get event sharing status
export const getEventSharingStatusController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid event ID",
                data: null,
                error: { message: "A valid event ID is required" },
                other: null
            });
        }

        const response = await getEventSharingStatusService(event_id, req.user._id.toString());
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express"
import { injectedRequest } from "types/injected-types"
import * as eventService from "@services/event.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";

export const createeventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        let { title, description, start_date, end_date, is_private = false } = trimObject(req.body);

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
            created_at: new Date(),
            thumbnail_pic: "",
        });
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
        if (!event_id) throw new Error("event id is required");
        const response = await eventService.geteventsByeventIdOrUserId({ event_id });
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
}

export const updateeventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        let { title, description, start_date, end_date } = trimObject(req.body);
        const { event_id } = trimObject(req.params);

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

        // Perform the update
        const response = await eventService.updateeventService(event_id, updateData);
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
}

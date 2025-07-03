// controllers/album.controller.ts

import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import * as albumService from "@services/album.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";

export const createAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        let { title, description, event_id, is_private = false, cover_image } = trimObject(req.body);

        // Validate required fields
        if (!title) throw new Error("Title is a required field");
        if (!event_id) throw new Error("Event ID is a required field");

        // Type checking
        if (typeof title !== "string") {
            throw new Error("Invalid data type for title");
        }
        if (description && typeof description !== "string") {
            throw new Error("Invalid data type for description");
        }
        
        // Validate event_id is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Invalid event ID format");
        }

        const response = await albumService.createAlbumService({
            title,
            description: description || "",
            event_id: new mongoose.Types.ObjectId(event_id),
            created_by: new mongoose.Types.ObjectId(req.user._id),
            created_at: new Date(),
            cover_image: cover_image || "",
            is_private: !!is_private,
            is_default: false
        });

        console.log("Album created successfully:", response);
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const getUserAlbumsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const user_id = req.user._id.toString();
        const response = await albumService.getAlbumsByParams({ user_id });
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const getEventAlbumsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        
        if (!event_id) throw new Error("Event ID is required");
        if (!mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Invalid event ID format");
        }
        
        const response = await albumService.getAlbumsByParams({ event_id });
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const getAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { album_id } = trimObject(req.params);
        
        if (!album_id) throw new Error("Album ID is required");
        if (!mongoose.Types.ObjectId.isValid(album_id)) {
            throw new Error("Invalid album ID format");
        }
        
        const response = await albumService.getAlbumsByParams({ album_id });
        
        // If array is empty, album was not found
        if (response.status && (!response.data || response.data.length === 0)) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: "Album not found",
                data: null,
                error: null,
                other: null
            });
        }
        
        // Return the first (and only) album in the array
        if (response.status && response.data && response.data.length > 0) {
            return sendResponse(res, {
                ...response,
                data: response.data[0]
            });
        }
        
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const updateAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        let { title, description, is_private, cover_image } = trimObject(req.body);
        const { album_id } = trimObject(req.params);

        // Validate album_id
        if (!album_id) throw new Error("Album ID is required");
        if (!mongoose.Types.ObjectId.isValid(album_id)) {
            throw new Error("Invalid album ID format");
        }

        // Initialize update object
        const updateData: any = {};

        // Conditionally add fields to update object
        if (title !== undefined) {
            if (typeof title !== "string") throw new Error("Invalid data type for title");
            updateData.title = title;
        }
        
        if (description !== undefined) {
            if (typeof description !== "string") throw new Error("Invalid data type for description");
            updateData.description = description;
        }
        
        if (is_private !== undefined) {
            updateData.is_private = !!is_private;
        }
        
        if (cover_image !== undefined) {
            updateData.cover_image = cover_image;
        }

        // Check if there's anything to update
        if (Object.keys(updateData).length === 0) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "No valid fields to update",
                data: null,
                error: null,
                other: null
            });
        }

        // Perform the update
        const response = await albumService.updateAlbumService(
            album_id, 
            updateData,
            req.user._id.toString()
        );
        
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const deleteAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { album_id } = trimObject(req.params);

        // Validate album_id
        if (!album_id) throw new Error("Album ID is required");
        if (!mongoose.Types.ObjectId.isValid(album_id)) {
            throw new Error("Invalid album ID format");
        }

        // Perform the deletion
        const response = await albumService.deleteAlbumService(
            album_id,
            req.user._id.toString()
        );
        
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const getOrCreateDefaultAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        
        if (!event_id) throw new Error("Event ID is required");
        if (!mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Invalid event ID format");
        }
        
        const response = await albumService.getOrCreateDefaultAlbum(
            event_id,
            req.user._id.toString()
        );
        
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};
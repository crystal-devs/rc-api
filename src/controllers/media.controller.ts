// controllers/media.controller.ts

import { getOrCreateDefaultAlbum } from "@services/album.service";
import { uploadMediaService, uploadCoverImageService, getMediaByEventService, getMediaByAlbumService, deleteMediaService } from "@services/media.service";
import { sendResponse } from "@utils/express.util";
import { NextFunction, RequestHandler, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";

/**
 * Regular media upload controller
 */
export const uploadMediaController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const file = req.file;
        let { album_id, event_id } = req.body;
        const user_id = req.user._id;

        console.log('Media upload request:', {
            file: file ? `File present: ${file.originalname}` : 'No file',
            album_id: album_id ? `Album ID: ${album_id}` : 'No album ID',
            event_id: event_id ? `Event ID: ${event_id}` : 'No event ID',
            user_id: user_id ? `User ID: ${user_id}` : 'No user ID',
            body: JSON.stringify(req.body)
        });
        if (!file) {
            res.status(400).json({
                status: false,
                message: "Missing file",
                error: { message: "File is required" },
            });
            return;
        }

        if (!event_id) {
            res.status(400).json({
                status: false,
                message: "Missing event_id",
                error: { message: "event_id is required" },
            });
            return;
        }

        // If no album_id is provided, get or create a default album
        if (!album_id) {
            const defaultAlbumResponse = await getOrCreateDefaultAlbum(
                event_id,
                user_id.toString()
            );

            if (!defaultAlbumResponse.status || !defaultAlbumResponse.data) {
                res.status(500).json({
                    status: false,
                    message: "Failed to get or create default album",
                    error: { message: "Could not create or find default album" },
                });
                return;
            }

            album_id = defaultAlbumResponse.data._id.toString();
        }

        // Now proceed with the media upload
        const response = await uploadMediaService(file, user_id.toString(), album_id, event_id);
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

/**
 * Cover image upload controller
 */
export const uploadCoverImageController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Log the request for debugging
        console.log('Cover image upload request:', {
            file: req.file ? 'File present' : 'No file',
            body: req.body
        });

        const file = req.file;
        // Get the folder parameter with 'covers' as default
        const { folder = 'covers' } = req.body;

        // Validate inputs
        if (!file) {
            res.status(400).json({
                status: false,
                message: "No file provided",
                error: { message: "Image file is required" },
            });
            return;
        }

        // Upload cover image
        const response = await uploadCoverImageService(file, folder);
        sendResponse(res, response);
    } catch (_err) {
        console.error('Error in uploadCoverImageController:', _err);
        next(_err);
    }
};

/**
 * Get all media for a specific event
 */
export const getMediaByEventController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user?._id?.toString();
        const {
            include_processing,
            include_pending,
            page,
            limit,
            quality,
            since,
        } = req.query;

        // Validate event_id
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Invalid event ID',
                error: { message: 'A valid event ID is required' },
            });
            return;
        }

        // Parse query parameters
        const options: {
            includeProcessing?: boolean;
            includePending?: boolean;
            page?: number;
            limit?: number;
            quality?: 'thumbnail' | 'display' | 'full';
            since?: string;
        } = {
            includeProcessing: include_processing === 'true',
            includePending: include_pending === 'true',
            page: page ? parseInt(page as string, 10) : undefined,
            limit: limit ? parseInt(limit as string, 10) : undefined,
            quality: quality as 'thumbnail' | 'display' | 'full',
            since: since as string,
        };

        // Fetch media
        const response = await getMediaByEventService(event_id, options, userId);
        sendResponse(res, response);
    } catch (err) {
        console.error('Error in getMediaByEventController:', err);
        next(err);
    }
};

/**
 * Get all media for a specific album
 */
export const getMediaByAlbumController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { album_id } = req.params;

        // Validate album_id
        if (!album_id || !mongoose.Types.ObjectId.isValid(album_id)) {
            res.status(400).json({
                status: false,
                message: "Invalid album ID",
                error: { message: "A valid album ID is required" },
            });
            return;
        }

        // Fetch media for the album
        const response = await getMediaByAlbumService(album_id);
        sendResponse(res, response);
    } catch (_err) {
        console.error('Error in getMediaByAlbumController:', _err);
        next(_err);
    }
};

/**
 * Delete a media item
 */
export const deleteMediaController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { media_id } = req.params;
        const user_id = req.user._id;

        // Validate media_id
        if (!media_id || !mongoose.Types.ObjectId.isValid(media_id)) {
            res.status(400).json({
                status: false,
                message: "Invalid media ID",
                error: { message: "A valid media ID is required" },
            });
            return;
        }

        // Delete the media
        const response = await deleteMediaService(media_id, user_id.toString());
        sendResponse(res, response);
    } catch (_err) {
        console.error('Error in deleteMediaController:', _err);
        next(_err);
    }
};
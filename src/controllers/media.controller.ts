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

        // Validate event_id first
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid or missing event ID',
                data: null,
                error: { message: 'A valid event ID is required' },
                other: null
            });
            return;
        }

        // Extract and validate query parameters
        const {
            include_processing,
            include_pending,
            page,
            limit,
            quality,
            since,
        } = req.query;

        // Parse and validate query parameters with proper defaults
        const options: {
            includeProcessing?: boolean;
            includePending?: boolean;
            page?: number;
            limit?: number;
            quality?: 'thumbnail' | 'display' | 'full';
            since?: string;
        } = {};

        // Handle boolean parameters - only set if explicitly provided
        if (include_processing !== undefined) {
            options.includeProcessing = include_processing === 'true';
        }

        if (include_pending !== undefined) {
            options.includePending = include_pending === 'true';
        }

        // Handle numeric parameters with validation
        if (page) {
            const pageNum = parseInt(page as string, 10);
            if (isNaN(pageNum) || pageNum < 1) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid page number',
                    data: null,
                    error: { message: 'Page must be a positive integer' },
                    other: null
                });
                return;
            }
            options.page = pageNum;
        }

        if (limit) {
            const limitNum = parseInt(limit as string, 10);
            if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid limit',
                    data: null,
                    error: { message: 'Limit must be between 1 and 100' },
                    other: null
                });
                return;
            }
            options.limit = limitNum;
        }

        // Handle quality parameter
        if (quality) {
            const validQualities = ['thumbnail', 'display', 'full'];
            if (!validQualities.includes(quality as string)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid quality parameter',
                    data: null,
                    error: { message: 'Quality must be one of: thumbnail, display, full' },
                    other: null
                });
                return;
            }
            options.quality = quality as 'thumbnail' | 'display' | 'full';
        }

        // Handle since parameter
        if (since) {
            const sinceDate = new Date(since as string);
            if (isNaN(sinceDate.getTime())) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid date format for since parameter',
                    data: null,
                    error: { message: 'Since parameter must be a valid ISO date string' },
                    other: null
                });
                return;
            }
            options.since = since as string;
        }

        console.log('Controller: Fetching media for event:', {
            event_id,
            options,
            userId
        });

        // Call service
        const response = await getMediaByEventService(event_id, options, userId);

        // Send response
        res.status(response.code).json(response);

    } catch (err: any) {
        console.error('Error in getMediaByEventController:', {
            message: err.message,
            stack: err.stack,
            params: req.params,
            query: req.query
        });

        res.status(500).json({
            status: false,
            code: 500,
            message: 'Internal server error',
            data: null,
            error: {
                message: 'An unexpected error occurred',
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            },
            other: null
        });
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
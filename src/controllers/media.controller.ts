// controllers/media.controller.ts

import { getOrCreateDefaultAlbum } from "@services/album.service";
import { uploadMediaService, uploadCoverImageService, getMediaByEventService, getMediaByAlbumService, deleteMediaService, uploadGuestMediaService, updateMediaStatusService, bulkUpdateMediaStatusService, getGuestMediaService } from "@services/media.service";
import { sendResponse } from "@utils/express.util";
import { NextFunction, RequestHandler, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";

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
            // New parameters
            status,
            cursor,
            scroll_type
        } = req.query;

        // Parse and validate query parameters with proper defaults
        const options: {
            includeProcessing?: boolean;
            includePending?: boolean;
            page?: number;
            limit?: number;
            quality?: 'thumbnail' | 'display' | 'full';
            since?: string;
            status?: 'approved' | 'pending' | 'rejected' | 'hidden' | 'auto_approved';
            cursor?: string;
            scrollType?: 'pagination' | 'infinite';
        } = {};

        // Handle boolean parameters - only set if explicitly provided
        if (include_processing !== undefined) {
            options.includeProcessing = include_processing === 'true';
        }

        if (include_pending !== undefined) {
            options.includePending = include_pending === 'true';
        }

        // Handle scroll type parameter
        if (scroll_type) {
            const validScrollTypes = ['pagination', 'infinite'];
            if (!validScrollTypes.includes(scroll_type as string)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid scroll_type parameter',
                    data: null,
                    error: { message: 'scroll_type must be one of: pagination, infinite' },
                    other: null
                });
                return;
            }
            options.scrollType = scroll_type as 'pagination' | 'infinite';
        } else {
            // Default to pagination for backward compatibility
            options.scrollType = 'pagination';
        }

        // Handle status parameter for filtering
        if (status) {
            const validStatuses = ['approved', 'pending', 'rejected', 'hidden', 'auto_approved'];
            if (!validStatuses.includes(status as string)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid status parameter',
                    data: null,
                    error: {
                        message: 'Status must be one of: approved, pending, rejected, hidden, auto_approved'
                    },
                    other: null
                });
                return;
            }
            options.status = status as 'approved' | 'pending' | 'rejected' | 'hidden' | 'auto_approved';
        }

        // Handle cursor parameter for infinite scroll
        if (cursor) {
            const cursorDate = new Date(cursor as string);
            if (isNaN(cursorDate.getTime())) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid cursor format',
                    data: null,
                    error: { message: 'Cursor must be a valid ISO date string' },
                    other: null
                });
                return;
            }
            options.cursor = cursor as string;
        }

        // Handle numeric parameters with validation
        if (page && options.scrollType === 'pagination') {
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
        });

        // Call service
        const response = await getMediaByEventService(event_id, options);

        console.log('Media fetched successfully:', {
            dataCount: response.data?.length,
            status: response.status,
            scrollType: options.scrollType
        });

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

export const updateMediaStatusController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { media_id } = req.params;
        const userId = req.user?._id?.toString();
        const { status, reason, hide_reason } = req.body;

        // Validate media_id
        if (!media_id || !mongoose.Types.ObjectId.isValid(media_id)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid or missing media ID',
                data: null,
                error: { message: 'A valid media ID is required' },
                other: null
            });
            return;
        }

        // Validate required fields
        if (!status) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Status is required',
                data: null,
                error: { message: 'Status field is required in request body' },
                other: null
            });
            return;
        }

        // Validate status value
        const validStatuses = ['approved', 'pending', 'rejected', 'hidden', 'auto_approved'];
        if (!validStatuses.includes(status)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid status value',
                data: null,
                error: {
                    message: 'Status must be one of: approved, pending, rejected, hidden, auto_approved'
                },
                other: null
            });
            return;
        }

        // Validate reason for rejected status
        if (status === 'rejected' && !reason) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Reason is required for rejected status',
                data: null,
                error: { message: 'Reason field is required when rejecting media' },
                other: null
            });
            return;
        }

        console.log('Controller: Updating media status:', {
            media_id,
            status,
            reason,
            hide_reason,
            userId
        });

        // Call service
        const response = await updateMediaStatusService(media_id, status, {
            adminId: userId,
            reason,
            hideReason: hide_reason
        });

        console.log('Media status updated:', {
            success: response.status,
            previousStatus: response.other?.previousStatus,
            newStatus: response.other?.newStatus
        });

        // Send response
        res.status(response.code).json(response);

    } catch (err: any) {
        console.error('Error in updateMediaStatusController:', {
            message: err.message,
            stack: err.stack,
            params: req.params,
            body: req.body
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

export const bulkUpdateMediaStatusController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user?._id?.toString();
        const { media_ids, status, reason, hide_reason } = req.body;

        // Validate event_id
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

        // Validate required fields
        if (!media_ids || !Array.isArray(media_ids) || media_ids.length === 0) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Media IDs array is required',
                data: null,
                error: { message: 'media_ids must be a non-empty array' },
                other: null
            });
            return;
        }

        if (!status) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Status is required',
                data: null,
                error: { message: 'Status field is required in request body' },
                other: null
            });
            return;
        }

        // Validate status value
        const validStatuses = ['approved', 'pending', 'rejected', 'hidden', 'auto_approved'];
        if (!validStatuses.includes(status)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid status value',
                data: null,
                error: {
                    message: 'Status must be one of: approved, pending, rejected, hidden, auto_approved'
                },
                other: null
            });
            return;
        }

        // Limit bulk operations
        if (media_ids.length > 100) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Too many items for bulk update',
                data: null,
                error: { message: 'Maximum 100 items can be updated at once' },
                other: null
            });
            return;
        }

        console.log('Controller: Bulk updating media status:', {
            event_id,
            mediaCount: media_ids.length,
            status,
            userId
        });

        // Call service
        const response = await bulkUpdateMediaStatusService(event_id, media_ids, status, {
            adminId: userId,
            reason,
            hideReason: hide_reason
        });

        console.log('Bulk media status update completed:', {
            success: response.status,
            modifiedCount: response.data?.modifiedCount,
            requestedCount: response.data?.requestedCount
        });

        // Send response
        res.status(response.code).json(response);

    } catch (err: any) {
        console.error('Error in bulkUpdateMediaStatusController:', {
            message: err.message,
            stack: err.stack,
            params: req.params,
            body: req.body
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

// Additional controller for getting media by ID (useful for status updates)
export const getMediaByIdController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { media_id } = req.params;
        const userId = req.user?._id?.toString();

        // Validate media_id
        if (!media_id || !mongoose.Types.ObjectId.isValid(media_id)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid or missing media ID',
                data: null,
                error: { message: 'A valid media ID is required' },
                other: null
            });
            return;
        }

        // Find media
        const media = await Media.findById(media_id).lean();

        if (!media) {
            res.status(404).json({
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media with the provided ID does not exist' },
                other: null
            });
            return;
        }

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Media retrieved successfully',
            data: media,
            error: null,
            other: null
        });

    } catch (err: any) {
        console.error('Error in getMediaByIdController:', {
            message: err.message,
            params: req.params
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


export const guestUploadMediaController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const file = req.file;
        let { album_id, event_id, guest_name, guest_email } = req.body;

        console.log('Guest media upload request:', {
            file: file ? `File present: ${file.originalname}` : 'No file',
            album_id: album_id ? `Album ID: ${album_id}` : 'No album ID',
            event_id: event_id ? `Event ID: ${event_id}` : 'No event ID',
            guest_name: guest_name || 'Anonymous',
            guest_email: guest_email || 'Not provided',
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

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: "Invalid or missing event_id",
                error: { message: "A valid event_id is required" },
            });
            return;
        }

        // Check if event exists and allows guest uploads
        const event = await Event.findById(event_id);
        if (!event) {
            res.status(404).json({
                status: false,
                message: "Event not found",
                error: { message: "The specified event does not exist" },
            });
            return;
        }

        // Check if event allows guest uploads
        if (!event.permissions.can_upload) {
            res.status(403).json({
                status: false,
                message: "Guest uploads not allowed",
                error: { message: "This event does not allow guest uploads" },
                requires_login: true
            });
            return;
        }

        // If no album_id provided, get or create default album
        // For guest uploads, we'll use event owner as the album creator
        if (!album_id) {
            const defaultAlbumResponse = await getOrCreateDefaultAlbum(
                event_id,
                event.created_by.toString() // Use event owner instead of guest
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

        // Create guest info object
        const guestInfo = {
            name: guest_name || 'Anonymous Guest',
            email: guest_email || null,
            ip_address: req.ip || req.connection.remoteAddress || '',
            user_agent: req.get('User-Agent') || ''
        };

        // Upload media using guest upload service
        const response = await uploadGuestMediaService(
            file,
            event.created_by.toString(), // Use event owner as uploader
            album_id,
            event_id,
            guestInfo
        );

        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

export const getGuestMediaController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { share_token } = req.params;
        
        console.log(share_token, 'share_tokenshare_token')
        if (!share_token) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "Share token is required",
                data: null,
                error: { message: "Share token parameter is missing" },
                other: null
            });
            return;
        }

        // Get auth info if available (from conditionalAuthMiddleware)
        const authToken = req.headers.authorization?.replace('Bearer ', '') || 
                         req.headers['x-auth-token'] as string;
        const userEmail = req.user?.email;

        // Extract and validate query parameters
        const {
            page,
            limit,
            quality,
            since,
            cursor,
            scroll_type
        } = req.query;

        const options: any = {};

        // Handle scroll type
        if (scroll_type) {
            const validScrollTypes = ['pagination', 'infinite'];
            if (!validScrollTypes.includes(scroll_type as string)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid scroll_type parameter',
                    data: null,
                    error: { message: 'scroll_type must be one of: pagination, infinite' },
                    other: null
                });
                return;
            }
            options.scrollType = scroll_type as 'pagination' | 'infinite';
        } else {
            options.scrollType = 'pagination';
        }

        // Handle cursor for infinite scroll
        if (cursor) {
            const cursorDate = new Date(cursor as string);
            if (isNaN(cursorDate.getTime())) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid cursor format',
                    data: null,
                    error: { message: 'Cursor must be a valid ISO date string' },
                    other: null
                });
                return;
            }
            options.cursor = cursor as string;
        }

        // Handle pagination
        if (page && options.scrollType === 'pagination') {
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

        // Handle limit
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

        // Handle quality
        if (quality) {
            const validQualities = ['thumbnail', 'display', 'full'];
            if (validQualities.includes(quality as string)) {
                options.quality = quality as 'thumbnail' | 'display' | 'full';
            }
        }

        // Handle since
        if (since) {
            const sinceDate = new Date(since as string);
            if (!isNaN(sinceDate.getTime())) {
                options.since = since as string;
            }
        }

        console.log('Guest Controller: Processing request for share_token:', share_token, {
            userEmail,
            hasAuth: !!authToken,
            options
        });

        // Call the guest media service
        const response = await getGuestMediaService(share_token, userEmail, authToken, options);

        console.log('Guest media response:', {
            status: response.status,
            code: response.code,
            dataCount: response.data?.length,
            requiresAuth: response.other?.requires_auth
        });

        res.status(response.code).json(response);

    } catch (err: any) {
        console.error('Error in getGuestMediaController:', {
            message: err.message,
            stack: err.stack,
            share_token: req.params.share_token,
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
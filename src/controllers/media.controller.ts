// controllers/media.controller.ts - Cleaned up and improved

import { Request, Response, NextFunction, RequestHandler } from "express";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { sendResponse } from "@utils/express.util";
import { getOrCreateDefaultAlbum } from "@services/album.service";
import {
    uploadCoverImageService,
    getMediaByEventService,
    getMediaByAlbumService,
    deleteMediaService,
    updateMediaStatusService,
    bulkUpdateMediaStatusService,
    getGuestMediaService
} from "@services/media.service";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import guestMediaUploadService from "@services/guest.service";
import { getOptimizedImageUrlForItem } from "@utils/file.util";
import { getWebSocketService } from "@services/websocket.service";
import { MediaStatusUpdatePayload } from "types/websocket.types";

// Enhanced interface for authenticated requests
interface AuthenticatedRequest extends Request {
    user?: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
    };
    sessionID?: string;
}

// Interface for injected requests (with required user)
interface InjectedRequest extends AuthenticatedRequest {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
    };
}

/**
 * Cover image upload controller
 */
export const uploadCoverImageController: RequestHandler = async (
    req: InjectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const file = req.file;
        const { folder = 'covers' } = req.body;

        // Validate inputs
        if (!file) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "No file provided",
                data: null,
                error: { message: "Image file is required" },
                other: null
            });
            return;
        }

        logger.info('📸 Cover image upload started', {
            filename: file.originalname,
            size: file.size,
            folder,
            user_id: req.user._id.toString()
        });

        // Upload cover image
        const response = await uploadCoverImageService(file, folder);
        sendResponse(res, response);
    } catch (error: any) {
        logger.error('Error in uploadCoverImageController:', error);
        next(error);
    }
};

/**
 * Get all media for a specific event with enhanced variant support
 */
export const getMediaByEventController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { eventId } = req.params;
        const {
            // Existing pagination options
            includeProcessing,
            includePending,
            page,
            limit,
            since,
            status,
            cursor,
            scrollType,
            // New variant options
            quality,
            format,
            context
        } = req.query;

        // Validate eventId
        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'A valid event ID is required' },
                other: null
            });
            return;
        }

        // Parse and validate options
        const options = {
            includeProcessing: includeProcessing === 'true',
            includePending: includePending === 'true',
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            since: since as string,
            status: status as any,
            cursor: cursor as string,
            scrollType: scrollType as 'pagination' | 'infinite',
            // New variant options
            quality: quality as 'small' | 'medium' | 'large' | 'original' | 'thumbnail' | 'display' | 'full',
            format: format as 'webp' | 'jpeg' | 'auto',
            context: context as 'mobile' | 'desktop' | 'lightbox'
        };

        logger.info(`📱 Getting media for event ${eventId}`, {
            user_id: req.user?._id?.toString(),
            options: {
                ...options,
                user_agent: req.get('User-Agent')?.substring(0, 100)
            }
        });

        // Get user agent for WebP detection
        const userAgent = req.get('User-Agent');
        const response = await getMediaByEventService(eventId, options, userAgent);
        console.log(response)
        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('Error in getMediaByEventController:', error);
        next(error);
    }
};

/**
 * Get media by album ID with enhanced variant support
 */
export const getMediaByAlbumController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { albumId } = req.params;
        const {
            includeProcessing,
            includePending,
            page,
            limit,
            since,
            status,
            cursor,
            scrollType,
            quality,
            format,
            context
        } = req.query;

        // Validate albumId
        if (!albumId || !mongoose.Types.ObjectId.isValid(albumId)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid album ID',
                data: null,
                error: { message: 'A valid album ID is required' },
                other: null
            });
            return;
        }

        // Parse and validate options
        const options = {
            includeProcessing: includeProcessing === 'true',
            includePending: includePending === 'true',
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            since: since as string,
            status: status as any,
            cursor: cursor as string,
            scrollType: scrollType as 'pagination' | 'infinite',
            quality: quality as 'small' | 'medium' | 'large' | 'original' | 'thumbnail' | 'display' | 'full',
            format: format as 'webp' | 'jpeg' | 'auto',
            context: context as 'mobile' | 'desktop' | 'lightbox'
        };

        logger.info(`📁 Getting media for album ${albumId}`, {
            user_id: req.user?._id?.toString(),
            options
        });

        const userAgent = req.get('User-Agent');
        const response = await getMediaByAlbumService(albumId, options, userAgent);

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('Error in getMediaByAlbumController:', error);
        next(error);
    }
};

/**
 * Update single media status
 */
export const updateMediaStatusController: RequestHandler = async (
    req: InjectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { media_id } = req.params;
        const userId = req.user._id.toString();
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

        logger.info('Updating media status:', {
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

        if (response.status && response.data) {
            try {
                const webSocketService = getWebSocketService();
                const eventRoom = `event_${response.data.event_id.toString()}`;

                // Get the number of clients in the event room for debugging
                const roomClients = await webSocketService.io.in(eventRoom).allSockets();
                const clientCount = roomClients.size;

                // Create guest visibility info
                const guestVisibility = {
                    wasVisible: ['approved', 'auto_approved'].includes(response.other?.previousStatus || ''),
                    isVisible: ['approved', 'auto_approved'].includes(status),
                    changed: true
                };

                // Create WebSocket payload
                const statusUpdatePayload: MediaStatusUpdatePayload & {
                    guestVisibility?: {
                        wasVisible: boolean;
                        isVisible: boolean;
                        changed: boolean;
                    };
                } = {
                    mediaId: media_id,
                    eventId: response.data.event_id.toString(),
                    previousStatus: response.other?.previousStatus || 'unknown',
                    newStatus: status,
                    updatedBy: {
                        id: userId,
                        name: 'Admin',
                        type: 'admin'
                    },
                    updatedAt: new Date(),
                    media: {
                        url: response.data.url || response.data.image_variants?.medium?.jpeg?.url || '',
                        thumbnailUrl: response.data.image_variants?.small?.jpeg?.url,
                        filename: response.data.original_filename || 'Unknown',
                        type: response.data.type
                    },
                    guestVisibility
                };

                // Emit to all users in the event
                webSocketService.emitMediaStatusUpdate(statusUpdatePayload);

                logger.info('✅ WebSocket event emitted for media status update:', {
                    mediaId: media_id,
                    eventId: response.data.event_id,
                    newStatus: status,
                    guestVisibilityChanged: guestVisibility.changed,
                    clientsInRoom: clientCount
                });

            } catch (wsError: any) {
                logger.error('❌ Failed to emit WebSocket event:', {
                    error: wsError.message,
                    stack: wsError.stack,
                    mediaId: media_id,
                    eventId: response.data.event_id
                });
            }
        }

        logger.info('Media status updated:', {
            success: response.status,
            previousStatus: response.other?.previousStatus,
            newStatus: response.other?.newStatus
        });

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('Error in updateMediaStatusController:', {
            message: error.message,
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
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            },
            other: null
        });
    }
};

/**
 * Bulk update media status
 */
export const bulkUpdateMediaStatusController: RequestHandler = async (
    req: InjectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();
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

        logger.info('Bulk updating media status:', {
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

        logger.info('Bulk media status update completed:', {
            success: response.status,
            modifiedCount: response.data?.modifiedCount,
            requestedCount: response.data?.requestedCount
        });

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('Error in bulkUpdateMediaStatusController:', {
            message: error.message,
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
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            },
            other: null
        });
    }
};

/**
 * Get media by ID
 */
export const getMediaByIdController: RequestHandler = async (
    req: InjectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { media_id } = req.params;

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

    } catch (error: any) {
        logger.error('Error in getMediaByIdController:', {
            message: error.message,
            params: req.params
        });

        res.status(500).json({
            status: false,
            code: 500,
            message: 'Internal server error',
            data: null,
            error: {
                message: 'An unexpected error occurred',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            },
            other: null
        });
    }
};

/**
 * Delete a media item
 */
export const deleteMediaController: RequestHandler = async (
    req: InjectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { media_id } = req.params;
        const user_id = req.user._id;

        // Validate media_id
        if (!media_id || !mongoose.Types.ObjectId.isValid(media_id)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "Invalid media ID",
                data: null,
                error: { message: "A valid media ID is required" },
                other: null
            });
            return;
        }

        logger.info('Deleting media:', {
            media_id,
            user_id: user_id.toString()
        });

        // Delete the media
        const response = await deleteMediaService(media_id, user_id.toString());
        sendResponse(res, response);
    } catch (error: any) {
        logger.error('Error in deleteMediaController:', error);
        next(error);
    }
};

/**
 * Guest upload media controller with enhanced error handling
 */
export const guestUploadMediaController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { share_token } = req.params;
        const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
        const { guest_name, guest_email, guest_phone } = req.body;

        logger.info('🔍 Guest upload request:', {
            shareToken: share_token,
            fileCount: files.length,
            guestName: guest_name || 'Anonymous',
            guestEmail: guest_email || 'Not provided',
            isAuthenticated: !!req.user,
            userId: req.user?._id?.toString()
        });

        // Validate share token
        if (!share_token) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "Share token is required",
                data: null,
                error: { message: "Missing share token parameter" },
                other: null
            });
            return;
        }

        // Validate files
        if (!files || files.length === 0) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "No files provided",
                data: null,
                error: { message: "At least one file is required" },
                other: null
            });
            return;
        }

        // Find event by share token
        const event = await Event.findOne({ share_token });
        if (!event) {
            res.status(404).json({
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: { message: "Invalid share token" },
                other: null
            });
            return;
        }

        logger.info('✅ Event found:', {
            eventId: event._id.toString(),
            title: event.title,
            canUpload: event.permissions?.can_upload,
            requireApproval: event.permissions?.require_approval
        });

        // Check if event allows uploads
        if (!event.permissions?.can_upload) {
            res.status(403).json({
                status: false,
                code: 403,
                message: "Uploads not allowed",
                data: null,
                error: { message: "This event does not allow photo uploads" },
                other: null
            });
            return;
        }

        // Prepare guest information to match your model structure
        const guestInfo = {
            name: guest_name || '',
            email: guest_email || '',
            phone: guest_phone || '',
            sessionId: req.sessionID || '',
            deviceFingerprint: req.ip + '_' + (req.get('User-Agent') || '').slice(0, 50),
            uploadMethod: 'web',
            platformInfo: {
                source: 'web_upload',
                referrer: req.get('Referer') || ''
            }
        };

        // Process uploads
        const results = [];
        const errors = [];

        for (const file of files) {
            try {
                logger.info(`📁 Processing file: ${file.originalname}`);

                const uploadResult = await guestMediaUploadService.uploadGuestMedia(
                    share_token,
                    file,
                    guestInfo,
                    req.user?._id?.toString()
                );

                results.push({
                    filename: file.originalname,
                    ...uploadResult
                });

                logger.info(`✅ Upload result for ${file.originalname}:`, uploadResult);

            } catch (fileError: any) {
                logger.error(`❌ Error uploading ${file.originalname}:`, fileError);
                errors.push({
                    filename: file.originalname,
                    error: fileError.message || 'Upload failed'
                });
            }
        }

        // Calculate summary
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        logger.info('📊 Upload summary:', {
            total: files.length,
            success: successCount,
            failed: failCount
        });

        // Send response
        const response = {
            status: successCount > 0,
            code: successCount > 0 ? 200 : 400,
            message: failCount === 0 ?
                `All ${successCount} file(s) uploaded successfully!` :
                successCount > 0 ?
                    `${successCount} file(s) uploaded, ${failCount} failed` :
                    'All uploads failed',
            data: {
                results,
                errors: errors.length > 0 ? errors : undefined,
                summary: {
                    total: files.length,
                    success: successCount,
                    failed: failCount,
                    pending_approval: results.filter(r => r.approval_status === 'pending').length
                }
            },
            error: errors.length > 0 ? { message: 'Some uploads failed', details: errors } : null,
            other: {
                event_id: event._id.toString(),
                requires_approval: event.permissions?.require_approval,
                uploader_type: req.user ? 'registered_user' : 'guest'
            }
        };

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('💥 Guest upload controller error:', {
            message: error.message,
            stack: error.stack,
            shareToken: req.params.share_token
        });

        res.status(500).json({
            status: false,
            code: 500,
            message: 'Upload failed',
            data: null,
            error: { message: 'Internal server error occurred' },
            other: null
        });
    }
};

/**
 * Get guest media with enhanced variant support
 */
export const getGuestMediaController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { shareToken } = req.params;
        const {
            userEmail,
            authToken,
            page,
            limit,
            since,
            cursor,
            scrollType,
            quality,
            format,
            context
        } = req.query;

        // Validation
        if (!shareToken) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Share token is required',
                data: null,
                error: { message: 'Share token parameter is required' },
                other: null
            });
            return;
        }

        // Guest-friendly options
        const options = {
            page: parseInt(page as string) || 1,
            limit: Math.min(parseInt(limit as string) || 20, 30),
            since: since as string,
            cursor: cursor as string,
            scrollType: (scrollType as string) || 'pagination',
            quality: (quality as string) || 'thumbnail',
            format: (format as string) || 'jpeg',
            context: (context as string) || 'mobile'
        };

        logger.info(`🔗 Guest accessing media:`, {
            shareToken: shareToken.substring(0, 8) + '...',
            limit: options.limit,
            quality: options.quality,
            page: options.page,
            userAgent: req.get('User-Agent')?.substring(0, 50)
        });

        // Get media
        const response = await getGuestMediaService(
            shareToken,
            userEmail as string,
            authToken as string,
            options
        );

        // 🆕 WebSocket Integration - Track guest activity
        if (response.status && response.data?.length > 0) {
            try {
                const webSocketService = getWebSocketService();

                // Track guest viewing activity
                webSocketService.emitGuestActivity({
                    shareToken,
                    eventId: response.other?.eventId,
                    activity: 'view_photos',
                    photoCount: response.data.length,
                    page: options.page,
                    guestInfo: {
                        userAgent: req.get('User-Agent'),
                        ip: req.ip,
                        timestamp: new Date()
                    }
                });

                logger.debug('📊 Guest activity tracked via WebSocket');
            } catch (wsError) {
                // Don't fail the request if WebSocket fails
                logger.warn('⚠️ WebSocket tracking failed (non-critical):', wsError.message);
            }
        }

        // Add debug info in development
        if (process.env.NODE_ENV === 'development' && response.status) {
            response.other = {
                ...response.other,
                debug: {
                    query_executed: true,
                    filters_applied: ['approved_only', 'images_only'],
                    optimization: 'guest_optimized'
                }
            };
        }

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('❌ Error in getGuestMediaController:', error);

        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to get guest media',
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};


/**
 * Get media variants information
 */
export const getMediaVariantsController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { mediaId } = req.params;

        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'A valid media ID is required' },
                other: null
            });
            return;
        }

        const media = await Media.findById(mediaId)
            .select('image_variants processing type url')
            .lean();

        if (!media) {
            res.status(404).json({
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media not found' },
                other: null
            });
            return;
        }

        // Prepare variant information
        const variantInfo = {
            media_id: media._id,
            type: media.type,
            original_url: media.url,
            has_variants: !!media.image_variants,
            processing_status: media.processing?.status,
            variants_generated: media.processing?.variants_generated,
            variants: null as any
        };

        if (media.image_variants) {
            variantInfo.variants = {
                original: media.image_variants.original,
                small: {
                    webp: media.image_variants.small?.webp || null,
                    jpeg: media.image_variants.small?.jpeg || null
                },
                medium: {
                    webp: media.image_variants.medium?.webp || null,
                    jpeg: media.image_variants.medium?.jpeg || null
                },
                large: {
                    webp: media.image_variants.large?.webp || null,
                    jpeg: media.image_variants.large?.jpeg || null
                }
            };
        }

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Media variants retrieved successfully',
            data: variantInfo,
            error: null,
            other: null
        });

    } catch (error: any) {
        logger.error('Error in getMediaVariantsController:', error);
        next(error);
    }
};

/**
 * Batch get optimized URLs for multiple media items
 */
export const getBatchOptimizedUrlsController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { mediaIds, quality, format, context } = req.body;

        if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Media IDs array is required',
                data: null,
                error: { message: 'mediaIds must be a non-empty array' },
                other: null
            });
            return;
        }

        if (mediaIds.length > 100) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Too many media IDs',
                data: null,
                error: { message: 'Maximum 100 media IDs allowed per request' },
                other: null
            });
            return;
        }

        // Get media items
        const mediaItems = await Media.find({
            _id: { $in: mediaIds }
        }).select('image_variants type url').lean();

        const userAgent = req.get('User-Agent');
        const qualityToUse = quality || 'medium';
        const formatToUse = format || 'auto';
        const contextToUse = context || 'desktop';

        // Generate optimized URLs for each media item
        const optimizedUrls = mediaItems.map(item => {
            let optimizedUrl = item.url; // Default to original

            if (item.image_variants && item.type === 'image') {
                // Use the optimization utility function
                optimizedUrl = getOptimizedImageUrlForItem(
                    item,
                    qualityToUse,
                    formatToUse,
                    contextToUse,
                    userAgent
                );
            }

            return {
                media_id: item._id,
                original_url: item.url,
                optimized_url: optimizedUrl,
                has_variants: !!item.image_variants
            };
        });

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Optimized URLs generated successfully',
            data: optimizedUrls,
            error: null,
            other: {
                optimization_settings: {
                    quality: qualityToUse,
                    format: formatToUse,
                    context: contextToUse,
                    webp_supported: userAgent ?
                        /Chrome|Firefox|Edge|Opera/.test(userAgent) && !/Safari/.test(userAgent) :
                        true
                }
            }
        });

    } catch (error: any) {
        logger.error('Error in getBatchOptimizedUrlsController:', error);
        next(error);
    }
};

// Helper function to detect context from user agent
function detectContextFromUserAgent(userAgent?: string): 'mobile' | 'desktop' | 'lightbox' {
    if (!userAgent) return 'desktop';

    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    return mobileRegex.test(userAgent) ? 'mobile' : 'desktop';
}
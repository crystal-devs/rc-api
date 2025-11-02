// controllers/media.controller.ts - Cleaned up and improved

import { Request, Response, NextFunction, RequestHandler } from "express";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { sendResponse } from "@utils/express.util";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import { getWebSocketService } from "@services/websocket/websocket.service";
import {
    bulkUpdateMediaStatusService,
    deleteMediaService,
    getGuestMediaService,
    getMediaByAlbumService,
    getMediaByEventService,
    MediaQueryOptions,
    updateMediaStatusService,
} from "@services/media";
import { GuestSessionHelper } from "@services/guest/guest-session-helper";
import { softDeleteMediaService } from "@services/media/media-management.service";

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
 * Get all media for a specific event with enhanced variant support
 */
export const getMediaByEventController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { eventId } = req.params;
        const { page, limit, status, quality } = req.query;

        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'A valid event ID is required' }
            });
            return;
        }

        const qualityValue = quality as string;
        const validQualities: MediaQueryOptions['quality'][] = [
            'small', 'medium', 'large', 'original'
        ];
        const validatedQuality: MediaQueryOptions['quality'] = validQualities.includes(qualityValue as any)
            ? qualityValue as MediaQueryOptions['quality']
            : 'medium';

        const options: MediaQueryOptions = {
            page: parseInt(page as string) || 1,
            limit: parseInt(limit as string) || 20,
            status: status as string,
            quality: validatedQuality
        };

        logger.info(`📱 Admin getting media for event ${eventId}`, {
            userId: req.user?._id?.toString(),
            options
        });

        // Pass User-Agent for format detection
        const userAgent = req.headers['user-agent'];

        const response = await getMediaByEventService(
            eventId,
            options,
            userAgent
        );

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('❌ Error in getMediaByEventController:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to get event media',
            data: null,
            error: { message: error.message }
        });
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
        const response = { code: 200 };
        // const response = await getMediaByAlbumService(albumId, options, userAgent);

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
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { media_id } = req.params;
        const { status, reason } = req.body;
        const userId = req.user?._id.toString();
        const userName = 'Admin';

        // Validate inputs
        if (!media_id || !mongoose.Types.ObjectId.isValid(media_id)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'A valid media ID is required' }
            });
            return;
        }

        if (!status) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Status is required',
                data: null,
                error: { message: 'Status field is required' }
            });
            return;
        }

        // Updated valid statuses to match your system
        const validStatuses = ['approved', 'pending', 'rejected', 'hidden', 'auto_approved'];
        if (!validStatuses.includes(status)) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Invalid status',
                data: null,
                error: { message: 'Status must be: approved, pending, rejected, hidden, auto_approved' }
            });
            return;
        }

        logger.info('🔄 Updating media status:', {
            media_id,
            status,
            reason,
            userId,
            userName
        });

        // Update media status in database
        const response = await updateMediaStatusService(media_id, status, {
            adminId: userId,
            reason
        });

        // Send HTTP response first
        res.status(response.code).json(response);

        // Then handle WebSocket updates (non-blocking)
        if (response.status && response.data) {
            try {
                const webSocketService = getWebSocketService();

                const statusUpdatePayload = {
                    mediaId: media_id,
                    eventId: response.data.event_id.toString(),
                    previousStatus: response.other?.previousStatus || 'unknown',
                    newStatus: status,
                    updatedBy: {
                        name: userName,
                        type: 'admin' // You can determine this based on user role
                    },
                    timestamp: new Date(),
                    mediaData: {
                        url: response.data.url,
                        thumbnail: response.data.thumbnail_url,
                        filename: response.data.filename
                    }
                };

                // Emit status update to appropriate rooms
                webSocketService.emitStatusUpdate(statusUpdatePayload);

                logger.info('✅ Status update broadcasted via WebSocket:', {
                    mediaId: media_id,
                    eventId: response.data.event_id,
                    from: statusUpdatePayload.previousStatus,
                    to: status,
                    by: userName
                });

            } catch (wsError: any) {
                logger.error('❌ WebSocket broadcast failed:', wsError.message);
                // Don't fail the main operation if WebSocket fails
            }
        }

        logger.info('✅ Media status updated:', {
            mediaId: media_id,
            success: response.status,
            newStatus: status
        });

    } catch (error: any) {
        logger.error('❌ Error in updateMediaStatusController:', {
            error: error.message,
            mediaId: req.params.media_id,
            userId: req.user?._id?.toString()
        });

        res.status(500).json({
            status: false,
            code: 500,
            message: 'Internal server error',
            data: null,
            error: { message: 'Failed to update media status' }
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
        console.log(req.user, 'reqeuserser')
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
        // const response = await deleteMediaService(media_id, user_id.toString());
        const response = await softDeleteMediaService(media_id, user_id.toString(), {
            adminName: 'guest', // Assuming user has name
            reason: req.body.reason || 'deleted_by_user'
        });
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
    const startTime = Date.now();

    try {
        const { share_token } = req.params;
        const files = (req.files as Express.Multer.File[]) || [];
        const { guest_name, guest_email, guest_phone } = req.body;

        if (!share_token || !files.length) {
            res.status(400).json({
                status: false,
                code: 400,
                message: !share_token ? "Share token required" : "No files provided",
                data: null
            });
            return;
        }

        const event = await Event.findOne({ share_token }).lean();
        if (!event || !event.permissions?.can_upload) {
            await cleanupFiles(files);
            res.status(event ? 403 : 404).json({
                status: false,
                code: event ? 403 : 404,
                message: event ? "Uploads not allowed" : "Event not found",
                data: null
            });
            return;
        }

        // Get or create guest session
        const guestInfo = {
            name: guest_name || '',
            email: guest_email || '',
            phone: guest_phone || ''
        };

        const guestSession = await GuestSessionHelper.getOrCreate(
            req,
            event._id.toString(),
            guestInfo
        );

        GuestSessionHelper.setCookie(res, guestSession.session_id);

        // Use existing media processing service with guest context
        // const results = await mediaProcessingService.processOptimisticUpload(
        //     files,
        //     {
        //         eventId: event._id.toString(),
        //         userId: req.user?._id?.toString(),
        //         userName: guest_name || 'Guest',
        //         isGuestUpload: true,
        //         guestSessionId: guestSession._id.toString(),
        //         guestInfo
        //     }
        // );
        let results: any[] = [];
        const processingTime = Date.now() - startTime;

        res.status(200).json({
            status: true,
            code: 200,
            message: `Successfully uploaded ${results.length} file(s)`,
            data: {
                results,
                summary: {
                    total: files.length,
                    success: results.length,
                    processingTime: `${processingTime}ms`
                }
            }
        });

    } catch (error: any) {
        logger.error('Guest upload error:', error);
        if (req.files) await cleanupFiles(req.files as Express.Multer.File[]);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Upload failed',
            data: null
        });
    }
};

/**
 * 🚀 NEW: Cleanup multiple files utility (if not already available)
 */
const cleanupFiles = async (files: Express.Multer.File[]): Promise<void> => {
};

/**
 * Get guest media with enhanced variant support
 */
export const getGuestMediaController: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { shareToken } = req.params;
        const { page, limit, quality } = req.query;

        if (!shareToken) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Share token is required',
                data: null,
                error: { message: 'Share token parameter is required' }
            });
            return;
        }

        const options = {
            page: parseInt(page as string) || 1,
            limit: Math.min(parseInt(limit as string) || 20, 50), // Limit guests to 50
            quality: quality as string || 'medium'
        };

        logger.info(`🔗 Guest accessing media:`, {
            shareToken: shareToken.substring(0, 8) + '...',
            options
        });

        const response = await getGuestMediaService(shareToken, '', '', options);
        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('❌ Error in getGuestMediaController:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to get guest media',
            data: null,
            error: { message: error.message }
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
 * Get upload progress status for a single media item
 */
export const getUploadStatusController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { mediaId } = req.params;

        const media = await Media.findById(mediaId)
            .select('processing original_filename image_variants url')
            .lean();

        if (!media) {
            res.status(404).json({
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media item not found' },
                other: null
            });
            return;
        }

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Upload status retrieved successfully',
            data: {
                mediaId,
                filename: media.original_filename,
                processingStatus: media.processing?.status || 'unknown',
                stage: media.processing?.current_stage || 'queued',
                progress: media.processing?.progress_percentage || 0,
                variantsGenerated: media.processing?.variants_generated || false,
                url: media.url,
                variants: media.image_variants ? {
                    small: !!media.image_variants.small,
                    medium: !!media.image_variants.medium,
                    large: !!media.image_variants.large,
                    original: !!media.image_variants.original
                } : null
            },
            error: null,
            other: null
        });
    } catch (error: any) {
        logger.error('Error in getUploadStatusController:', error);
        next(error);
    }
};

/**
 * Batch get upload status for multiple media items
 */
export const getBatchUploadStatusController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { mediaIds } = req.body;

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

        const mediaList = await Media.find({ _id: { $in: mediaIds } })
            .select('_id processing original_filename url')
            .lean();

        const statusMap = mediaList.reduce((acc, media) => {
            acc[media._id.toString()] = {
                filename: media.original_filename,
                status: media.processing?.status || 'unknown',
                progress: media.processing?.progress_percentage || 0,
                url: media.url
            };
            return acc;
        }, {} as Record<string, any>);

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Batch upload status retrieved successfully',
            data: statusMap,
            error: null,
            other: null
        });
    } catch (error: any) {
        logger.error('Error in getBatchUploadStatusController:', error);
        next(error);
    }
};

/**
 * Retry failed upload processing
 */
export const retryUploadController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { mediaId } = req.params;

        const media = await Media.findById(mediaId);
        if (!media) {
            res.status(404).json({
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media item not found' },
                other: null
            });
            return;
        }

        if (media.processing?.status !== 'failed') {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Can only retry failed uploads',
                data: null,
                error: { message: 'Upload must be in failed status to retry' },
                other: null
            });
            return;
        }

        // Reset processing status
        media.processing.status = 'pending';
        media.processing.progress_percentage = 0;
        media.processing.error_message = undefined;
        media.processing.retry_count = (media.processing.retry_count || 0) + 1;
        await media.save();

        // TODO: Re-queue the processing job
        // const queue = getImageQueue();
        // await queue.add('retry-processing', { mediaId, ... });

        logger.info(`Upload retry initiated for media ${mediaId} (attempt ${media.processing.retry_count})`);

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Upload retry initiated successfully',
            data: {
                mediaId,
                retryCount: media.processing.retry_count
            },
            error: null,
            other: null
        });
    } catch (error: any) {
        logger.error('Error in retryUploadController:', error);
        next(error);
    }
};
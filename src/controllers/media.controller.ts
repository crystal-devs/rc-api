// controllers/media.controller.ts - Cleaned up and improved

import { Request, Response, NextFunction, RequestHandler } from "express";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { sendResponse } from "@utils/express.util";
import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
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
import { getOrCreateDefaultAlbum } from "@services/album";
import { softDeleteMediaService, bulkSoftDeleteMediaService } from "@services/media/media-management.service";
import sharp from "sharp";
import { queueImageProcessing } from "@services/upload/shared/queue-processing.service";
import { unifiedProgressService } from "@services/websocket/unified-progress.service";
import { uploadFileToS3, cleanupFile } from "@utils/file.util";
import { getCachedSignedUrl } from "@utils/cloudfront-url.util";

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
        const { page, limit, status, quality, sub_event_id } = req.query;
        const userId = req.user?._id?.toString();

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

        // Check if user is creator or co-host
        const event = await Event.findById(eventId).select('created_by').lean();
        if (!event) {
            res.status(404).json({
                status: false,
                code: 404,
                message: 'Event not found',
                data: null,
                error: { message: 'Event not found' }
            });
            return;
        }

        let isPrivilegedUser = false;
        if (userId) {
            // Check if user is creator
            if (event.created_by.toString() === userId) {
                isPrivilegedUser = true;
            } else {
                // Check if user is co-host
                const participant = await EventParticipant.findOne({
                    user_id: new mongoose.Types.ObjectId(userId),
                    event_id: new mongoose.Types.ObjectId(eventId),
                    role: 'co_host',
                    status: 'active'
                }).lean();
                if (participant) {
                    isPrivilegedUser = true;
                }
            }
        }

        // If not privileged user, force status to approved
        let effectiveStatus = status as string;
        if (!isPrivilegedUser) {
            effectiveStatus = 'approved';
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
            status: effectiveStatus,
            quality: validatedQuality,
            // Sub-event filter chips: an id, or 'none' for untagged media
            subEventId: typeof sub_event_id === 'string' ? sub_event_id : undefined
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
 * Get media counts by approval status for the moderation tabs
 * (Published/Pending/Rejected/Hidden badges)
 */
export const getEventMediaCountsController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { eventId } = req.params;
        const userId = req.user?._id?.toString();

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

        const event = await Event.findById(eventId).select('created_by').lean();
        if (!event) {
            res.status(404).json({
                status: false,
                code: 404,
                message: 'Event not found',
                data: null,
                error: { message: 'Event not found' }
            });
            return;
        }

        let isPrivilegedUser = event.created_by.toString() === userId;
        if (!isPrivilegedUser && userId) {
            const participant = await EventParticipant.findOne({
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: new mongoose.Types.ObjectId(eventId),
                role: 'co_host',
                status: 'active'
            }).lean();
            isPrivilegedUser = !!participant;
        }

        if (!isPrivilegedUser) {
            res.status(403).json({
                status: false,
                code: 403,
                message: 'Only the event creator or co-hosts can view moderation counts',
                data: null,
                error: { message: 'Permission denied' }
            });
            return;
        }

        const grouped = await Media.aggregate([
            { $match: { event_id: new mongoose.Types.ObjectId(eventId), deletedAt: null } },
            { $group: { _id: '$approval.status', count: { $sum: 1 } } }
        ]);

        const byStatus: Record<string, number> = {};
        grouped.forEach(g => { byStatus[g._id || 'pending'] = g.count; });

        const approved = (byStatus.approved || 0) + (byStatus.auto_approved || 0);
        const pending = byStatus.pending || 0;
        const rejected = byStatus.rejected || 0;
        const hidden = byStatus.hidden || 0;

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Media counts retrieved successfully',
            data: { approved, pending, rejected, hidden, total: approved + pending + rejected + hidden }
        });
    } catch (error: any) {
        logger.error('❌ Error in getEventMediaCountsController:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to get media counts',
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

        // Access gated by mediaAccessMiddleware + authorize('media.approve')

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

        // Note: WebSocket notification for guests (photo_removed / new_photos_available)
        // is handled directly in updateMediaStatusService for reliability.
        // The controller does not need to emit an additional event.

        res.status(response.code).json(response);

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
        const serviceResponse = await bulkUpdateMediaStatusService(event_id, media_ids, status, {
            adminId: userId,
            reason,
            hideReason: hide_reason
        });

        logger.info('Bulk media status update completed:', {
            success: serviceResponse.status,
            modifiedCount: serviceResponse.data?.modifiedCount,
            requestedCount: serviceResponse.data?.requestedCount
        });

        // For bulk operations, return summary data instead of individual media objects
        const response = {
            status: serviceResponse.status,
            code: serviceResponse.code,
            message: serviceResponse.message,
            data: {
                modifiedCount: serviceResponse.data?.modifiedCount || 0,
                requestedCount: serviceResponse.data?.requestedCount || 0,
                eventId: event_id,
                newStatus: status
            },
            error: serviceResponse.error,
            other: serviceResponse.other
        };

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

        // Access gated by mediaAccessMiddleware + authorize('media.delete')
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

        // Guest uploads always land in the event's default album
        const albumResult = await getOrCreateDefaultAlbum(
            event._id.toString(),
            event.created_by.toString()
        );
        if (!albumResult.status || !albumResult.data) {
            await cleanupFiles(files);
            res.status(500).json({
                status: false,
                code: 500,
                message: "Failed to resolve event album",
                data: null
            });
            return;
        }
        const albumId = albumResult.data._id;

        // Process files
        const processPromises = files.map(async (file) => {
            const mediaId = new mongoose.Types.ObjectId();
            let width = 0;
            let height = 0;

            try {
                const metadata = await sharp(file.path).metadata();
                width = metadata.width || 0;
                height = metadata.height || 0;
            } catch (err) {
                logger.warn(`Failed to get metadata for file ${file.originalname}`, err);
            }

            // Upload the actual file to S3 — without this, the media record
            // points at an object that doesn't exist and never renders
            const s3Key = await uploadFileToS3(file, event._id.toString(), mediaId.toString());
            await cleanupFile(file);

            // Initialize progress
            unifiedProgressService.initializeUpload(
                mediaId.toString(),
                event._id.toString(),
                file.originalname,
                file.size
            );

            // Create Media Record
            const media = new Media({
                _id: mediaId,
                upload_id: mediaId.toString(),
                type: file.mimetype.startsWith('video') ? 'video' : 'image',
                event_id: event._id,
                album_id: albumId,
                owner: {
                    type: 'guest',
                    guest_id: guestSession._id.toString(),
                    display_name: guest_name || 'Guest'
                },
                original: {
                    public_id: s3Key,
                    filename: file.originalname,
                    width,
                    height,
                    size_mb: file.size / (1024 * 1024),
                    format: file.mimetype.split('/')[1] || 'jpeg'
                },
                variants: {},
                processing: {
                    status: 'processing', // Optimistic processing
                    stage: 'uploading',
                    progress: 0
                },
                approval: { status: event.permissions?.require_approval ? 'pending' : 'auto_approved' },
                deleteGroup: `event-${event._id.toString()}-upload-${mediaId.toString()}`
            });

            await media.save();

            // Queue processing
            const jobId = await queueImageProcessing(
                file,
                mediaId.toString(),
                event._id.toString(),
                albumId.toString(),
                {
                    userId: 'guest',
                    userName: guest_name || 'Guest',
                    isGuest: true
                }
            );

            if (jobId) {
                media.processing.job_id = jobId;
                await media.save();
            }

            const originalUrl = await getCachedSignedUrl(s3Key);

            return {
                mediaId: mediaId.toString(),
                originalUrl,
                width,
                height,
                approval: media.approval
            };
        });

        const results = await Promise.all(processPromises);
        const processingTime = Date.now() - startTime;

        res.status(200).json({
            status: true,
            code: 200,
            message: `Successfully uploaded ${results.length} file(s)`,
            data: {
                uploads: results,
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
 * Cleanup multiple local (multer temp) files
 */
const cleanupFiles = async (files: Express.Multer.File[]): Promise<void> => {
    await Promise.all(files.map(file => cleanupFile(file)));
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
        const { page, limit, quality, sub_event_id } = req.query;

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
            quality: quality as string || 'medium',
            // Optional per-function view; the gallery otherwise groups client-side
            subEventId: typeof sub_event_id === 'string' ? sub_event_id : undefined
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
            .select('variants processing type original')
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
            original_url: media.original?.public_id || '',
            has_variants: !!media.variants,
            processing_status: media.processing?.status,
            variants_generated: media.processing?.status === 'completed',
            variants: null as any
        };

        if (media.variants) {
            if (media.type === 'image' && media.variants.images) {
                variantInfo.variants = {
                    original: media.original,
                    small: media.variants.images.small || null,
                    medium: media.variants.images.medium || null,
                    large: media.variants.images.large || null
                };
            } else if (media.type === 'video' && media.variants.videos) {
                variantInfo.variants = {
                    original: media.original,
                    p360: media.variants.videos.p360 || null,
                    p720: media.variants.videos.p720 || null,
                    p1080: media.variants.videos.p1080 || null,
                    poster: media.variants.thumbnails?.poster || null,
                    preview: media.variants.thumbnails?.preview || null
                };
            }
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
            .select('processing upload_id variants original')
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
                filename: media.upload_id,
                processingStatus: media.processing?.status || 'unknown',
                stage: media.processing?.stage || 'uploading',
                progress: media.processing?.progress || 0,
                variantsGenerated: media.processing?.status === 'completed',
                url: media.original?.public_id || '',
                variants: media.variants ? {
                    small: media.type === 'image' ? !!media.variants.images?.small : !!media.variants.thumbnails?.preview,
                    medium: media.type === 'image' ? !!media.variants.images?.medium : !!media.variants.videos?.p720,
                    large: media.type === 'image' ? !!media.variants.images?.large : !!media.variants.videos?.p1080,
                    original: !!media.original
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
            .select('_id processing upload_id original')
            .lean();

        const statusMap = mediaList.reduce((acc, media) => {
            acc[media._id.toString()] = {
                filename: media.upload_id,
                status: media.processing?.status || 'unknown',
                progress: media.processing?.progress || 0,
                url: media.original?.public_id || ''
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
 * Bulk soft delete media items
 */
export const bulkSoftDeleteMediaController: RequestHandler = async (
    req: InjectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const userId = req.user._id.toString();
        const { media_ids, reason } = req.body;

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

        // Limit bulk operations
        if (media_ids.length > 100) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Too many items for bulk soft delete',
                data: null,
                error: { message: 'Maximum 100 items can be soft-deleted at once' },
                other: null
            });
            return;
        }

        logger.info('Bulk soft deleting media:', {
            event_id,
            mediaCount: media_ids.length,
            userId
        });

        // Call service
        const response = await bulkSoftDeleteMediaService(event_id, media_ids, userId, {
            adminName: 'Admin',
            reason: reason || 'Bulk soft-deleted by admin'
        });

        logger.info('Bulk soft delete completed:', {
            success: response.status,
            modifiedCount: response.data?.modifiedCount,
            requestedCount: response.data?.requestedCount
        });

        res.status(response.code).json(response);

    } catch (error: any) {
        logger.error('Error in bulkSoftDeleteMediaController:', {
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
        media.processing.progress = 0;
        media.processing.error = '';
        await media.save();

        // TODO: Re-queue the processing job
        // const queue = getImageQueue();
        // await queue.add('retry-processing', { mediaId, ... });

        logger.info(`Upload retry initiated for media ${mediaId}`);

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Upload retry initiated successfully',
            data: {
                mediaId
            },
            error: null,
            other: null
        });
    } catch (error: any) {
        logger.error('Error in retryUploadController:', error);
        next(error);
    }
};
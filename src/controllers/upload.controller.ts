import { Request, Response, NextFunction } from 'express';
import { logger } from '@utils/logger';
import { unifiedProgressService } from '@services/websocket/unified-progress.service';
import mongoose from 'mongoose';

interface AuthenticatedRequest extends Request {
    user: {
        _id: string;
        role?: string;
        name?: string;
    };
    files?: Express.Multer.File[];
}

/**
 * Optimistic Upload Controller - Clean and Simple
 */
export const uploadMediaController = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<Response | void> => {
    const startTime = Date.now();

    try {
        const files = req.files as Express.Multer.File[] || [];
        const { album_id, event_id } = req.body;
        const userId = req.user._id.toString();
        const userName = req.user.name || 'Admin';

        if (!files.length) {
            return res.status(400).json({ status: false, message: 'No files provided' });
        }

        // Import queue service dynamically or ensure strict import at top
        const { queueImageProcessing } = require('@services/upload/shared/queue-processing.service');
        const { Media } = require('@models/media.model');
        const { unifiedProgressService } = require('@services/websocket/unified-progress.service');

        // Initialize progress for each file
        const processPromises = files.map(async (file: any) => {
            const mediaId = new mongoose.Types.ObjectId();

            // Initialize progress tracking
            unifiedProgressService.initializeUpload(
                mediaId.toString(),
                event_id,
                file.originalname,
                file.size
            );

            // Create Media Record
            // Create Media Record
            const media = new Media({
                _id: mediaId,
                upload_id: mediaId.toString(), // Use _id as upload_id for now if not provided
                type: file.mimetype.startsWith('video') ? 'video' : 'image',
                event_id: new mongoose.Types.ObjectId(event_id),
                album_id: new mongoose.Types.ObjectId(album_id),
                owner: {
                    type: 'registered_user',
                    user_id: new mongoose.Types.ObjectId(userId)
                },
                original: {
                    public_id: `upload_${mediaId.toString()}`, // Placeholder, updated after processing
                    filename: file.originalname,
                    width: 0,
                    height: 0,
                    size_mb: file.size / (1024 * 1024),
                    format: file.mimetype.split('/')[1] || 'jpeg'
                },
                variants: {},
                processing: {
                    status: 'pending',
                    stage: 'uploading',
                    progress: 0,
                    job_id: null
                },
                approval: { status: 'pending' },
                deleteGroup: `event-${event_id}-upload-${mediaId.toString()}`
            });

            await media.save();

            // Queue processing
            const jobId = await queueImageProcessing(
                file,
                mediaId.toString(),
                event_id,
                album_id,
                {
                    userId,
                    userName,
                    isGuest: false
                }
            );

            if (jobId) {
                media.processing.job_id = jobId;
                media.processing.status = 'processing';
                await media.save();
            }

            return {
                mediaId: mediaId.toString(),
                filename: file.originalname,
                tempUrl: '', // No temp URL available yet
                status: 'processing'
            };
        });

        const results = await Promise.all(processPromises);

        logger.info(`📊 Upload completed: ${results.length} files processed`);

        const processingTime = Date.now() - startTime;

        return res.status(200).json({
            status: true,
            message: `${results.length} photo${results.length > 1 ? 's' : ''} uploaded!`,
            data: {
                uploads: results.map(upload => ({
                    id: upload.mediaId,
                    filename: upload.filename,
                    status: 'processing',
                    progress: 0
                })),
                processingTime: `${processingTime}ms`
            }
        });

    } catch (error: any) {
        logger.error('Upload failed:', error);
        return res.status(500).json({
            status: false,
            message: error.message || "Upload failed"
        });
    }
};

export const uploads3MediaController = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<Response | void> => {
    // Placeholder for S3 upload controller

};
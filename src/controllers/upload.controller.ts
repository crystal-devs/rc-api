import { Request, Response, NextFunction } from 'express';
import { logger } from '@utils/logger';
import { mediaProcessingService } from '@services/media';
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
export const optimisticUploadController = async (
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

        // Initialize progress for each file
        const uploadPromises = files.map(async (file) => {
            const mediaId = new mongoose.Types.ObjectId().toString();
            
            // Initialize progress tracking
            unifiedProgressService.initializeUpload(
                mediaId,
                event_id,
                file.originalname,
                file.size
            );

            // Simulate upload progress (in production, track actual upload)
            unifiedProgressService.updateUploadProgress(mediaId, file.size, file.size);

            return {
                file,
                mediaId
            };
        });

        const fileData = await Promise.all(uploadPromises);

        // Process using media processing service
        const results = await mediaProcessingService.processOptimisticUpload(
            files,
            {
                eventId: event_id,
                albumId: album_id,
                userId,
                userName,
                isGuestUpload: req.user.role === 'guest'
            }
        );

        // Update preview ready status for each file
        results.forEach(result => {
            unifiedProgressService.updatePreviewProgress(result.mediaId, true);
        });

        const processingTime = Date.now() - startTime;

        return res.status(200).json({
            status: true,
            message: `${results.length} photo${results.length > 1 ? 's' : ''} uploaded!`,
            data: {
                uploads: results.map(upload => ({
                    id: upload.mediaId,
                    filename: upload.filename,
                    tempUrl: upload.tempUrl,
                    status: 'processing',
                    progress: unifiedProgressService.getProgress(upload.mediaId)
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

// 4. services/upload/queue-processing.service.ts (SHARED)
// ====================================

import { getImageQueue } from 'queues/imageQueue';
import { logger } from '@utils/logger';
import { bytesToMB, cleanupFile } from '@utils/file.util';
import type { ProcessingJobData } from '../../guest/guest.types';

export const queueImageProcessing = async (
    file: Express.Multer.File,
    mediaId: string,
    eventId: string,
    albumId: string,
    userInfo: {
        userId: string;
        userName: string;
        isGuest?: boolean;
    }
): Promise<string | null> => {
    const imageQueue = getImageQueue();
    
    if (!imageQueue) {
        logger.warn('No image queue available for upload');
        await cleanupFile(file);
        return null;
    }

    try {
        const fileSizeMB = bytesToMB(file.size);
        const isGuest = userInfo.isGuest || userInfo.userId === 'guest';
        
        const jobData: ProcessingJobData = {
            mediaId: mediaId,
            userId: userInfo.userId,
            userName: userInfo.userName,
            eventId,
            albumId,
            filePath: file.path,
            originalFilename: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            hasPreview: true,
            previewBroadcasted: false,
            isGuestUpload: isGuest
        };

        // Priority: Admin uploads (10-8), Guest uploads (8-3)
        const basePriority = fileSizeMB < 5 ? 8 : 3;
        const priority = isGuest ? Math.max(basePriority - 1, 1) : basePriority;

        const job = await imageQueue.add('process-image', jobData, {
            priority,
            delay: 0,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        logger.info(`✅ Image processing job queued: ${job.id}`, {
            mediaId: mediaId.substring(0, 8) + '...',
            isGuest,
            priority
        });

        return job.id?.toString() || null;

    } catch (queueError) {
        logger.error('Image queue processing error:', queueError);
        await cleanupFile(file);
        throw queueError;
    }
};
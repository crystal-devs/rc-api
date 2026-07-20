// 4. services/upload/queue-processing.service.ts (SHARED)
// ====================================

//import { logger } from '@utils/logger';
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
    // Lambda architecture in use - no local queue needed
    // logger.info(`✅ Image uploaded to S3/DB, awaiting Lambda processing: ${mediaId}`, {
    //     mediaId: mediaId.substring(0, 8) + '...',
    //     isGuest: userInfo.isGuest || userInfo.userId === 'guest'
    // });

    // We don't queue locally anymore, so we return null or a placeholder ID
    return null;
};
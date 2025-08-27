// services/cleanup.service.ts
import cron from 'node-cron';
import { BulkDownloadService } from './media/bulk-download.service';
import { logger } from '@utils/logger';
import { MonitoringService } from '@utils/monitoring';

export class CleanupService {
    
    static initializeBulkDownloadCleanupJobs() {
        // Run cleanup every hour for expired downloads
        cron.schedule('0 * * * *', async () => {
            try {
                logger.info('Starting scheduled cleanup of expired downloads');
                await BulkDownloadService.cleanupExpiredDownloads();
                logger.info('Completed scheduled cleanup');
            } catch (error) {
                logger.error('Bulk download cleanup job failed:', error);
            }
        });

        // Check for stuck jobs every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            try {
                const stuckJobsCount = await MonitoringService.checkStuckJobs();
                if (stuckJobsCount > 0) {
                    logger.warn(`Found and fixed ${stuckJobsCount} stuck download jobs`);
                }
            } catch (error) {
                logger.error('Stuck job monitoring failed:', error);
            }
        });

        logger.info('Bulk download cleanup jobs scheduled');
    }
}
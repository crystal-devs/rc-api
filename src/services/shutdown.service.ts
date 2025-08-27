// services/shutdown.service.ts - Fixed version
import { logger } from '@utils/logger';
import { getImageQueue } from 'queues/imageQueue';
import { BulkDownloadService } from './media/bulk-download.service';
import { redisConnection } from '@configs/redis.config';
import { disconnectFromMongoDB } from '@configs/database.config';
import { getImageWorker } from 'workers/imageWorker';

export class ShutdownService {
    
    static async handleGracefulShutdown(server: any, webSocketService: any) {
        logger.info('Received shutdown signal, starting graceful shutdown...');

        try {
            // Stop accepting new connections
            server.close(async (err: any) => {
                if (err) {
                    logger.error('Error during server shutdown:', err);
                } else {
                    logger.info('HTTP server closed');
                }

                try {
                    // Cleanup bulk download service
                    await BulkDownloadService.cleanup();

                    // Cleanup image processing system
                    await this.cleanupImageProcessing();

                    // Redis cleanup (main connection)
                    await redisConnection.disconnect();
                    logger.info('Redis disconnected');

                    // WebSocket cleanup
                    if (webSocketService) {
                        await webSocketService.cleanup();
                        logger.info('WebSocket cleanup completed');
                    }

                    // MongoDB disconnect
                    await disconnectFromMongoDB();
                    logger.info('MongoDB disconnected gracefully');

                    logger.info('Graceful shutdown completed successfully');
                    process.exit(0);

                } catch (cleanupError) {
                    logger.error('Error during cleanup:', cleanupError);
                    process.exit(1);
                }
            });

        } catch (error) {
            logger.error('Error during shutdown initiation:', error);
            process.exit(1);
        }

        // Force exit after 30 seconds
        setTimeout(() => {
            logger.error('Force shutdown - timeout exceeded');
            process.exit(1);
        }, 30000);
    }

    private static async cleanupImageProcessing() {
        try {
            logger.info('Shutting down image processing system...');

            const imageWorker = getImageWorker();
            const imageQueue = getImageQueue();

            if (imageWorker) {
                await imageWorker.close();
                logger.info('Image worker closed');
            }

            if (imageQueue) {
                await imageQueue.close();
                logger.info('Image queue closed');
            }
        } catch (error) {
            logger.error('Error closing image processing:', error);
        }
    }
}

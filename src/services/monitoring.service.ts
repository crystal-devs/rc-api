// services/monitoring.service.ts
import { logger } from '@utils/logger';
import { MonitoringService } from '@utils/monitoring';
import { getImageQueue } from 'queues/imageQueue';

export class ProductionMonitoringService {
    
    static startMonitoring(webSocketService: any) {
        if (process.env.NODE_ENV !== 'production') {
            return;
        }

        setInterval(async () => {
            try {
                // WebSocket stats
                if (webSocketService) {
                    const stats = webSocketService.getConnectionStats();
                    logger.info('WebSocket Stats:', {
                        ...stats,
                        serverId: process.env.SERVER_ID || 'server-1',
                        timestamp: new Date().toISOString()
                    });
                }

                // Image processing stats
                const imageQueue = getImageQueue();
                if (imageQueue) {
                    const waiting = await imageQueue.getWaiting();
                    const active = await imageQueue.getActive();
                    const completed = await imageQueue.getCompleted();
                    const failed = await imageQueue.getFailed();

                    logger.info('Image Queue Stats:', {
                        waiting: waiting.length,
                        active: active.length,
                        completed: completed.length,
                        failed: failed.length,
                        timestamp: new Date().toISOString()
                    });
                }

                // Bulk download stats
                try {
                    const downloadStats = await MonitoringService.getDownloadStats(24);
                    logger.info('Bulk Download Stats:', {
                        ...downloadStats,
                        timestamp: new Date().toISOString()
                    });

                    const queueHealth = await MonitoringService.getQueueHealth();
                    logger.info('Bulk Download Queue Health:', {
                        ...queueHealth,
                        timestamp: new Date().toISOString()
                    });

                } catch (error) {
                    logger.error('Error getting bulk download stats:', error);
                }

                // Memory usage monitoring
                const memUsage = process.memoryUsage();
                logger.info('Memory Usage:', {
                    rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
                    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
                    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
                    external: `${Math.round(memUsage.external / 1024 / 1024)} MB`,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                logger.error('Error getting service stats:', error);
            }
        }, 60000); // Every minute
    }
}

// services/monitoring.service.ts
import { logger } from '@utils/logger';
import { MonitoringService } from '@utils/monitoring';
import { getImageQueue } from 'queues/imageQueue';

// Security monitoring data
interface SecurityEvent {
    type: string;
    severity: number;
    timestamp: string;
    details: any;
}

class SecurityMonitor {
    private events: SecurityEvent[] = [];
    private readonly MAX_EVENTS = 1000;

    logEvent(type: string, severity: number, details: any) {
        const event: SecurityEvent = {
            type,
            severity,
            timestamp: new Date().toISOString(),
            details
        };

        this.events.push(event);

        // Keep only recent events
        if (this.events.length > this.MAX_EVENTS) {
            this.events = this.events.slice(-this.MAX_EVENTS);
        }

        // Log based on severity
        const logData = { type, severity, ...details };
        if (severity >= 8) {
            logger.error('🚨 CRITICAL SECURITY EVENT', logData);
        } else if (severity >= 6) {
            logger.warn('⚠️ HIGH SECURITY EVENT', logData);
        } else if (severity >= 4) {
            logger.info('ℹ️ MEDIUM SECURITY EVENT', logData);
        } else {
            logger.debug('LOW SECURITY EVENT', logData);
        }
    }

    getEvents(hours: number = 24): SecurityEvent[] {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
        return this.events.filter(event =>
            new Date(event.timestamp) > cutoff
        );
    }

    getSummary(hours: number = 24) {
        const events = this.getEvents(hours);
        return {
            total: events.length,
            critical: events.filter(e => e.severity >= 8).length,
            high: events.filter(e => e.severity >= 6 && e.severity < 8).length,
            medium: events.filter(e => e.severity >= 4 && e.severity < 6).length,
            low: events.filter(e => e.severity < 4).length
        };
    }
}

const securityMonitor = new SecurityMonitor();

// Export for use in other modules
export { securityMonitor };

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

                // Security monitoring summary
                const securitySummary = securityMonitor.getSummary(1); // Last hour
                if (securitySummary.total > 0) {
                    logger.info('Security Events Summary (1h):', {
                        ...securitySummary,
                        timestamp: new Date().toISOString()
                    });
                }

            } catch (error) {
                logger.error('Error getting service stats:', error);
            }
        }, 60000); // Every minute
    }
}

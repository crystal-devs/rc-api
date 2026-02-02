// services/websocket/queue-broadcast.service.ts
// Complete WebSocket service for real-time queue updates

import { getWebSocketService } from './websocket.service';
import { logger } from '@utils/logger';


export interface QueueUpdateData {
    eventId: string;
    mediaId: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'paused';
    stage: string;
    progress: number;
    queuePosition?: number;
    estimatedTime?: number;
    error?: string;
    retryCount?: number;
}

export interface QueueStatsData {
    eventId: string;
    total: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    paused: number;
    averageProcessingTime: number;
    queueThroughput: number;
}

export class QueueBroadcastService {
    private webSocketService: any = null;

    private getWebSocketService() {
        if (!this.webSocketService) {
            try {
                this.webSocketService = getWebSocketService();
            } catch (error) {
                logger.warn('WebSocket service not available for queue broadcasts');
                return null;
            }
        }
        return this.webSocketService;
    }

    /**
     * 📤 Broadcast queue item update
     */
    public broadcastQueueUpdate(data: QueueUpdateData): void {
        try {
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) return;

            const adminRoom = `admin_${data.eventId}`;

            const payload = {
                type: 'queue_update',
                mediaId: data.mediaId,
                eventId: data.eventId,
                status: data.status,
                stage: data.stage,
                progress: data.progress,
                queuePosition: data.queuePosition,
                estimatedTime: data.estimatedTime,
                error: data.error,
                retryCount: data.retryCount,
                timestamp: new Date()
            };

            webSocketService.io.to(adminRoom).emit('queue_update', payload);

            logger.debug(`📤 Queue update broadcasted: ${data.mediaId} - ${data.status} (${data.progress}%)`);

        } catch (error) {
            logger.error('Failed to broadcast queue update:', error);
        }
    }

    /**
     * 📊 Broadcast queue statistics
     */
    public broadcastQueueStats(data: QueueStatsData): void {
        try {
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) return;

            const adminRoom = `admin_${data.eventId}`;

            const payload = {
                type: 'queue_stats',
                eventId: data.eventId,
                stats: {
                    total: data.total,
                    queued: data.queued,
                    processing: data.processing,
                    completed: data.completed,
                    failed: data.failed,
                    paused: data.paused,
                    averageProcessingTime: data.averageProcessingTime,
                    queueThroughput: data.queueThroughput
                },
                timestamp: new Date()
            };

            webSocketService.io.to(adminRoom).emit('queue_stats', payload);

            logger.debug(`📊 Queue stats broadcasted for event ${data.eventId}`);

        } catch (error) {
            logger.error('Failed to broadcast queue stats:', error);
        }
    }

    /**
     * 🚨 Broadcast queue alert
     */
    public broadcastQueueAlert(eventId: string, alert: {
        type: 'high_failure_rate' | 'stuck_jobs' | 'queue_full' | 'processing_slow' | 'worker_error';
        message: string;
        severity: 'warning' | 'error' | 'critical';
        data?: any;
    }): void {
        try {
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) return;

            const adminRoom = `admin_${eventId}`;

            const payload = {
                type: 'queue_alert',
                eventId,
                alert: {
                    ...alert,
                    timestamp: new Date()
                }
            };

            webSocketService.io.to(adminRoom).emit('queue_alert', payload);

            logger.warn(`🚨 Queue alert broadcasted: ${alert.type} - ${alert.message}`);

        } catch (error) {
            logger.error('Failed to broadcast queue alert:', error);
        }
    }

    /**
     * 📈 Broadcast performance metrics
     */
    public broadcastPerformanceMetrics(eventId: string, metrics: {
        currentThroughput: number;
        averageWaitTime: number;
        activeWorkers: number;
        queueBacklog: number;
        errorRate: number;
    }): void {
        try {
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) return;

            const adminRoom = `admin_${eventId}`;

            const payload = {
                type: 'performance_metrics',
                eventId,
                metrics: {
                    ...metrics,
                    timestamp: new Date()
                }
            };

            webSocketService.io.to(adminRoom).emit('performance_metrics', payload);

            logger.debug(`📈 Performance metrics broadcasted for event ${eventId}`);

        } catch (error) {
            logger.error('Failed to broadcast performance metrics:', error);
        }
    }

    /**
     * 🔄 Broadcast batch operation result
     */
    public broadcastBatchOperation(eventId: string, operation: {
        type: 'retry_all' | 'cancel_all' | 'clear_history' | 'pause_all' | 'resume_all';
        affectedCount: number;
        status: 'started' | 'completed' | 'failed';
        message?: string;
        error?: string;
    }): void {
        try {
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) return;

            const adminRoom = `admin_${eventId}`;

            const payload = {
                type: 'batch_operation',
                eventId,
                operation: {
                    ...operation,
                    timestamp: new Date()
                }
            };

            webSocketService.io.to(adminRoom).emit('batch_operation', payload);

            logger.info(`🔄 Batch operation broadcasted: ${operation.type} - ${operation.status}`);

        } catch (error) {
            logger.error('Failed to broadcast batch operation:', error);
        }
    }
}

// Export singleton
export const queueBroadcastService = new QueueBroadcastService();

// ============================================
// services/websocket/queue-monitor.service.ts
// Service to monitor queue health and broadcast alerts
// ============================================

export class QueueMonitorService {
    private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
    private readonly CHECK_INTERVAL = 30000; // 30 seconds
    private readonly HIGH_FAILURE_THRESHOLD = 30; // 30% failure rate
    private readonly STUCK_JOB_THRESHOLD = 300000; // 5 minutes

    /**
     * 🏁 Start monitoring queue health for specific event
     */
    public startMonitoring(eventId: string): void {
        if (this.monitoringIntervals.has(eventId)) {
            this.stopMonitoring(eventId);
        }

        logger.info(`🔍 Starting queue monitoring for event ${eventId}`);

        const interval = setInterval(async () => {
            await this.checkQueueHealth(eventId);
        }, this.CHECK_INTERVAL);

        this.monitoringIntervals.set(eventId, interval);

        // Initial check
        setTimeout(() => this.checkQueueHealth(eventId), 1000);
    }

    /**
     * 🛑 Stop monitoring specific event
     */
    public stopMonitoring(eventId: string): void {
        const interval = this.monitoringIntervals.get(eventId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(eventId);
            logger.info(`🛑 Stopped queue monitoring for event ${eventId}`);
        }
    }

    /**
     * 🛑 Stop all monitoring
     */
    public stopAllMonitoring(): void {
        this.monitoringIntervals.forEach((interval, eventId) => {
            clearInterval(interval);
            logger.info(`🛑 Stopped queue monitoring for event ${eventId}`);
        });
        this.monitoringIntervals.clear();
    }

    /**
     * 🔍 Check queue health and broadcast alerts
     */
    private async checkQueueHealth(eventId: string): Promise<void> {
        // Lambda architecture - skipping local queue health checks
        return;
    }

    private calculateThroughput(completedJobs: any[]): number {
        // Calculate items processed in the last minute
        const oneMinuteAgo = Date.now() - 60000;
        const recentCompletions = completedJobs.filter(job =>
            (job.finishedOn || 0) > oneMinuteAgo
        );
        return recentCompletions.length;
    }

    private calculateAverageWaitTime(activeJobs: any[]): number {
        if (activeJobs.length === 0) return 0;

        const totalWaitTime = activeJobs.reduce((sum, job) => {
            const waitTime = Date.now() - (job.timestamp || Date.now());
            return sum + waitTime;
        }, 0);

        return Math.round(totalWaitTime / activeJobs.length / 1000); // Convert to seconds
    }
}

// Export singleton
export const queueMonitorService = new QueueMonitorService();

// Graceful shutdown
process.on('SIGINT', () => {
    queueMonitorService.stopAllMonitoring();
});

process.on('SIGTERM', () => {
    queueMonitorService.stopAllMonitoring();
});
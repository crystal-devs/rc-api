import { logger } from "@utils/logger";
import { QueueBroadcastService } from "./queue-broadcast.service";
import { getImageQueue } from "queues/imageQueue";

export const queueBroadcastService = new QueueBroadcastService();

// ============================================
// services/websocket/queue-monitor.service.ts
// Service to monitor queue health and broadcast alerts
// ============================================

export class QueueMonitorService {
    private monitoringInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL = 30000; // 30 seconds
    private readonly HIGH_FAILURE_THRESHOLD = 30; // 30% failure rate
    private readonly STUCK_JOB_THRESHOLD = 300000; // 5 minutes

    /**
     * 🏁 Start monitoring queue health
     */
    public startMonitoring(eventId: string): void {
        if (this.monitoringInterval) {
            this.stopMonitoring();
        }

        logger.info(`🔍 Starting queue monitoring for event ${eventId}`);

        this.monitoringInterval = setInterval(async () => {
            await this.checkQueueHealth(eventId);
        }, this.CHECK_INTERVAL);

        // Initial check
        this.checkQueueHealth(eventId);
    }

    /**
     * 🛑 Stop monitoring
     */
    public stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            logger.info('🛑 Stopped queue monitoring');
        }
    }

    /**
     * 🔍 Check queue health and broadcast alerts
     */
    private async checkQueueHealth(eventId: string): Promise<void> {
        try {
            const imageQueue = getImageQueue();
            if (!imageQueue) return;

            // Get queue status
            const [waiting, active, completed, failed, delayed] = await Promise.all([
                imageQueue.getWaiting(),
                imageQueue.getActive(),
                imageQueue.getCompleted(),
                imageQueue.getFailed(),
                imageQueue.getDelayed()
            ]);

            const totalJobs = waiting.length + active.length + completed.length + failed.length;
            const failureRate = totalJobs > 0 ? (failed.length / totalJobs) * 100 : 0;

            // Check for high failure rate
            if (failureRate > this.HIGH_FAILURE_THRESHOLD) {
                queueBroadcastService.broadcastQueueAlert(eventId, {
                    type: 'high_failure_rate',
                    message: `High failure rate detected: ${failureRate.toFixed(1)}%`,
                    severity: 'warning',
                    data: { failureRate, failedJobs: failed.length }
                });
            }

            // Check for stuck jobs
            const stuckJobs = active.filter(job => {
                const jobAge = Date.now() - (job.timestamp || Date.now());
                return jobAge > this.STUCK_JOB_THRESHOLD;
            });

            if (stuckJobs.length > 0) {
                queueBroadcastService.broadcastQueueAlert(eventId, {
                    type: 'stuck_jobs',
                    message: `${stuckJobs.length} jobs appear to be stuck`,
                    severity: 'error',
                    data: { stuckJobIds: stuckJobs.map(j => j.id) }
                });
            }

            // Check queue size
            if (waiting.length > 50) {
                queueBroadcastService.broadcastQueueAlert(eventId, {
                    type: 'queue_full',
                    message: `Queue backlog is high: ${waiting.length} items waiting`,
                    severity: 'warning',
                    data: { backlog: waiting.length }
                });
            }

            // Calculate and broadcast performance metrics
            const currentThroughput = this.calculateThroughput(completed);
            const averageWaitTime = this.calculateAverageWaitTime(active);

            queueBroadcastService.broadcastPerformanceMetrics(eventId, {
                currentThroughput,
                averageWaitTime,
                activeWorkers: active.length,
                queueBacklog: waiting.length,
                errorRate: failureRate
            });

        } catch (error) {
            logger.error('Queue health check failed:', error);
        }
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
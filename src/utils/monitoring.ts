// utils/monitoring.ts - Fixed version

import { BulkDownload } from "@models/bulk-download.model";
import { logger } from "./logger";
import { BulkDownloadService } from "@services/media/bulk-download.service";

interface QueueHealth {
    healthy: boolean;
    error?: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
}

export class MonitoringService {

    /**
     * Get download statistics for monitoring
     */
    static async getDownloadStats(hours: number = 24) {
        try {
            const since = new Date(Date.now() - hours * 60 * 60 * 1000);

            const stats = await BulkDownload.aggregate([
                {
                    $match: {
                        created_at: { $gte: since }
                    }
                },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalSize: { $sum: '$actual_size_mb' },
                        avgProcessingTime: { $avg: '$processing_duration_ms' }
                    }
                }
            ]);

            return {
                period: `Last ${hours} hours`,
                stats: stats.reduce((acc, stat) => {
                    acc[stat._id] = {
                        count: stat.count,
                        totalSizeMB: Math.round((stat.totalSize || 0) * 100) / 100,
                        avgProcessingTimeMs: Math.round(stat.avgProcessingTime || 0)
                    };
                    return acc;
                }, {} as any)
            };
        } catch (error: any) {
            logger.error('Failed to get download stats:', error);
            return {
                period: `Last ${hours} hours`,
                stats: {},
                error: error.message
            };
        }
    }

    /**
     * Check for stuck jobs and alert
     */
    static async checkStuckJobs() {
        try {
            const stuckThreshold = 2 * 60 * 60 * 1000; // 2 hours
            const cutoff = new Date(Date.now() - stuckThreshold);

            const stuckJobs = await BulkDownload.find({
                status: { $in: ['processing', 'queued'] },
                created_at: { $lt: cutoff }
            });

            if (stuckJobs.length > 0) {
                logger.warn(`Found ${stuckJobs.length} stuck download jobs`, {
                    jobIds: stuckJobs.map(job => job.job_id)
                });

                // Mark stuck jobs as failed
                for (const job of stuckJobs) {
                    job.status = 'failed';
                    job.error_message = 'Job stuck - automatically failed';
                    await job.save();
                }
            }

            return stuckJobs.length;
        } catch (error: any) {
            logger.error('Failed to check stuck jobs:', error);
            return 0;
        }
    }

    /**
     * Get queue health metrics
     */
    static async getQueueHealth(): Promise<QueueHealth> {
        try {
            // Pick the right one depending on how BulkDownloadService is implemented
            const queue = BulkDownloadService.downloadQueue;

            if (!queue) {
                return {
                    healthy: false,
                    error: "Queue not initialized",
                    waiting: 0,
                    active: 0,
                    completed: 0,
                    failed: 0,
                };
            }

            const waiting = await queue.getWaiting();
            const active = await queue.getActive();
            const completed = await queue.getCompleted();
            const failed = await queue.getFailed();

            return {
                healthy: active.length < 10 && waiting.length < 50, // Thresholds
                waiting: waiting.length,
                active: active.length,
                completed: completed.length,
                failed: failed.length,
            };
        } catch (error: any) {
            logger.error("Failed to get queue health:", error);
            return {
                healthy: false,
                error: error.message,
                waiting: 0,
                active: 0,
                completed: 0,
                failed: 0,
            };
        }
    }

}


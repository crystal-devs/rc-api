// services/websocket/progress-integration.service.ts
// Integration layer for your existing image worker

import { simpleProgressService } from './simple-progress.service';
import { logger } from '@utils/logger';
import { getImageQueue } from 'queues/imageQueue';

export class ProgressIntegrationService {
    private progressUpdateInterval: NodeJS.Timeout | null = null;

    /**
     * 🚀 Start monitoring a job for progress updates
     */
    async startJobMonitoring(
        jobId: string, 
        mediaId: string, 
        eventId: string,
        filename: string
    ): Promise<void> {
        try {
            const queue = getImageQueue();
            if (!queue) {
                logger.warn('Queue not available for progress monitoring');
                return;
            }

            logger.info(`📊 Starting progress monitoring for job ${jobId}`);

            // Monitor job progress
            const monitorProgress = async () => {
                try {
                    const job = await queue.getJob(jobId);
                    if (!job) {
                        this.stopJobMonitoring();
                        return;
                    }

                    const progress = job.progress;
                    const jobState = await job.getState();

                    logger.debug(`📊 Job ${jobId} progress: ${progress}% - State: ${jobState}`);

                    // Map job progress to our stages
                    let stage: 'uploading' | 'preview_creating' | 'processing' | 'variants_creating' | 'completed';
                    let percentage = typeof progress === 'number' ? progress : 0;

                    switch (jobState) {
                        case 'waiting':
                        case 'delayed':
                            stage = 'processing';
                            percentage = 0;
                            break;
                        case 'active':
                            if (percentage < 20) {
                                stage = 'processing';
                            } else if (percentage < 90) {
                                stage = 'variants_creating';
                            } else {
                                stage = 'variants_creating';
                            }
                            break;
                        case 'completed':
                            stage = 'completed';
                            percentage = 100;
                            this.stopJobMonitoring();
                            break;
                        case 'failed':
                            await simpleProgressService.markFailed(mediaId, eventId, 'Processing failed');
                            this.stopJobMonitoring();
                            return;
                        default:
                            stage = 'processing';
                    }

                    // Send progress update
                    await simpleProgressService.updateProgress({
                        mediaId,
                        eventId,
                        stage,
                        percentage,
                        message: `Processing ${filename}...`,
                        jobId
                    });

                    // If completed, mark as such
                    if (jobState === 'completed') {
                        await simpleProgressService.markCompleted(mediaId, eventId);
                    }

                } catch (error) {
                    logger.error(`Error monitoring job ${jobId}:`, error);
                }
            };

            // Start monitoring every 2 seconds
            this.progressUpdateInterval = setInterval(monitorProgress, 2000);

            // Run immediately
            await monitorProgress();

        } catch (error) {
            logger.error('Failed to start job monitoring:', error);
        }
    }

    /**
     * 🛑 Stop monitoring job progress
     */
    stopJobMonitoring(): void {
        if (this.progressUpdateInterval) {
            clearInterval(this.progressUpdateInterval);
            this.progressUpdateInterval = null;
            logger.debug('📊 Stopped progress monitoring');
        }
    }

    /**
     * 📤 Send initial upload progress
     */
    async sendUploadStarted(mediaId: string, eventId: string, filename: string): Promise<void> {
        await simpleProgressService.updateProgress({
            mediaId,
            eventId,
            stage: 'uploading',
            percentage: 5,
            message: `Starting upload of ${filename}...`
        });
    }

    /**
     * 📤 Send preview ready progress
     */
    async sendPreviewReady(mediaId: string, eventId: string, filename: string): Promise<void> {
        await simpleProgressService.updateProgress({
            mediaId,
            eventId,
            stage: 'preview_creating',
            percentage: 30,
            message: `Preview ready for ${filename}...`
        });
    }

    /**
     * 📤 Send processing started progress
     */
    async sendProcessingStarted(mediaId: string, eventId: string, filename: string, jobId?: string): Promise<void> {
        await simpleProgressService.updateProgress({
            mediaId,
            eventId,
            stage: 'processing',
            percentage: 40,
            message: `Processing ${filename}...`,
            jobId
        });
    }

    /**
     * 📊 Monitor multiple jobs (batch upload)
     */
    async monitorBatchJobs(jobs: Array<{
        jobId: string;
        mediaId: string;
        eventId: string;
        filename: string;
    }>): Promise<void> {
        // For now, monitor each job individually
        // In future, you could implement batch progress monitoring
        for (const job of jobs) {
            setTimeout(() => {
                this.startJobMonitoring(job.jobId, job.mediaId, job.eventId, job.filename);
            }, Math.random() * 1000); // Stagger the monitoring starts
        }
    }

    /**
     * 🧹 Cleanup - call this on server shutdown
     */
    cleanup(): void {
        this.stopJobMonitoring();
    }
}

// Export singleton
export const progressIntegrationService = new ProgressIntegrationService();

// Graceful shutdown
process.on('SIGINT', () => {
    progressIntegrationService.cleanup();
});

process.on('SIGTERM', () => {
    progressIntegrationService.cleanup();
});
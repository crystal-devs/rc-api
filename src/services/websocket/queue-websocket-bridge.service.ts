// services/queue-websocket-bridge.service.ts
import { Queue, Job, QueueEvents } from 'bullmq';
import { getWebSocketService } from '@services/websocket/websocket.service';
import { Media } from '@models/media.model';
import { logger } from '@utils/logger';

export class QueueWebSocketBridge {
    private imageQueue: Queue;
    private queueEvents: QueueEvents;

    constructor(imageQueue: Queue) {
        this.imageQueue = imageQueue;
        this.queueEvents = new QueueEvents(imageQueue.name, {
            connection: (imageQueue as any)?.opts?.connection
        });
        this.setupQueueListeners();
    }

    private setupQueueListeners() {
        // Job becomes active
        this.queueEvents.on('active', async ({ jobId }) => {
            try {
                if (!jobId) return;
                const job = await this.imageQueue.getJob(jobId);
                if (!job) return;
                const { mediaId, eventId, originalFilename } = job.data;

                // Update database
                await Media.findByIdAndUpdate(mediaId, {
                    'processing.status': 'processing',
                    'processing.started_at': new Date()
                });

                // Send WebSocket update
                const wsService = getWebSocketService();
                const adminRoom = `admin_${eventId}`;

                wsService.io.to(adminRoom).emit('upload_progress', {
                    mediaId,
                    filename: originalFilename,
                    stage: 'processing',
                    percentage: 10,
                    message: `Processing ${originalFilename}...`,
                    timestamp: new Date()
                });

                logger.info(`Processing started: ${job.id} - ${originalFilename}`);
            } catch (error) {
                logger.error('Failed to handle job active:', error);
            }
        });

        // Job progress update
        this.queueEvents.on('progress', async ({ jobId, data }) => {
            try {
                if (!jobId) return;
                const job = await this.imageQueue.getJob(jobId);
                if (!job) return;
                const { mediaId, eventId, originalFilename } = job.data;
                let progress = 0;
                if (typeof data === 'number') progress = data;
                else if (data && typeof data === 'object' && 'progress' in (data as Record<string, unknown>)) {
                    const p = (data as Record<string, unknown>).progress;
                    progress = typeof p === 'number' ? p : 0;
                } else {
                    const raw = await job.getProgress();
                    progress = typeof raw === 'number' ? raw : 0;
                }

                // Update database
                await Media.findByIdAndUpdate(mediaId, {
                    'processing.progress_percentage': progress,
                    'processing.last_updated': new Date()
                });

                // Send WebSocket update
                const wsService = getWebSocketService();
                const adminRoom = `admin_${eventId}`;

                wsService.io.to(adminRoom).emit('upload_progress', {
                    mediaId,
                    filename: originalFilename,
                    stage: this.getStageFromProgress(progress),
                    percentage: progress,
                    message: `Processing ${originalFilename}... ${progress}%`,
                    timestamp: new Date()
                });

            } catch (error) {
                logger.error('Failed to handle job progress:', error);
            }
        });

        // Job completed
        this.queueEvents.on('completed', async ({ jobId }) => {
            try {
                if (!jobId) return;
                const job = await this.imageQueue.getJob(jobId);
                if (!job) return;
                const { mediaId, eventId, originalFilename } = job.data;

                // Update database
                await Media.findByIdAndUpdate(mediaId, {
                    'processing.status': 'completed',
                    'processing.progress_percentage': 100,
                    'processing.completed_at': new Date(),
                    'processing.variants_generated': true
                });

                // Send WebSocket updates
                const wsService = getWebSocketService();
                const adminRoom = `admin_${eventId}`;
                const guestRoom = `guest_${eventId}`;

                // To admins
                wsService.io.to(adminRoom).emit('upload_completed', {
                    mediaId,
                    filename: originalFilename,
                    stage: 'completed',
                    percentage: 100,
                    message: `${originalFilename} processing complete!`,
                    timestamp: new Date()
                });

                // To guests (simpler message)
                wsService.io.to(guestRoom).emit('media_ready', {
                    mediaId,
                    message: 'New photo is ready!',
                    timestamp: new Date()
                });

                logger.info(`Processing completed: ${job.id} - ${originalFilename}`);
            } catch (error) {
                logger.error('Failed to handle job completion:', error);
            }
        });

        // Job failed
        this.queueEvents.on('failed', async ({ jobId, failedReason }) => {
            try {
                if (!jobId) return;
                const job = await this.imageQueue.getJob(jobId);
                if (!job) return;
                const error = new Error(failedReason || 'Unknown error');
                const { mediaId, eventId, originalFilename } = job.data;

                // Update database
                await Media.findByIdAndUpdate(mediaId, {
                    'processing.status': 'failed',
                    'processing.error_message': error.message,
                    'processing.completed_at': new Date()
                });

                // Send WebSocket update
                const wsService = getWebSocketService();
                const adminRoom = `admin_${eventId}`;

                wsService.io.to(adminRoom).emit('upload_failed', {
                    mediaId,
                    filename: originalFilename,
                    error: error.message,
                    timestamp: new Date()
                });

                logger.error(`Processing failed: ${job.id} - ${originalFilename} - ${error.message}`);
            } catch (error) {
                logger.error('Failed to handle job failure:', error);
            }
        });

        logger.info('Queue WebSocket bridge listeners setup complete');
    }

    private getStageFromProgress(progress: number): string {
        if (progress < 30) return 'processing';
        if (progress < 70) return 'variants_creating';
        if (progress < 90) return 'finalizing';
        return 'completed';
    }
}

// Initialize and export
let queueWebSocketBridge: QueueWebSocketBridge | null = null;

export const initializeQueueWebSocketBridge = (imageQueue: Queue) => {
    queueWebSocketBridge = new QueueWebSocketBridge(imageQueue);
    return queueWebSocketBridge;
};

export const getQueueWebSocketBridge = () => queueWebSocketBridge;
// services/websocket/simple-progress.service.ts

import { getWebSocketService } from './websocket.service';
import { Media } from '@models/media.model';
import type { MediaDocument } from '@models/media.model';
import { logger } from '@utils/logger';

export interface ProgressUpdate {
    mediaId: string;
    eventId: string;
    stage: 'uploading' | 'preview_creating' | 'processing' | 'variants_creating' | 'completed';
    percentage: number;
    message?: string;
    jobId?: string;
}

export class SimpleProgressService {
    private webSocketService: any = null;

    private getWebSocketService() {
        if (!this.webSocketService) {
            try {
                this.webSocketService = getWebSocketService();
            } catch (error) {
                logger.warn('WebSocket service not available yet:', error.message);
                return null;
            }
        }
        return this.webSocketService;
    }

    /**
     * 📤 Update progress and broadcast to WebSocket
     */
    async updateProgress(data: ProgressUpdate): Promise<void> {
        try {
            // Update database with proper typing
            const media = await Media.findById(data.mediaId) as MediaDocument | null;
            if (media) {
                await media.updateProgress(data.stage, data.percentage);
                if (data.jobId) {
                    await media.setJobId(data.jobId);
                }
            }

            // Get WebSocket service safely
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) {
                logger.warn('WebSocket service not available, skipping broadcast');
                return;
            }

            // Broadcast to admin room
            const adminRoom = `admin_${data.eventId}`;
            const payload = {
                mediaId: data.mediaId,
                eventId: data.eventId,
                stage: data.stage,
                percentage: data.percentage,
                message: data.message || this.getStageMessage(data.stage, data.percentage),
                timestamp: new Date()
            };

            webSocketService.io.to(adminRoom).emit('upload_progress', payload);

            // Broadcast to guests only for final stages
            if (['completed'].includes(data.stage)) {
                const guestRoom = `guest_${data.eventId}`;
                webSocketService.io.to(guestRoom).emit('media_ready', {
                    mediaId: data.mediaId,
                    eventId: data.eventId,
                    message: 'New photo is ready!',
                    timestamp: new Date()
                });
            }

            logger.info(`📤 Progress updated: ${data.mediaId.substring(0, 8)} - ${data.stage} (${data.percentage}%)`);

        } catch (error) {
            logger.error('Failed to update progress:', error);
        }
    }

    /**
     * 📤 Mark processing as failed
     */
    async markFailed(mediaId: string, eventId: string, error: string): Promise<void> {
        try {
            const media = await Media.findById(mediaId) as MediaDocument | null;
            if (media) {
                media.processing.status = 'failed';
                media.processing.current_stage = 'completed';
                media.processing.error_message = error;
                media.processing.completed_at = new Date();
                await media.save();
            }

            // Get WebSocket service safely
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) {
                logger.warn('WebSocket service not available for failure broadcast');
                return;
            }

            const adminRoom = `admin_${eventId}`;
            webSocketService.io.to(adminRoom).emit('upload_failed', {
                mediaId,
                eventId,
                error,
                timestamp: new Date()
            });

            logger.error(`❌ Processing failed: ${mediaId.substring(0, 8)} - ${error}`);

        } catch (error) {
            logger.error('Failed to mark as failed:', error);
        }
    }

    /**
     * 📤 Mark processing as completed
     */
    async markCompleted(mediaId: string, eventId: string): Promise<void> {
        try {
            const media = await Media.findById(mediaId) as MediaDocument | null;
            if (media) {
                media.processing.status = 'completed';
                media.processing.current_stage = 'completed';
                media.processing.progress_percentage = 100;
                media.processing.completed_at = new Date();
                media.processing.variants_generated = true;
                await media.save();
            }

            await this.updateProgress({
                mediaId,
                eventId,
                stage: 'completed',
                percentage: 100,
                message: 'Processing complete!'
            });

        } catch (error) {
            logger.error('Failed to mark as completed:', error);
        }
    }

    /**
     * 📊 Get progress for multiple media items
     */
    async getBatchProgress(mediaIds: string[]): Promise<any[]> {
        try {
            const mediaList = await Media.find({ _id: { $in: mediaIds } })
                .select('processing original_filename')
                .lean();

            return mediaList.map(media => ({
                mediaId: media._id,
                filename: media.original_filename,
                stage: media.processing.current_stage,
                percentage: media.processing.progress_percentage,
                status: media.processing.status,
                jobId: media.processing.job_id
            }));

        } catch (error) {
            logger.error('Failed to get batch progress:', error);
            return [];
        }
    }

    private getStageMessage(stage: string, percentage: number): string {
        const messages: Record<string, string> = {
            'uploading': `Uploading... ${percentage}%`,
            'preview_creating': 'Creating preview...',
            'processing': `Processing... ${percentage}%`,
            'variants_creating': 'Creating optimized versions...',
            'completed': 'Complete!'
        };
        return messages[stage] || `Processing... ${percentage}%`;
    }
}

// Export singleton
export const simpleProgressService = new SimpleProgressService();
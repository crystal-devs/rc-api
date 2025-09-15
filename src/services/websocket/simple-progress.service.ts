// services/websocket/simple-progress.service.ts - With Circuit Breaker
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
    filename?: string;
}

export class SimpleProgressService {
    private webSocketService: any = null;
    private lastUpdates: Map<string, { stage: string; percentage: number; timestamp: number }> = new Map();
    private completedItems: Set<string> = new Set(); // Circuit breaker for completed items
    private readonly THROTTLE_MS = 1000; // Increased to 1 second
    private readonly MIN_PROGRESS_DIFF = 10; // Increased to 10%
    private readonly COMPLETION_LOCKOUT_MS = 30000; // 30 seconds lockout after completion

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
     * Check if item is already completed (circuit breaker)
     */
    private isCompleted(mediaId: string): boolean {
        return this.completedItems.has(mediaId);
    }

    /**
     * Check if we should send this update (prevent spam)
     */
    private shouldSendUpdate(mediaId: string, stage: string, percentage: number): boolean {
        // CIRCUIT BREAKER: Never send updates for completed items
        if (this.isCompleted(mediaId)) {
            logger.debug(`Skipping update for completed item: ${mediaId.substring(0, 8)}`);
            return false;
        }

        const lastUpdate = this.lastUpdates.get(mediaId);
        const now = Date.now();

        // Always send the FIRST completion update, then block all others
        if (stage === 'completed' || percentage === 100) {
            if (!lastUpdate || (lastUpdate.stage !== 'completed' && lastUpdate.percentage !== 100)) {
                return true; // First completion update
            } else {
                logger.debug(`Blocking duplicate completion update: ${mediaId.substring(0, 8)}`);
                return false; // Duplicate completion update
            }
        }

        // If no previous update, send it
        if (!lastUpdate) {
            return true;
        }

        // Check if enough time has passed
        if (now - lastUpdate.timestamp < this.THROTTLE_MS) {
            return false;
        }

        // Check if progress changed significantly
        if (Math.abs(percentage - lastUpdate.percentage) < this.MIN_PROGRESS_DIFF) {
            return false;
        }

        // Check if stage changed
        if (stage !== lastUpdate.stage) {
            return true;
        }

        return true;
    }

    /**
     * Update progress and broadcast to WebSocket
     */
    async updateProgress(data: ProgressUpdate): Promise<void> {
        try {
            // Check if we should throttle this update
            if (!this.shouldSendUpdate(data.mediaId, data.stage, data.percentage)) {
                return; // Skip this update
            }

            // Record this update BEFORE processing to prevent race conditions
            this.lastUpdates.set(data.mediaId, {
                stage: data.stage,
                percentage: data.percentage,
                timestamp: Date.now()
            });

            // Mark as completed if this is a completion update
            if (data.stage === 'completed' || data.percentage === 100) {
                this.completedItems.add(data.mediaId);
                
                // Auto-cleanup completed items after lockout period
                setTimeout(() => {
                    this.completedItems.delete(data.mediaId);
                    this.lastUpdates.delete(data.mediaId);
                    logger.debug(`Cleaned up tracking for: ${data.mediaId.substring(0, 8)}`);
                }, this.COMPLETION_LOCKOUT_MS);
            }

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
                filename: data.filename || 'Unknown', // Add filename to payload
                stage: data.stage,
                percentage: data.percentage,
                status: data.stage === 'completed' || data.percentage === 100 ? 'completed' : 'processing',
                message: data.message || this.getStageMessage(data.stage, data.percentage),
                timestamp: new Date().toISOString()
            };

            webSocketService.io.to(adminRoom).emit('upload_progress', payload);

            // Broadcast to guests only for final stages
            if (data.stage === 'completed' || data.percentage === 100) {
                const guestRoom = `guest_${data.eventId}`;
                webSocketService.io.to(guestRoom).emit('media_ready', {
                    mediaId: data.mediaId,
                    eventId: data.eventId,
                    message: 'New photo is ready!',
                    timestamp: new Date().toISOString()
                });
            }

            logger.info(`Progress updated: ${data.mediaId.substring(0, 8)} - ${data.stage} (${data.percentage}%)`);

        } catch (error) {
            logger.error('Failed to update progress:', error);
        }
    }

    /**
     * Mark processing as failed
     */
    async markFailed(mediaId: string, eventId: string, error: string): Promise<void> {
        // Check if already processed
        if (this.isCompleted(mediaId)) {
            return;
        }

        try {
            const media = await Media.findById(mediaId) as MediaDocument | null;
            if (media) {
                media.processing.status = 'failed';
                media.processing.current_stage = 'completed';
                media.processing.error_message = error;
                media.processing.completed_at = new Date();
                await media.save();
            }

            // Mark as completed to prevent further updates
            this.completedItems.add(mediaId);
            this.lastUpdates.set(mediaId, {
                stage: 'completed',
                percentage: 0,
                timestamp: Date.now()
            });

            // Get WebSocket service safely
            const webSocketService = this.getWebSocketService();
            if (!webSocketService) {
                logger.warn('WebSocket service not available for failure broadcast');
                return;
            }

            const adminRoom = `admin_${eventId}`;
            webSocketService.io.to(adminRoom).emit('upload_progress', {
                mediaId,
                eventId,
                stage: 'completed',
                percentage: 0,
                status: 'failed',
                error,
                message: `Processing failed: ${error}`,
                timestamp: new Date().toISOString()
            });

            logger.error(`Processing failed: ${mediaId.substring(0, 8)} - ${error}`);

            // Auto-cleanup
            setTimeout(() => {
                this.completedItems.delete(mediaId);
                this.lastUpdates.delete(mediaId);
            }, this.COMPLETION_LOCKOUT_MS);

        } catch (error) {
            logger.error('Failed to mark as failed:', error);
        }
    }

    /**
     * Mark processing as completed
     */
    async markCompleted(mediaId: string, eventId: string): Promise<void> {
        // Check if already completed
        if (this.isCompleted(mediaId)) {
            logger.debug(`Item already completed: ${mediaId.substring(0, 8)}`);
            return;
        }

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
     * Clear all tracking for an event (cleanup)
     */
    public clearEventTracking(eventId: string): void {
        this.lastUpdates.clear();
        this.completedItems.clear();
        logger.info(`Cleared progress tracking for event: ${eventId}`);
    }

    /**
     * Get debug info
     */
    public getDebugInfo(): any {
        return {
            lastUpdatesCount: this.lastUpdates.size,
            completedItemsCount: this.completedItems.size,
            completedItems: Array.from(this.completedItems).map(id => id.substring(0, 8))
        };
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
// ====================================
// 1. services/websocket/unified-progress.service.ts
// Single source of truth for all progress updates
// ====================================

import { getWebSocketService } from './websocket.service';
import { Media } from '@models/media.model';
import { logger } from '@utils/logger';

export type ProgressStage = 
  | 'queued'
  | 'uploading'
  | 'preview_creating'
  | 'preview_ready'
  | 'processing'
  | 'variants_creating'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'paused';

export interface ProgressData {
  mediaId: string;
  eventId: string;
  filename: string;
  stage: ProgressStage;
  percentage: number;
  message: string;
  estimatedTimeRemaining?: number;
  canPause?: boolean;
  canRetry?: boolean;
  error?: string;
  metadata?: {
    fileSize?: number;
    uploadedBytes?: number;
    variantsCompleted?: number;
    variantsTotal?: number;
  };
}

export class UnifiedProgressService {
  private progressMap: Map<string, ProgressData> = new Map();
  private pausedUploads: Set<string> = new Set();
  private webSocketService: any = null;

  /**
   * Get WebSocket service (lazy load)
   */
  private getWebSocketService() {
    if (!this.webSocketService) {
      try {
        this.webSocketService = getWebSocketService();
      } catch (error) {
        logger.warn('WebSocket service not available');
        return null;
      }
    }
    return this.webSocketService;
  }

  /**
   * Initialize progress tracking for a new upload
   */
  initializeUpload(mediaId: string, eventId: string, filename: string, fileSize?: number): void {
    const progressData: ProgressData = {
      mediaId,
      eventId,
      filename,
      stage: 'queued',
      percentage: 0,
      message: 'Preparing upload...',
      canPause: true,
      canRetry: false,
      metadata: {
        fileSize,
        uploadedBytes: 0,
        variantsCompleted: 0,
        variantsTotal: 6 // small/medium/large × webp/jpeg
      }
    };

    this.progressMap.set(mediaId, progressData);
    this.broadcastProgress(progressData);
  }

  /**
   * Update upload progress (file transfer)
   */
  updateUploadProgress(mediaId: string, uploadedBytes: number, totalBytes: number): void {
    const progress = this.progressMap.get(mediaId);
    if (!progress) return;

    const percentage = Math.round((uploadedBytes / totalBytes) * 30); // Upload is 0-30%
    
    progress.stage = 'uploading';
    progress.percentage = percentage;
    progress.message = `Uploading... ${this.formatBytes(uploadedBytes)} / ${this.formatBytes(totalBytes)}`;
    progress.metadata = {
      ...progress.metadata,
      uploadedBytes
    };

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);
  }

  /**
   * Update preview creation progress
   */
  updatePreviewProgress(mediaId: string, ready: boolean = false): void {
    const progress = this.progressMap.get(mediaId);
    if (!progress) return;

    if (ready) {
      progress.stage = 'preview_ready';
      progress.percentage = 35;
      progress.message = 'Preview ready! Processing high-quality versions...';
    } else {
      progress.stage = 'preview_creating';
      progress.percentage = 32;
      progress.message = 'Creating preview...';
    }

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);
  }

  /**
   * Update processing progress
   */
  updateProcessingProgress(
    mediaId: string, 
    stage: 'processing' | 'variants_creating' | 'finalizing',
    variantsCompleted?: number
  ): void {
    const progress = this.progressMap.get(mediaId);
    if (!progress) return;

    const stagePercentages = {
      'processing': { min: 40, max: 60 },
      'variants_creating': { min: 60, max: 90 },
      'finalizing': { min: 90, max: 95 }
    };

    const range = stagePercentages[stage];
    let percentage = range.min;

    if (stage === 'variants_creating' && variantsCompleted !== undefined) {
      const variantProgress = variantsCompleted / (progress.metadata?.variantsTotal || 6);
      percentage = range.min + Math.round((range.max - range.min) * variantProgress);
      progress.message = `Creating optimized versions... (${variantsCompleted}/6)`;
      progress.metadata = {
        ...progress.metadata,
        variantsCompleted
      };
    } else {
      progress.message = this.getStageMessage(stage);
    }

    progress.stage = stage;
    progress.percentage = percentage;
    progress.canPause = false; // Can't pause during processing

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);
  }

  /**
   * Mark upload as complete
   */
  markComplete(mediaId: string, finalUrl?: string): void {
    const progress = this.progressMap.get(mediaId);
    if (!progress) return;

    progress.stage = 'completed';
    progress.percentage = 100;
    progress.message = 'Upload complete!';
    progress.canPause = false;
    progress.canRetry = false;

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);

    // Clean up after 30 seconds
    setTimeout(() => {
      this.progressMap.delete(mediaId);
    }, 30000);
  }

  /**
   * Mark upload as failed
   */
  markFailed(mediaId: string, error: string, canRetry: boolean = true): void {
    const progress = this.progressMap.get(mediaId);
    if (!progress) return;

    progress.stage = 'failed';
    progress.message = `Failed: ${error}`;
    progress.error = error;
    progress.canPause = false;
    progress.canRetry = canRetry;

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);
  }

  /**
   * Pause an upload
   */
  pauseUpload(mediaId: string): boolean {
    const progress = this.progressMap.get(mediaId);
    if (!progress || !progress.canPause) return false;

    this.pausedUploads.add(mediaId);
    progress.stage = 'paused';
    progress.message = 'Upload paused';
    progress.canPause = false;
    progress.canRetry = true;

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);
    return true;
  }

  /**
   * Resume a paused upload
   */
  resumeUpload(mediaId: string): boolean {
    const progress = this.progressMap.get(mediaId);
    if (!progress || !this.pausedUploads.has(mediaId)) return false;

    this.pausedUploads.delete(mediaId);
    progress.stage = 'uploading';
    progress.message = 'Resuming upload...';
    progress.canPause = true;
    progress.canRetry = false;

    this.progressMap.set(mediaId, progress);
    this.broadcastProgress(progress);
    return true;
  }

  /**
   * Get progress for a specific media
   */
  getProgress(mediaId: string): ProgressData | undefined {
    return this.progressMap.get(mediaId);
  }

  /**
   * Get all progress for an event
   */
  getEventProgress(eventId: string): ProgressData[] {
    const eventProgress: ProgressData[] = [];
    this.progressMap.forEach(progress => {
      if (progress.eventId === eventId) {
        eventProgress.push(progress);
      }
    });
    return eventProgress;
  }

  /**
   * Broadcast progress update via WebSocket
   */
  private broadcastProgress(progress: ProgressData): void {
    const ws = this.getWebSocketService();
    if (!ws) return;

    const adminRoom = `admin_${progress.eventId}`;
    const guestRoom = `guest_${progress.eventId}`;

    // Full details to admin
    ws.io.to(adminRoom).emit('upload_progress', {
      ...progress,
      timestamp: new Date().toISOString()
    });

    // Limited info to guests (only show when ready)
    if (progress.stage === 'preview_ready' || progress.stage === 'completed') {
      ws.io.to(guestRoom).emit('upload_progress', {
        mediaId: progress.mediaId,
        eventId: progress.eventId,
        filename: progress.filename,
        stage: progress.stage,
        percentage: progress.percentage,
        message: progress.stage === 'completed' ? 'New photo available!' : 'Processing...',
        timestamp: new Date().toISOString()
      });
    }

    logger.debug(`Progress broadcast: ${progress.mediaId.substring(0, 8)} - ${progress.stage} (${progress.percentage}%)`);
  }

  /**
   * Helper: Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Helper: Get stage message
   */
  private getStageMessage(stage: string): string {
    const messages: Record<string, string> = {
      'queued': 'Waiting in queue...',
      'uploading': 'Uploading file...',
      'preview_creating': 'Creating preview...',
      'preview_ready': 'Preview ready!',
      'processing': 'Processing image...',
      'variants_creating': 'Creating optimized versions...',
      'finalizing': 'Finalizing...',
      'completed': 'Complete!',
      'failed': 'Upload failed',
      'paused': 'Upload paused'
    };
    return messages[stage] || 'Processing...';
  }
}

// Export singleton
export const unifiedProgressService = new UnifiedProgressService();
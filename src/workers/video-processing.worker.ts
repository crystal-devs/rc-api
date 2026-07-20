import { Worker, Job } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE_NAME } from '@queues/video-processing.queue';
import { processVideo } from '@services/video/video-processing.service';
import { Media } from '@models/media.model';
import { sseService } from '@services/sse/sse.service';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

interface VideoProcessingJobData {
  mediaId: string;
  eventId: string;
  uploadId: string;
  s3Key: string;
}

/**
 * 🎬 Video Processing Worker
 * Extracts a poster frame and produces one compressed 720p (max) playback
 * variant per uploaded video. Low concurrency — ffmpeg is CPU-bound and
 * multiple simultaneous transcodes would starve the rest of the server.
 */
export const startVideoProcessingWorker = () => {
  const worker = new Worker(
    VIDEO_PROCESSING_QUEUE_NAME,
    async (job: Job<VideoProcessingJobData>) => {
      const { mediaId, eventId, uploadId, s3Key } = job.data;
      logger.info(`🎬 Processing video job ${job.id} for media ${mediaId}`);

      try {
        const result = await processVideo(s3Key, eventId, uploadId);

        await Media.findByIdAndUpdate(mediaId, {
          $set: {
            'original.duration': result.durationSeconds,
            'variants.thumbnails.poster': { public_id: result.posterKey },
            'variants.videos.p720': { public_id: result.compressedKey },
            'processing.status': 'completed',
            'processing.stage': 'completed',
            'processing.progress': 100,
          },
        });

        sseService.broadcast(eventId, 'media-processing-complete', {
          mediaId,
          type: 'video',
          timestamp: new Date(),
        });
      } catch (error: any) {
        logger.error(`❌ Video processing failed for media ${mediaId}:`, error);
        await Media.findByIdAndUpdate(mediaId, {
          $set: {
            'processing.status': 'failed',
            'processing.error': error.message || 'Video processing failed',
          },
        });
        throw error;
      }
    },
    {
      connection: {
        url: keys.redisUrl as string,
      },
      concurrency: 1, // ffmpeg is CPU-heavy; one transcode at a time per instance
    }
  );

  worker.on('completed', (job) => {
    logger.info(`✅ Video processing job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`❌ Video processing job ${job?.id} failed:`, err);
  });

  logger.info('👷 Video Processing Worker started and listening for jobs');
  return worker;
};

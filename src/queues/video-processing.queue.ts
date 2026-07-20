import { Queue } from 'bullmq';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

export const VIDEO_PROCESSING_QUEUE_NAME = 'video-processing';

/**
 * 🎬 Video Processing Queue
 * Poster extraction + 720p compression, off the request/event-loop path.
 * ffmpeg jobs are CPU-heavy and can run tens of seconds — concurrency is
 * kept low in the worker rather than here (see video-processing.worker.ts).
 */
export const videoProcessingQueue = new Queue(VIDEO_PROCESSING_QUEUE_NAME, {
  connection: {
    url: keys.redisUrl as string,
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      age: 24 * 3600,
    },
  },
});

logger.info(`🚀 Video Processing Queue initialized: ${VIDEO_PROCESSING_QUEUE_NAME}`);

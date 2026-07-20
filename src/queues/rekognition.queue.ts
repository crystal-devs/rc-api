import { Queue } from 'bullmq';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

// Queue Name
export const REKOGNITION_QUEUE_NAME = 'rekognition-indexing';

/**
 * 🏗️ Rekognition Task Queue
 * Manages background facial indexing with rate limiting to prevent AWS throttling.
 */
export const rekognitionQueue = new Queue(REKOGNITION_QUEUE_NAME, {
  connection: {
    url: keys.redisUrl as string,
  },
  defaultJobOptions: {
    attempts: 3, // Retry 3 times on failure
    backoff: {
      type: 'exponential',
      delay: 5000, // Wait 5s, then 10s, then 20s
    },
    removeOnComplete: true, // Clean up successful jobs
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours for debugging
    },
  },
});

logger.info(`🚀 Rekognition Queue initialized: ${REKOGNITION_QUEUE_NAME}`);

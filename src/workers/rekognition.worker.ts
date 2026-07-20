import { Worker, Job } from 'bullmq';
import { REKOGNITION_QUEUE_NAME } from '@queues/rekognition.queue';
import { rekognitionService } from '@services/aws/rekognition.service';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

interface RekognitionJobData {
  bucket: string;
  key: string;
  mediaId: string;
  eventId: string;
}

/**
 * 👷 Rekognition Worker
 * Processes indexing jobs at a controlled rate (e.g., 5 per second)
 * This prevents AWS ThrottlingExceptions and ensures all photos are indexed.
 */
export const startRekognitionWorker = () => {
  const worker = new Worker(
    REKOGNITION_QUEUE_NAME,
    async (job: Job<RekognitionJobData>) => {
      const { bucket, key, mediaId, eventId } = job.data;
      
      logger.info(`🔍 Processing indexing job ${job.id} for media ${mediaId}`);
      
      await rekognitionService.indexFaces(bucket, key, mediaId, eventId);
    },
    {
      connection: {
        url: keys.redisUrl as string,
      },
      // 🛡️ RATE LIMITING: Process max 5 jobs per second
      limiter: {
        max: 5,
        duration: 1000,
      },
      concurrency: 2, // Process 2 at a time within that limit
    }
  );

  worker.on('completed', (job) => {
    logger.info(`✅ Indexing job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`❌ Indexing job ${job?.id} failed:`, err);
  });

  logger.info('👷 Rekognition Worker started and listening for jobs');
  return worker;
};

// queues/imageQueue.ts - Fixed TypeScript errors

import { Queue, Job } from 'bullmq';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

let imageQueue: Queue | null = null;

export const initializeImageQueue = async (): Promise<Queue> => {
  try {
    // 🚀 OPTIMIZED REDIS CONFIG: Performance-focused settings
    const redisConfig = {
      host: getRedisHost(),
      port: getRedisPort(),
      password: getRedisPassword(),
      
      // 🔧 PERFORMANCE: Connection optimizations
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4, // IPv4 for better performance
      
      // 🔧 MEMORY: Optimize memory usage
      maxLoadingTimeout: 5000,
      connectTimeout: 10000,
      commandTimeout: 5000,
    };

    // 🚀 OPTIMIZED QUEUE: High-performance settings
    imageQueue = new Queue('image-processing', {
      connection: redisConfig,
      
      defaultJobOptions: {
        // 🔧 CLEANUP: Keep queues clean
        removeOnComplete: 20,  // Keep more completed jobs for debugging
        removeOnFail: 10,     // Keep fewer failed jobs
        
        // 🔧 RETRY: Smart retry strategy
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000, // Start with 1 second
        },
        
        // 🔧 PRIORITY: Default priority
        priority: 5,
      }
    });

    // 🔧 CONNECTION: Wait for Redis connection
    await imageQueue.waitUntilReady();

    // 🚀 MONITORING: Essential event handlers (simplified for compatibility)
    imageQueue.on('error', (error: Error) => {
      logger.error('❌ Image queue error:', error);
    });

    // 🔧 NOTE: Some events may not be available depending on BullMQ version
    // Only add event listeners that are guaranteed to exist
    try {
      imageQueue.on('waiting', (job: Job) => {
        logger.debug(`⏳ Job ${job.id} waiting in queue`);
      });
    } catch (e) {
      logger.debug('Waiting event not available in this BullMQ version');
    }

    logger.info('✅ Image processing queue initialized with optimized settings');
    return imageQueue;
    
  } catch (error) {
    logger.error('❌ Failed to initialize image queue:', error);
    throw error;
  }
};

export const getImageQueue = (): Queue | null => {
  return imageQueue;
};

/**
 * 🚀 OPTIONAL: Setup queue monitoring (call this after queue is initialized)
 * This handles the event listener compatibility issues
 */
export const setupQueueMonitoring = (): void => {
  if (!imageQueue) {
    logger.warn('Cannot setup monitoring - queue not initialized');
    return;
  }

  try {
    // Try to add monitoring events with error handling
    const queueEvents = imageQueue as any;
    
    if (typeof queueEvents.on === 'function') {
      // These events might not exist in all BullMQ versions
      try {
        queueEvents.on('completed', (job: any, result: any) => {
          const processingTime = Date.now() - (job.timestamp || Date.now());
          if (processingTime > 30000) {
            logger.warn(`🐌 Slow job completed: ${job.id} took ${processingTime}ms`);
          } else {
            logger.info(`✅ Job ${job.id} completed in ${processingTime}ms`);
          }
        });
      } catch (e) {
        logger.debug('Completed event not available');
      }

      try {
        queueEvents.on('failed', (job: any, err: any) => {
          logger.error(`❌ Job ${job?.id} failed:`, err?.message || err);
        });
      } catch (e) {
        logger.debug('Failed event not available');
      }

      try {
        queueEvents.on('stalled', (jobId: string) => {
          logger.warn(`⚠️ Job ${jobId} stalled - will be retried`);
        });
      } catch (e) {
        logger.debug('Stalled event not available');
      }
    }

    logger.info('✅ Queue monitoring setup completed');
  } catch (error) {
    logger.warn('Could not setup queue monitoring:', error);
  }
};

/**
 * 🚀 UTILITY: Add multiple jobs at once for better performance
 */
export const addBulkJobs = async (jobs: Array<{
  name: string;
  data: any;
  opts?: any;
}>): Promise<void> => {
  if (!imageQueue) {
    logger.warn('Image queue not initialized, cannot add bulk jobs');
    return;
  }

  try {
    await imageQueue.addBulk(jobs);
    logger.info(`✅ Added ${jobs.length} jobs to queue in bulk`);
  } catch (error) {
    logger.error('❌ Failed to add bulk jobs:', error);
    throw error;
  }
};

/**
 * 🚀 MONITORING: Get queue statistics
 */
export const getQueueStats = async () => {
  if (!imageQueue) return null;

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      imageQueue.getWaiting(),
      imageQueue.getActive(),
      imageQueue.getCompleted(),
      imageQueue.getFailed(),
      imageQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length
    };
  } catch (error) {
    logger.error('❌ Failed to get queue stats:', error);
    return null;
  }
};

/**
 * 🚀 MAINTENANCE: Clean up old jobs periodically
 */
export const cleanupOldJobs = async (): Promise<void> => {
  if (!imageQueue) return;

  try {
    // Clean jobs older than 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    await imageQueue.clean(oneDayAgo, 100, 'completed');
    await imageQueue.clean(oneDayAgo, 50, 'failed');
    
    logger.info('🧹 Cleaned up old jobs from queue');
  } catch (error) {
    logger.error('❌ Failed to cleanup old jobs:', error);
  }
};

/**
 * 🛠️ HELPER FUNCTIONS: Parse Redis connection
 */
function getRedisHost(): string {
  const redisUrl = keys.redisUrl as string;
  if (redisUrl?.startsWith('redis://')) {
    try {
      const url = new URL(redisUrl);
      return url.hostname || 'localhost';
    } catch {
      return 'localhost';
    }
  }
  return process.env.REDIS_HOST || 'localhost';
}

function getRedisPort(): number {
  const redisUrl = keys.redisUrl as string;
  if (redisUrl?.startsWith('redis://')) {
    try {
      const url = new URL(redisUrl);
      return parseInt(url.port) || 6379;
    } catch {
      return 6379;
    }
  }
  return parseInt(process.env.REDIS_PORT || '6379');
}

function getRedisPassword(): string | undefined {
  const redisUrl = keys.redisUrl as string;
  if (redisUrl?.startsWith('redis://')) {
    try {
      const url = new URL(redisUrl);
      return url.password || undefined;
    } catch {
      return undefined;
    }
  }
  return process.env.REDIS_PASSWORD || undefined;
}

// 🚀 STARTUP: Auto-cleanup on queue initialization (optional)
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    await cleanupOldJobs();
  }, 60 * 60 * 1000); // Clean every hour
}
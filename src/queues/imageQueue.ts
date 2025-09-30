// queues/imageQueue.ts - FIXED REDIS TIMEOUT ISSUES

import { Queue, Job, Worker } from 'bullmq';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { processOptimisticImage } from './optimisticImageProcessor';

let imageQueue: Queue | null = null;
let imageWorker: Worker | null = null;

export const initializeImageQueue = async (): Promise<Queue> => {
  try {
    // FIXED: Optimized Redis config with proper timeout settings
    const redisConfig: any = {
      host: getRedisHost(),
      port: getRedisPort(),
      password: getRedisPassword(),
      
      // CRITICAL FIXES for timeout issues
      maxRetriesPerRequest: null as any, // CHANGED: null allows unlimited retries per request
      enableReadyCheck: false,     // ADDED: Disable ready check to prevent blocking
      enableOfflineQueue: true,    // ADDED: Queue commands when disconnected
      
      // Connection optimizations
      connectTimeout: 30000,       // INCREASED: 30s for initial connection
      commandTimeout: 30000,       // INCREASED: 30s for commands (was 5s - too short!)
      keepAlive: 30000,
      family: 4,
      
      // Retry strategy - IMPORTANT for handling network issues
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      
      // Reconnect on error
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // Reconnect on READONLY errors
        }
        return false;
      },
      
      // Additional stability settings
      lazyConnect: false, // CHANGED: Connect immediately, not lazily
      autoResubscribe: true,
      autoResendUnfulfilledCommands: true,
    };

    // Log connection attempt
    logger.info('Connecting to Redis with config:', {
      host: redisConfig.host,
      port: redisConfig.port,
      hasPassword: !!redisConfig.password
    });

    // Create queue with fixed configuration
    imageQueue = new Queue('image-processing', {
      connection: redisConfig,
      
      defaultJobOptions: {
        removeOnComplete: {
          count: 50,  // Keep last 50 completed jobs
          age: 24 * 3600 // Remove after 24 hours
        },
        removeOnFail: {
          count: 20,   // Keep last 20 failed jobs
          age: 7 * 24 * 3600 // Remove after 7 days
        },
        
        // Retry strategy
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 seconds (was 1s)
        },
        
        priority: 5,
      }
    });

    // IMPORTANT: Wait for queue to be ready before proceeding
    await imageQueue.waitUntilReady();
    logger.info('Image queue connected and ready');

    // Test Redis connection
    await testRedisConnection(imageQueue);

    // Initialize worker with same fixed config
    imageWorker = new Worker('image-processing', async (job: Job) => {
      const { name, data } = job;
      
      logger.info(`Processing job ${job.id}: ${name}`, {
        mediaId: data.mediaId?.substring(0, 8) + '...',
        filename: data.originalFilename,
        isOptimistic: data.isOptimistic || false
      });

      // Handle different job types
      switch (name) {
        case 'process-image':
        case 'process-optimistic-image':
          return await processOptimisticImage(job);
        
        case 'process-image-variants':
          return await processOptimisticImage(job);
        
        default:
          throw new Error(`Unknown job type: ${name}`);
      }
    }, {
      connection: {
        ...redisConfig,
        // Worker can have slightly different settings
        maxRetriesPerRequest: null as any,
        enableReadyCheck: false,
      },
      concurrency: process.env.NODE_ENV === 'production' ? 5 : 2,
      maxStalledCount: 3,        // INCREASED: Allow more stall recoveries
      stalledInterval: 30000,    // 30 seconds
      lockDuration: 300000,      // ADDED: 5 min lock duration (matches job timeout)
      
      // Auto-run: Start processing immediately
      autorun: true,
    });

    // Wait for worker to be ready
    await imageWorker.waitUntilReady();
    logger.info('Image worker connected and ready');

    // Setup monitoring
    setupOptimisticQueueMonitoring();

    logger.info('Enhanced image processing queue initialized successfully');
    return imageQueue;
    
  } catch (error) {
    logger.error('Failed to initialize image queue:', error);
    throw error;
  }
};

/**
 * Test Redis connection health
 */
async function testRedisConnection(queue: Queue): Promise<void> {
  try {
    // Try to get queue stats as a connection test
    const jobCounts = await queue.getJobCounts();
    logger.info('Redis connection test successful:', jobCounts);
  } catch (error) {
    logger.error('Redis connection test failed:', error);
    throw new Error('Redis connection unhealthy');
  }
}

/**
 * Enhanced queue monitoring for optimistic uploads
 */
function setupOptimisticQueueMonitoring(): void {
  if (!imageQueue || !imageWorker) return;

  // Queue events
  imageQueue.on('error', (error: Error) => {
    logger.error('Image queue error:', error);
  });

  imageQueue.on('waiting', (jobId: string) => {
    logger.debug(`Job ${jobId} waiting in queue`);
  });

  // Worker events - Enhanced for optimistic processing
  imageWorker.on('completed', (job: Job, result: any) => {
    const processingTime = Date.now() - (job.timestamp || Date.now());
    const isOptimistic = job.data?.isOptimistic || false;
    const jobType = isOptimistic ? 'optimistic' : 'regular';
    
    if (processingTime > 30000) {
      logger.warn(`Slow ${jobType} job completed: ${job.id} took ${processingTime}ms`, {
        filename: job.data?.originalFilename,
        mediaId: job.data?.mediaId?.substring(0, 8) + '...'
      });
    } else {
      logger.info(`${jobType.charAt(0).toUpperCase() + jobType.slice(1)} job completed: ${job.id} in ${processingTime}ms`, {
        filename: job.data?.originalFilename,
        mediaId: job.data?.mediaId?.substring(0, 8) + '...'
      });
    }
  });

  imageWorker.on('failed', (job: Job | undefined, err: Error) => {
    const isOptimistic = job?.data?.isOptimistic || false;
    const jobType = isOptimistic ? 'optimistic' : 'regular';
    
    logger.error(`${jobType.charAt(0).toUpperCase() + jobType.slice(1)} job failed: ${job?.id}`, {
      error: err.message,
      stack: err.stack,
      filename: job?.data?.originalFilename,
      mediaId: job?.data?.mediaId?.substring(0, 8) + '...',
      attempts: job?.attemptsMade || 0
    });
  });

  imageWorker.on('stalled', (jobId: string) => {
    logger.warn(`Job ${jobId} stalled - will be retried`);
  });

  imageWorker.on('progress', (job: Job, progress: number | object) => {
    const isOptimistic = job.data?.isOptimistic || false;
    
    if (isOptimistic) {
      logger.debug(`Optimistic job progress: ${job.id} - ${JSON.stringify(progress)}`, {
        filename: job.data?.originalFilename,
        mediaId: job.data?.mediaId?.substring(0, 8) + '...'
      });
    }
  });

  // ADDED: Worker error events
  imageWorker.on('error', (error: Error) => {
    logger.error('Worker error:', error);
  });

  logger.info('Enhanced queue monitoring setup completed');
}

export const getImageQueue = (): Queue | null => {
  return imageQueue;
};

/**
 * Add optimistic job with higher priority
 */
export const addOptimisticJob = async (
  jobName: string,
  jobData: any,
  options: any = {}
): Promise<Job | null> => {
  if (!imageQueue) {
    logger.warn('Image queue not initialized, cannot add optimistic job');
    return null;
  }

  try {
    // ADDED: Wait for queue to be ready
    try {
      await imageQueue.waitUntilReady();
    } catch (waitError) {
      logger.warn('Queue may not be fully ready, proceeding anyway');
    }

    const job = await imageQueue.add(jobName, {
      ...jobData,
      isOptimistic: true
    }, {
      priority: 10,
      delay: 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      ...options
    });

    logger.info(`Added optimistic job: ${job.id} for ${jobData.originalFilename}`);
    return job;
  } catch (error) {
    logger.error('Failed to add optimistic job:', error);
    throw error;
  }
};

/**
 * Add multiple optimistic jobs at once for better performance
 */
export const addBulkOptimisticJobs = async (jobs: Array<{
  name: string;
  data: any;
  opts?: any;
}>): Promise<void> => {
  if (!imageQueue) {
    logger.warn('Image queue not initialized, cannot add bulk optimistic jobs');
    return;
  }

  try {
    const optimisticJobs = jobs.map(job => ({
      ...job,
      data: {
        ...job.data,
        isOptimistic: true
      },
      opts: {
        priority: 8,
        delay: 0,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        ...job.opts
      }
    }));

    await imageQueue.addBulk(optimisticJobs);
    logger.info(`Added ${jobs.length} optimistic jobs to queue in bulk`);
  } catch (error) {
    logger.error('Failed to add bulk optimistic jobs:', error);
    throw error;
  }
};

/**
 * Get enhanced queue statistics
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

    const optimisticWaiting = waiting.filter(job => job.data?.isOptimistic);
    const regularWaiting = waiting.filter(job => !job.data?.isOptimistic);
    
    const optimisticActive = active.filter(job => job.data?.isOptimistic);
    const regularActive = active.filter(job => !job.data?.isOptimistic);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length,
      breakdown: {
        optimistic: {
          waiting: optimisticWaiting.length,
          active: optimisticActive.length
        },
        regular: {
          waiting: regularWaiting.length,
          active: regularActive.length
        }
      }
    };
  } catch (error) {
    logger.error('Failed to get enhanced queue stats:', error);
    return null;
  }
};

/**
 * Enhanced cleanup for old jobs
 */
export const cleanupOldJobs = async (): Promise<void> => {
  if (!imageQueue) return;

  try {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    await imageQueue.clean(oneDayAgo, 100, 'completed');
    await imageQueue.clean(oneDayAgo, 50, 'failed');
    
    logger.info('Cleaned up old jobs from enhanced queue');
  } catch (error) {
    logger.error('Failed to cleanup old jobs from enhanced queue:', error);
  }
};

/**
 * Graceful shutdown of queue and worker
 */
export const shutdownImageQueue = async (): Promise<void> => {
  try {
    logger.info('Shutting down image processing system...');
    
    if (imageWorker) {
      await imageWorker.close();
      logger.info('Image worker closed');
    }
    
    if (imageQueue) {
      await imageQueue.close();
      logger.info('Image queue closed');
    }
  } catch (error) {
    logger.error('Error during queue shutdown:', error);
  }
};

/**
 * HELPER FUNCTIONS: Parse Redis connection
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

// AUTO-CLEANUP: Enhanced cleanup on queue initialization
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    await cleanupOldJobs();
  }, 60 * 60 * 1000); // Clean every hour
}

// Graceful shutdown handling
process.on('SIGTERM', shutdownImageQueue);
process.on('SIGINT', shutdownImageQueue);
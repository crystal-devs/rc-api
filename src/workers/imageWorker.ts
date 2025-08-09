// queues/imageWorker.ts - Fixed to work with your existing Media model

import { Job, Worker } from 'bullmq';
import { ImageProcessingJobData } from 'types/queue';
import { logger } from '@utils/logger';
import { keys } from '@configs/dotenv.config';
import { Media } from '@models/media.model';
import { imageProcessingService } from '@services/imageProcessing.service';

let imageWorkerInstance: Worker | null = null;

export const initializeImageWorker = async (): Promise<Worker> => {
  try {
    // 🚀 REDIS CONFIG: Same as queue for consistency
    const redisConfig = {
      host: getRedisHost(),
      port: getRedisPort(),
      password: getRedisPassword(),
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4,
    };

    imageWorkerInstance = new Worker(
      'image-processing',
      async (job: Job<ImageProcessingJobData>) => {
        const startTime = Date.now();
        const { mediaId, originalFilename } = job.data;
        
        logger.info(`🔄 Starting processing: ${originalFilename} (${mediaId})`);
        
        try {
          // 🚀 STEP 1: Update status to processing (5%)
          await Media.findByIdAndUpdate(mediaId, {
            'processing.status': 'processing',
            'processing.started_at': new Date(),
          });
          await job.updateProgress(5);

          // 🚀 STEP 2: Process the image (10-90%)
          const result = await imageProcessingService.processImage(job.data);
          await job.updateProgress(90);

          // 🚀 STEP 3: Update database with results (95%)
          const processingTime = Date.now() - startTime;
          
          // 🔧 COMPATIBLE: Work with your existing schema structure
          const updateData: any = {
            url: result.original.url, // Keep legacy URL field
            'metadata.width': result.original.width,
            'metadata.height': result.original.height,
            'metadata.aspect_ratio': result.original.height / result.original.width,
            'processing.status': 'completed',
            'processing.completed_at': new Date(),
            'processing.processing_time_ms': processingTime,
            'processing.variants_generated': true,
            'processing.variants_count': calculateVariantsCount(result.variants),
            'processing.total_variants_size_mb': calculateTotalVariantsSize(result.variants),
          };

          // 🔧 HANDLE VARIANTS: Your schema expects small/medium/large structure
          if (result.variants) {
            // The service returns small/medium/large, so we can use them directly
            const mappedVariants = {
              original: {
                url: result.original.url,
                width: result.original.width,
                height: result.original.height,
                size_mb: result.original.size_mb,
                format: result.original.format
              },
              small: {
                webp: result.variants.small?.webp || null,
                jpeg: result.variants.small?.jpeg || null
              },
              medium: {
                webp: result.variants.medium?.webp || null,
                jpeg: result.variants.medium?.jpeg || null
              },
              large: {
                webp: result.variants.large?.webp || null,
                jpeg: result.variants.large?.jpeg || null
              }
            };
            
            updateData.image_variants = mappedVariants;
          }
          
          await Media.findByIdAndUpdate(mediaId, updateData);
          await job.updateProgress(100);

          logger.info(`✅ Processing completed: ${originalFilename} in ${processingTime}ms`);
          
          return {
            success: true,
            mediaId,
            processingTime,
            variants: calculateVariantsCount(result.variants),
            originalUrl: result.original.url
          };

        } catch (error: any) {
          const processingTime = Date.now() - startTime;
          logger.error(`❌ Processing failed: ${originalFilename} after ${processingTime}ms:`, error);
          
          // 🔧 UPDATE FAILURE STATUS
          await Media.findByIdAndUpdate(mediaId, {
            'processing.status': 'failed',
            'processing.completed_at': new Date(),
            'processing.processing_time_ms': processingTime,
            'processing.error_message': error.message || 'Unknown processing error',
            'processing.retry_count': job.attemptsMade || 0,
          });

          throw error;
        }
      },
      {
        connection: redisConfig,
        
        // 🚀 CONCURRENCY: Process multiple images simultaneously
        concurrency: getConcurrencyLevel(),
      }
    );

    // 🚀 EVENT HANDLERS: Essential monitoring with proper typing
    imageWorkerInstance.on('completed', (job: Job, result: any) => {
      const processingTime = Date.now() - job.timestamp;
      logger.info(`✅ Worker completed job ${job.id} in ${processingTime}ms`);
      
      // 🔧 ALERT: Log very slow jobs
      if (processingTime > 60000) { // 1 minute
        logger.warn(`🐌 Very slow job: ${job.id} took ${(processingTime/1000).toFixed(1)}s`);
      }
    });

    imageWorkerInstance.on('failed', (job: Job | undefined, err: Error) => {
      logger.error(`❌ Worker failed job ${job?.id}:`, {
        error: err.message,
        attempts: job?.attemptsMade,
        data: job?.data?.originalFilename
      });
    });

    imageWorkerInstance.on('progress', (job: Job, progress: number | object) => {
      if (typeof progress === 'number' && progress % 25 === 0) { // Log every 25%
        logger.debug(`📊 Job ${job.id} progress: ${progress}%`);
      }
    });

    imageWorkerInstance.on('stalled', (jobId: string) => {
      logger.warn(`⚠️ Job ${jobId} stalled - will be retried`);
    });

    logger.info(`✅ Image worker initialized with concurrency: ${getConcurrencyLevel()}`);
    return imageWorkerInstance;

  } catch (error) {
    logger.error('❌ Failed to initialize image worker:', error);
    throw error;
  }
};

export const getImageWorker = (): Worker | null => {
  return imageWorkerInstance;
};

/**
 * 🚀 PERFORMANCE: Dynamic concurrency based on system resources
 */
function getConcurrencyLevel(): number {
  try {
    // Base concurrency on available CPU cores and memory
    const cpuCores = require('os').cpus().length;
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);
    
    // Conservative approach: 1-2 jobs per CPU core, limited by memory
    let concurrency = Math.max(1, Math.floor(cpuCores * 1.5));
    
    // Limit based on available memory (assume 512MB per job)
    const memoryBasedLimit = Math.floor(totalMemoryGB * 2);
    concurrency = Math.min(concurrency, memoryBasedLimit);
    
    // Environment override
    if (process.env.IMAGE_WORKER_CONCURRENCY) {
      concurrency = parseInt(process.env.IMAGE_WORKER_CONCURRENCY);
    }
    
    // Sensible limits
    return Math.max(1, Math.min(concurrency, 8)); // 1-8 concurrent jobs
  } catch (error) {
    logger.warn('Could not determine optimal concurrency, using default of 3');
    return 3;
  }
}

/**
 * 🚀 UTILITY: Calculate variants count efficiently (compatible with your schema)
 */
function calculateVariantsCount(variants: any): number {
  if (!variants || typeof variants !== 'object') return 0;
  
  let count = 0;
  // Count based on small/medium/large structure (matching service output)
  if (variants.small) {
    if (variants.small.webp) count++;
    if (variants.small.jpeg) count++;
  }
  if (variants.medium) {
    if (variants.medium.webp) count++;
    if (variants.medium.jpeg) count++;
  }
  if (variants.large) {
    if (variants.large.webp) count++;
    if (variants.large.jpeg) count++;
  }
  return count;
}

/**
 * 🚀 UTILITY: Calculate total variants size efficiently
 */
function calculateTotalVariantsSize(variants: any): number {
  if (!variants || typeof variants !== 'object') return 0;

  let total = 0;
  
  // Calculate based on small/medium/large structure (matching service output)
  ['small', 'medium', 'large'].forEach(size => {
    if (variants[size]) {
      if (variants[size].webp?.size_mb) total += variants[size].webp.size_mb;
      if (variants[size].jpeg?.size_mb) total += variants[size].jpeg.size_mb;
    }
  });
  
  return Math.round(total * 100) / 100;
}

/**
 * 🛠️ HELPER FUNCTIONS: Same as queue
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
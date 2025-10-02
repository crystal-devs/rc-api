// workers/batchStorageCleanupWorker.ts - PRODUCTION READY

import { Job, Worker, Queue } from 'bullmq';
import { logger } from '@utils/logger';
import { imagekit } from '@configs/imagekit.config';
import { FileObject } from 'imagekit/dist/libs/interfaces';
import { RedisConfigUtil } from '@utils/redis.util';

// Types
interface StorageCleanupJobData {
  mediaId: string;
  urls: string[];
  eventId: string;
  userId: string;
  isBulk?: boolean;
}

interface CleanupResult {
  mediaId: string;
  totalFiles: number;
  deletedFiles: number;
  failedFiles: string[];
  alreadyDeleted: number;
  processingTimeMs: number;
  batchesProcessed: number;
}

// Configuration
const BATCH_CONFIG = {
  BATCH_SIZE: 5, // Start with 5, can increase to 50+
  MAX_CONCURRENT_DELETIONS: 5, // Process 5 files concurrently per batch
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000
};

/**
 * Normalize ImageKit URL by removing query parameters
 */
function normalizeImageKitUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  } catch (error) {
    return url;
  }
}

/**
 * Production-grade ImageKit batch file manager
 */
class ProductionBatchFileManager {
  
  /**
   * Create normalized URL mapping for an event
   */
  private async createUrlMapping(eventId: string): Promise<Map<string, string>> {
    const urlToFileId = new Map<string, string>();
    
    const searchPaths = [
      `events/${eventId}/originals`,
      `events/${eventId}/variants/small`,
      `events/${eventId}/variants/medium`, 
      `events/${eventId}/variants/large`,
      `events/${eventId}/previews`
    ];

    for (const path of searchPaths) {
      try {
        let skip = 0;
        const limit = 1000;
        
        while (skip < 10000) { // Safety limit
          const files = await imagekit.listFiles({
            path,
            limit,
            skip,
            includeFolder: false
          });

          if (files.length === 0) break;

          const fileObjects = files.filter((item): item is FileObject =>
            item && 'fileId' in item && 'url' in item && item.type === 'file'
          );

          fileObjects.forEach(file => {
            const normalizedUrl = normalizeImageKitUrl(file.url);
            urlToFileId.set(normalizedUrl, file.fileId);
          });

          if (files.length < limit) break;
          skip += limit;
        }

      } catch (error: any) {
        logger.warn(`Failed to fetch from path "${path}":`, error.message);
        continue;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`Created URL mapping: ${urlToFileId.size} files for event ${eventId}`);
    return urlToFileId;
  }

  /**
   * Delete a single file with proper error handling
   */
  private async deleteSingleFile(fileId: string): Promise<{
    success: boolean;
    alreadyDeleted: boolean;
    error?: string;
  }> {
    try {
      await imagekit.deleteFile(fileId);
      return { success: true, alreadyDeleted: false };
    } catch (error: any) {
      const errorMessage = error.message?.toLowerCase() || '';
      
      if (errorMessage.includes('not found') || 
          errorMessage.includes('does not exist') ||
          error.status === 404) {
        return { success: true, alreadyDeleted: true };
      }

      return {
        success: false,
        alreadyDeleted: false,
        error: errorMessage
      };
    }
  }

  /**
   * Process a batch of files concurrently
   */
  private async processBatch(fileIds: string[]): Promise<{
    deleted: number;
    alreadyDeleted: number;
    failed: number;
  }> {
    let deleted = 0;
    let alreadyDeleted = 0;
    let failed = 0;

    // Process files in smaller concurrent chunks
    for (let i = 0; i < fileIds.length; i += BATCH_CONFIG.MAX_CONCURRENT_DELETIONS) {
      const chunk = fileIds.slice(i, i + BATCH_CONFIG.MAX_CONCURRENT_DELETIONS);
      
      const results = await Promise.allSettled(
        chunk.map(fileId => this.deleteSingleFile(fileId))
      );

      results.forEach(result => {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            if (result.value.alreadyDeleted) {
              alreadyDeleted++;
            } else {
              deleted++;
            }
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      });

      // Small delay between chunks
      if (i + BATCH_CONFIG.MAX_CONCURRENT_DELETIONS < fileIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return { deleted, alreadyDeleted, failed };
  }

  /**
   * Main deletion method with batching
   */
  async deleteFiles(urls: string[], eventId: string): Promise<{
    deleted: string[];
    failed: string[];
    alreadyDeleted: string[];
    batchesProcessed: number;
  }> {
    const startTime = Date.now();
    const deleted: string[] = [];
    const failed: string[] = [];
    const alreadyDeleted: string[] = [];

    if (urls.length === 0) {
      return { deleted, failed, alreadyDeleted, batchesProcessed: 0 };
    }

    logger.info(`Starting batch deletion: ${urls.length} files for event ${eventId}`);

    try {
      // Step 1: Get file ID mapping
      const urlToFileId = await this.createUrlMapping(eventId);
      
      // Step 2: Map URLs to file IDs
      const fileMappings = urls.map(url => {
        const normalizedUrl = normalizeImageKitUrl(url);
        const fileId = urlToFileId.get(normalizedUrl);
        return { url, fileId };
      });

      const filesWithIds = fileMappings.filter(mapping => mapping.fileId);
      const filesWithoutIds = fileMappings.filter(mapping => !mapping.fileId);

      logger.info(`File mapping analysis:`, {
        totalUrls: urls.length,
        foundFiles: filesWithIds.length,
        notFoundFiles: filesWithoutIds.length
      });

      // Step 3: Add not found files to already deleted
      alreadyDeleted.push(...filesWithoutIds.map(mapping => mapping.url));

      // Step 4: Process found files in batches
      const fileIds = filesWithIds.map(mapping => mapping.fileId!);
      const batches: string[][] = [];
      
      for (let i = 0; i < fileIds.length; i += BATCH_CONFIG.BATCH_SIZE) {
        batches.push(fileIds.slice(i, i + BATCH_CONFIG.BATCH_SIZE));
      }

      logger.info(`Processing ${fileIds.length} files in ${batches.length} batches`);

      // Step 5: Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        logger.info(`Processing batch ${i + 1}/${batches.length}: ${batch.length} files`);
        
        const batchResult = await this.processBatch(batch);
        
        // Map results back to URLs
        const batchUrls = filesWithIds.slice(
          i * BATCH_CONFIG.BATCH_SIZE, 
          (i + 1) * BATCH_CONFIG.BATCH_SIZE
        );

        let urlIndex = 0;
        for (let j = 0; j < batchResult.deleted; j++) {
          deleted.push(batchUrls[urlIndex++].url);
        }
        for (let j = 0; j < batchResult.alreadyDeleted; j++) {
          alreadyDeleted.push(batchUrls[urlIndex++].url);
        }
        for (let j = 0; j < batchResult.failed; j++) {
          failed.push(batchUrls[urlIndex++].url);
        }

        // Progress logging
        const totalProcessed = (i + 1) * BATCH_CONFIG.BATCH_SIZE;
        const processed = Math.min(totalProcessed, fileIds.length);
        logger.info(`Batch progress: ${processed}/${fileIds.length} files`);

        // Rate limiting between batches
        if (i + 1 < batches.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const processingTime = Date.now() - startTime;
      const totalSuccess = deleted.length + alreadyDeleted.length;

      logger.info(`Batch deletion completed in ${processingTime}ms`, {
        total: urls.length,
        deleted: deleted.length,
        alreadyDeleted: alreadyDeleted.length,
        failed: failed.length,
        batchesProcessed: batches.length,
        successRate: `${((totalSuccess / urls.length) * 100).toFixed(1)}%`,
        avgTimePerFile: `${Math.round(processingTime / urls.length)}ms`
      });

      return { deleted, failed, alreadyDeleted, batchesProcessed: batches.length };

    } catch (error) {
      logger.error('Batch deletion failed:', error);
      return {
        deleted: [],
        failed: urls,
        alreadyDeleted: [],
        batchesProcessed: 0
      };
    }
  }
}

// Initialize queue and worker
export const storageCleanupQueue = new Queue('storage-cleanup', {
  connection: RedisConfigUtil.getBullMQConfig()
});

let storageCleanupWorker: Worker | null = null;

export const initializeStorageCleanupWorker = async (): Promise<Worker> => {
  try {
    storageCleanupWorker = new Worker(
      'storage-cleanup',
      async (job: Job<StorageCleanupJobData>): Promise<CleanupResult> => {
        const startTime = Date.now();
        const { mediaId, urls, eventId, userId, isBulk } = job.data;

        logger.info(`Starting batch cleanup: ${isBulk ? 'bulk' : 'single'} operation`, {
          mediaId,
          urlCount: urls.length,
          batchSize: BATCH_CONFIG.BATCH_SIZE,
          eventId: eventId.substring(0, 8) + '...'
        });

        try {
          const fileManager = new ProductionBatchFileManager();
          const result = await fileManager.deleteFiles(urls, eventId);

          const processingTimeMs = Date.now() - startTime;
          const totalSuccess = result.deleted.length + result.alreadyDeleted.length;

          logger.info(`Batch cleanup completed`, {
            mediaId,
            totalFiles: urls.length,
            deleted: result.deleted.length,
            alreadyDeleted: result.alreadyDeleted.length,
            failed: result.failed.length,
            batchesProcessed: result.batchesProcessed,
            successRate: `${((totalSuccess / urls.length) * 100).toFixed(1)}%`,
            processingTimeMs,
            efficiency: `${result.batchesProcessed} batches vs ${urls.length} individual calls`
          });

          if (result.failed.length > 0) {
            await storeFailedDeletions(mediaId, result.failed);
          }

          return {
            mediaId,
            totalFiles: urls.length,
            deletedFiles: result.deleted.length,
            failedFiles: result.failed,
            alreadyDeleted: result.alreadyDeleted.length,
            processingTimeMs,
            batchesProcessed: result.batchesProcessed
          };

        } catch (error: any) {
          logger.error(`Batch cleanup failed for ${mediaId}:`, error);
          throw error;
        }
      },
      {
        connection: RedisConfigUtil.getBullMQConfig(),
        concurrency: 1, // Single worker for proper batching
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      }
    );

    // Event handlers
    storageCleanupWorker.on('completed', (job: Job<StorageCleanupJobData>, result: CleanupResult) => {
      const successRate = ((result.deletedFiles + result.alreadyDeleted) / result.totalFiles * 100).toFixed(1);
      const efficiency = Math.round((job.data.urls.length / result.batchesProcessed) * 100) / 100;

      logger.info(`Batch job completed: ${successRate}% success, ${efficiency}x efficiency`, {
        mediaId: job.data.mediaId,
        processingTime: `${result.processingTimeMs}ms`,
        deleted: result.deletedFiles,
        alreadyDeleted: result.alreadyDeleted,
        failed: result.failedFiles.length,
        batches: result.batchesProcessed
      });
    });

    storageCleanupWorker.on('failed', (job: Job<StorageCleanupJobData> | undefined, err: Error) => {
      logger.error(`Batch cleanup job failed`, {
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        error: err.message,
        urlCount: job?.data?.urls?.length
      });
    });

    logger.info(`Batch storage cleanup worker initialized`, {
      batchSize: BATCH_CONFIG.BATCH_SIZE,
      maxConcurrentDeletions: BATCH_CONFIG.MAX_CONCURRENT_DELETIONS
    });

    return storageCleanupWorker;

  } catch (error) {
    logger.error('Failed to initialize batch cleanup worker:', error);
    throw error;
  }
};

// Helper functions
async function storeFailedDeletions(mediaId: string, failedUrls: string[]): Promise<void> {
  try {
    const redis = require('ioredis');
    const redisClient = new redis(RedisConfigUtil.getBullMQConfig());

    await redisClient.setex(
      `failed_deletions:${mediaId}`,
      86400 * 7,
      JSON.stringify({
        mediaId,
        failedUrls,
        timestamp: Date.now(),
        retryCount: 0
      })
    );

    await redisClient.quit();
  } catch (error) {
    logger.error('Failed to store failed deletions:', error);
  }
}

export const queueStorageCleanup = async (data: StorageCleanupJobData): Promise<void> => {
  try {
    const expectedBatches = Math.ceil(data.urls.length / BATCH_CONFIG.BATCH_SIZE);
    
    const job = await storageCleanupQueue.add('delete-files', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000
      },
      priority: data.isBulk ? 5 : 10,
    });

    logger.info(`Batch cleanup queued`, {
      jobId: job.id,
      mediaId: data.mediaId,
      urlCount: data.urls.length,
      expectedBatches,
      estimatedApiCalls: expectedBatches,
      savedApiCalls: data.urls.length - expectedBatches
    });

  } catch (error) {
    logger.error('Failed to queue batch cleanup:', error);
    throw error;
  }
};

export const getStorageCleanupWorker = (): Worker | null => {
  return storageCleanupWorker;
};

// Configuration update function
export const updateBatchConfig = (newConfig: Partial<typeof BATCH_CONFIG>) => {
  Object.assign(BATCH_CONFIG, newConfig);
  logger.info('Batch config updated:', BATCH_CONFIG);
};
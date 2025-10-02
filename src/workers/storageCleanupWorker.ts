// workers/storageCleanupWorker.ts - FINAL FIXED VERSION with URL normalization

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
}

/**
 * Normalize ImageKit URL by removing query parameters
 */
function normalizeImageKitUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  } catch (error) {
    return url; // Return original if parsing fails
  }
}

/**
 * Enhanced ImageKit File Manager with URL normalization
 */
class ImageKitFileManager {
  private readonly BATCH_SIZE = 3;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;

  /**
   * Get all files for an event and create normalized URL mapping
   */
  private async createNormalizedUrlMapping(eventId: string): Promise<Map<string, string>> {
    const normalizedUrlToFileId = new Map<string, string>();

    // All possible paths where files might be stored
    const searchPaths = [
      `events/${eventId}/originals`,
      `events/${eventId}/variants/small`,
      `events/${eventId}/variants/medium`,
      `events/${eventId}/variants/large`,
      `events/${eventId}/previews`
    ];

    logger.info(`Creating normalized URL mapping for event ${eventId}`);

    for (const searchPath of searchPaths) {
      try {
        let skip = 0;
        const limit = 1000;

        while (skip < 5000) { // Safety limit
          const files = await imagekit.listFiles({
            path: searchPath,
            limit: limit,
            skip: skip,
            includeFolder: false
          });

          if (files.length === 0) break;

          const fileObjects = files.filter((item): item is FileObject =>
            item && 'fileId' in item && 'url' in item && item.type === 'file'
          );

          fileObjects.forEach(file => {
            const normalizedUrl = normalizeImageKitUrl(file.url);
            normalizedUrlToFileId.set(normalizedUrl, file.fileId);

            logger.debug(`Mapped normalized URL:`, {
              original: file.url,
              normalized: normalizedUrl,
              fileId: file.fileId
            });
          });

          logger.debug(`Processed ${fileObjects.length} files from path: ${searchPath}`);

          if (files.length < limit) break;
          skip += limit;
        }

      } catch (error: any) {
        logger.warn(`Failed to fetch from path "${searchPath}":`, error.message);
        continue;
      }

      // Small delay between path searches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`Created normalized mapping with ${normalizedUrlToFileId.size} URLs for event ${eventId}`);
    return normalizedUrlToFileId;
  }

  /**
   * Delete a single file using normalized URL matching
   */
  private async deleteSingleFile(
    url: string,
    normalizedUrlToFileId: Map<string, string>,
    retryCount = 0
  ): Promise<{
    success: boolean;
    alreadyDeleted: boolean;
    error?: string;
  }> {
    try {
      const normalizedUrl = normalizeImageKitUrl(url);
      const fileId = normalizedUrlToFileId.get(normalizedUrl);

      logger.info(`Processing file deletion:`, {
        originalUrl: url,
        normalizedUrl: normalizedUrl,
        fileId: fileId || 'NOT_FOUND'
      });

      if (!fileId) {
        logger.info(`File not found in normalized mapping - assuming already deleted:`, {
          url: normalizedUrl
        });
        return { success: true, alreadyDeleted: true };
      }

      // Attempt deletion
      logger.info(`Deleting file with ID: ${fileId}`);
      await imagekit.deleteFile(fileId);

      logger.info(`Successfully deleted file: ${fileId} for URL: ${normalizedUrl}`);
      return { success: true, alreadyDeleted: false };

    } catch (error: any) {
      const errorMessage = error.message?.toLowerCase() || '';

      // Check if file was already deleted
      if (errorMessage.includes('not found') ||
        errorMessage.includes('does not exist') ||
        errorMessage.includes('file not found') ||
        error.status === 404) {
        logger.info(`File already deleted (404 response):`, { url });
        return { success: true, alreadyDeleted: true };
      }

      // Retry logic for transient errors
      if (retryCount < this.MAX_RETRIES &&
        (errorMessage.includes('timeout') ||
          errorMessage.includes('network') ||
          errorMessage.includes('rate limit') ||
          error.status >= 500)) {

        logger.warn(`Retry ${retryCount + 1}/${this.MAX_RETRIES} for file deletion:`, {
          url,
          error: errorMessage
        });

        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * (retryCount + 1)));
        return this.deleteSingleFile(url, normalizedUrlToFileId, retryCount + 1);
      }

      logger.error(`Failed to delete file after ${retryCount + 1} attempts:`, {
        url,
        error: errorMessage
      });

      return {
        success: false,
        alreadyDeleted: false,
        error: errorMessage
      };
    }
  }

  /**
   * Delete multiple files with normalized URL matching
   */
  async deleteFiles(urls: string[], eventId: string): Promise<{
    deleted: string[];
    failed: string[];
    alreadyDeleted: string[];
  }> {
    const startTime = Date.now();
    const deleted: string[] = [];
    const failed: string[] = [];
    const alreadyDeleted: string[] = [];

    if (urls.length === 0) {
      return { deleted, failed, alreadyDeleted };
    }

    logger.info(`Starting deletion of ${urls.length} files for event ${eventId} with URL normalization`);

    try {
      // Step 1: Create normalized URL mapping
      const normalizedUrlToFileId = await this.createNormalizedUrlMapping(eventId);

      // Step 2: Check how many URLs we can match
      const normalizedUrls = urls.map(url => normalizeImageKitUrl(url));
      const matchedUrls = normalizedUrls.filter(url => normalizedUrlToFileId.has(url));

      logger.info(`URL matching analysis:`, {
        totalUrls: urls.length,
        normalizedUrls: normalizedUrls.length,
        matchedUrls: matchedUrls.length,
        unmatchedUrls: normalizedUrls.length - matchedUrls.length
      });

      // Step 3: Process deletions in batches
      for (let i = 0; i < urls.length; i += this.BATCH_SIZE) {
        const batch = urls.slice(i, i + this.BATCH_SIZE);

        // Process batch with individual error handling
        const batchResults = await Promise.allSettled(
          batch.map(url => this.deleteSingleFile(url, normalizedUrlToFileId))
        );

        // Process results
        batchResults.forEach((result, index) => {
          const url = batch[index];

          if (result.status === 'fulfilled') {
            const { success, alreadyDeleted: wasDeleted } = result.value;
            if (success) {
              if (wasDeleted) {
                alreadyDeleted.push(url);
              } else {
                deleted.push(url);
              }
            } else {
              failed.push(url);
            }
          } else {
            logger.error(`Deletion promise rejected for ${url}:`, result.reason);
            failed.push(url);
          }
        });

        // Progress logging
        const processed = Math.min(i + this.BATCH_SIZE, urls.length);
        logger.info(`Deletion progress: ${processed}/${urls.length} files processed`);

        // Rate limiting between batches
        if (i + this.BATCH_SIZE < urls.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

    } catch (error) {
      logger.error('Unexpected error during file deletion:', error);
      urls.forEach(url => {
        if (!deleted.includes(url) && !failed.includes(url) && !alreadyDeleted.includes(url)) {
          failed.push(url);
        }
      });
    }

    const processingTime = Date.now() - startTime;
    const totalSuccess = deleted.length + alreadyDeleted.length;

    logger.info(`File deletion completed in ${processingTime}ms`, {
      total: urls.length,
      deleted: deleted.length,
      alreadyDeleted: alreadyDeleted.length,
      failed: failed.length,
      successRate: `${((totalSuccess / urls.length) * 100).toFixed(1)}%`
    });

    return { deleted, failed, alreadyDeleted };
  }
}

// Initialize the cleanup queue
export const storageCleanupQueue = new Queue('storage-cleanup', {
  connection: RedisConfigUtil.getBullMQConfig()
});

// Initialize the cleanup worker
let storageCleanupWorker: Worker | null = null;

export const initializeStorageCleanupWorker = async (): Promise<Worker> => {
  try {
    storageCleanupWorker = new Worker(
      'storage-cleanup',
      async (job: Job<StorageCleanupJobData>): Promise<CleanupResult> => {
        const startTime = Date.now();
        const { mediaId, urls, eventId, userId, isBulk } = job.data;

        logger.info(`Starting storage cleanup with URL normalization for ${isBulk ? 'bulk' : 'single'} operation`, {
          mediaId,
          urlCount: urls.length,
          eventId: eventId.substring(0, 8) + '...',
          userId: userId.substring(0, 8) + '...'
        });

        try {
          const fileManager = new ImageKitFileManager();
          const result = await fileManager.deleteFiles(urls, eventId);

          const processingTimeMs = Date.now() - startTime;
          const totalSuccess = result.deleted.length + result.alreadyDeleted.length;

          logger.info(`Storage cleanup completed successfully`, {
            mediaId,
            totalFiles: urls.length,
            deleted: result.deleted.length,
            alreadyDeleted: result.alreadyDeleted.length,
            failed: result.failed.length,
            successRate: `${((totalSuccess / urls.length) * 100).toFixed(1)}%`,
            processingTimeMs,
            userId: userId.substring(0, 8) + '...'
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
            processingTimeMs
          };

        } catch (error: any) {
          logger.error(`Storage cleanup failed for ${mediaId}:`, {
            error: error.message,
            stack: error.stack,
            mediaId,
            urlCount: urls.length
          });
          throw error;
        }
      },
      {
        connection: RedisConfigUtil.getBullMQConfig(),
        concurrency: 1, // Single worker to avoid ImageKit rate limits
        // removeOnComplete: 10,
        // removeOnFail: 50,
      }
    );

    // Event handlers
    storageCleanupWorker.on('completed', (job: Job<StorageCleanupJobData>, result: CleanupResult) => {
      const successRate = ((result.deletedFiles + result.alreadyDeleted) / result.totalFiles * 100).toFixed(1);

      logger.info(`Cleanup job completed: ${successRate}% success rate`, {
        mediaId: job.data.mediaId,
        processingTime: `${result.processingTimeMs}ms`,
        actuallyDeleted: result.deletedFiles,
        alreadyDeleted: result.alreadyDeleted,
        failed: result.failedFiles.length
      });
    });

    storageCleanupWorker.on('failed', (job: Job<StorageCleanupJobData> | undefined, err: Error) => {
      logger.error(`Cleanup job failed completely`, {
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        error: err.message
      });
    });

    logger.info(`Storage cleanup worker initialized with URL normalization support`);
    return storageCleanupWorker;

  } catch (error) {
    logger.error('Failed to initialize storage cleanup worker:', error);
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

    logger.info(`Stored ${failedUrls.length} failed deletions for retry`, {
      mediaId,
      sampleUrls: failedUrls.slice(0, 3)
    });

  } catch (error) {
    logger.error('Failed to store failed deletions:', error);
  }
}

export const queueStorageCleanup = async (data: StorageCleanupJobData): Promise<void> => {
  try {
    const job = await storageCleanupQueue.add('delete-files', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000
      },
      priority: data.isBulk ? 5 : 10,
    });

    logger.info(`Storage cleanup queued successfully`, {
      jobId: job.id,
      mediaId: data.mediaId,
      urlCount: data.urls.length
    });

  } catch (error) {
    logger.error('Failed to queue storage cleanup:', error);
    throw error;
  }
};

export const getStorageCleanupWorker = (): Worker | null => {
  return storageCleanupWorker;
};
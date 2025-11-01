// workers/imageWorker.ts - Fixed to use only SimpleProgressService
import { Job, Worker } from 'bullmq';
import { logger } from '@utils/logger';
import { keys } from '@configs/dotenv.config';
import { Media } from '@models/media.model';
import sharp from 'sharp';
import fs from 'fs/promises';
import { mediaNotificationService } from '@services/websocket/notifications';
import { uploadOriginalImage, uploadVariantImage } from '@services/upload/core/upload-variants.service';
import { getBullMQRedisConfig } from '@utils/redis.util';

// Types
interface ImageProcessingJobData {
  mediaId: string;
  userId: string;
  userName?: string;
  eventId: string;
  albumId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  hasPreview: boolean;
  previewBroadcasted?: boolean;
  isGuestUpload?: boolean;
}

interface ProcessingResult {
  success: boolean;
  mediaId: string;
  processingTime: number;
  variants: number;
  originalUrl: string;
  bestGuestUrl?: string;
  variantUrls: {
    small_webp?: string;
    small_jpeg?: string;
    medium_webp?: string;
    medium_jpeg?: string;
    large_webp?: string;
    large_jpeg?: string;
  };
  guestsBroadcasted?: boolean;
  isGuestUpload?: boolean;
}

interface ImageVariant {
  public_id: string;
  width: number;
  height: number;
  size_mb: number;
  format: 'webp' | 'jpeg';
}

let imageWorkerInstance: Worker | null = null;

export const initializeImageWorker = async (): Promise<Worker> => {
  try {
    imageWorkerInstance = new Worker(
      'image-processing',
      async (job: Job<ImageProcessingJobData>): Promise<ProcessingResult> => {
        const startTime = Date.now();
        const { mediaId, originalFilename, filePath, eventId, userName, userId, isGuestUpload } = job.data;

        logger.info(`🔄 Processing variants: ${originalFilename} (${mediaId}) - ${isGuestUpload ? 'Guest' : 'Admin'} upload`);

        try {
          // STEP 1: Update status to processing
          await Media.findByIdAndUpdate(mediaId, {
            'processing.status': 'processing',
            'processing.current_stage': 'processing',
            'processing.progress_percentage': 30,
            'processing.started_at': new Date(),
          });

          // Broadcast progress via WebSocket
          mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
              id: mediaId,
              filename: originalFilename,
              status: 'processing',
              processingStage: 'processing',
              progressPercentage: 30,
              uploadedBy: {
                id: userId,
                name: userName || 'User',
                type: isGuestUpload ? 'guest' : 'admin'
              }
            },
            timestamp: new Date(),
            allUsersCanSee: true
          });

          // STEP 2: Generate all variants
          const variants = await generateImageVariants(filePath, mediaId, eventId, async (progress) => {
            const percentage = 30 + Math.round(progress * 0.5); // 30-80%

            // Update database
            await Media.findByIdAndUpdate(mediaId, {
              'processing.current_stage': 'variants_creating',
              'processing.progress_percentage': percentage
            });

            // Broadcast progress
            mediaNotificationService.broadcastOptimisticMediaUpdate({
              type: 'processing_progress',
              eventId,
              mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'processing',
                processingStage: 'optimizing',
                progressPercentage: percentage,
                uploadedBy: {
                  id: userId,
                  name: userName || 'User',
                  type: isGuestUpload ? 'guest' : 'admin'
                }
              },
              timestamp: new Date(),
              allUsersCanSee: true
            });
          });

          // STEP 3: Finalizing (80-95%)
          await Media.findByIdAndUpdate(mediaId, {
            'processing.current_stage': 'finalizing',
            'processing.progress_percentage': 85
          });

          mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
              id: mediaId,
              filename: originalFilename,
              status: 'processing',
              processingStage: 'finalizing',
              progressPercentage: 85,
              uploadedBy: {
                id: userId,
                name: userName || 'User',
                type: isGuestUpload ? 'guest' : 'admin'
              }
            },
            timestamp: new Date(),
            allUsersCanSee: true
          });

          // STEP 4: Get original metadata and upload
          const originalMetadata = await getOriginalImageMetadata(filePath);
          const originalUrl = await uploadOriginal(filePath, mediaId, eventId);

          // STEP 5: Update database with everything
          const processingTime = Date.now() - startTime;

          const updateData = {
            url: originalUrl,
            'metadata.width': originalMetadata.width,
            'metadata.height': originalMetadata.height,
            'metadata.aspect_ratio': originalMetadata.aspect_ratio,
            'metadata.color_profile': originalMetadata.colorProfile,
            'metadata.has_transparency': originalMetadata.hasTransparency,
            'processing.status': 'completed',
            'processing.current_stage': 'completed',
            'processing.progress_percentage': 100,
            'processing.completed_at': new Date(),
            'processing.processing_time_ms': processingTime,
            'processing.variants_generated': true,
            'processing.variants_count': calculateVariantsCount(variants),
            'processing.total_variants_size_mb': calculateTotalVariantsSize(variants),
            image_variants: {
              original: {
                public_id: mediaId, // Use mediaId as public_id for original
                width: originalMetadata.width,
                height: originalMetadata.height,
                size_mb: originalMetadata.size_mb,
                format: originalMetadata.format
              },
              small: variants.small,
              medium: variants.medium,
              large: variants.large
            }
          };

          await Media.findByIdAndUpdate(mediaId, updateData);

          // Broadcast completion
           const { getCachedSignedUrl } = require('../utils/signedUrl');
           const bestGuestUrl = variants.medium?.webp?.public_id ? getCachedSignedUrl(variants.medium.webp.public_id) :
                               variants.medium?.jpeg?.public_id ? getCachedSignedUrl(variants.medium.jpeg.public_id) :
                               originalUrl;

           mediaNotificationService.broadcastProcessingComplete({
             mediaId,
             eventId,
             newUrl: bestGuestUrl,
             variants: {
               thumbnail: variants.small?.jpeg?.public_id ? getCachedSignedUrl(variants.small.jpeg.public_id) : bestGuestUrl,
               display: bestGuestUrl,
               full: variants.large?.jpeg?.public_id ? getCachedSignedUrl(variants.large.jpeg.public_id) : bestGuestUrl
             },
             processingTimeMs: processingTime
           });

          // Cleanup: Remove local file
          try {
            await fs.unlink(filePath);
            logger.info(`🧹 Cleaned up local file: ${filePath}`);
          } catch (cleanupError) {
            logger.warn('Failed to cleanup local file:', cleanupError);
          }

          logger.info(`✅ Variants completed: ${originalFilename} in ${processingTime}ms - ${isGuestUpload ? 'Guest' : 'Admin'} upload`);

          return {
            success: true,
            mediaId,
            processingTime,
            variants: calculateVariantsCount(variants),
            originalUrl,
            bestGuestUrl,
            variantUrls: {
              small_webp: variants.small?.webp?.public_id,
              small_jpeg: variants.small?.jpeg?.public_id,
              medium_webp: variants.medium?.webp?.public_id,
              medium_jpeg: variants.medium?.jpeg?.public_id,
              large_webp: variants.large?.webp?.public_id,
              large_jpeg: variants.large?.jpeg?.public_id,
            },
            guestsBroadcasted: !isGuestUpload,
            isGuestUpload: isGuestUpload || false
          };

        } catch (error: any) {
          const processingTime = Date.now() - startTime;
          logger.error(`❌ Processing failed: ${originalFilename} after ${processingTime}ms (${isGuestUpload ? 'Guest' : 'Admin'}):`, error);

          // Update failure status
          await Media.findByIdAndUpdate(mediaId, {
            'processing.status': 'failed',
            'processing.current_stage': 'failed',
            'processing.progress_percentage': 0,
            'processing.completed_at': new Date(),
            'processing.processing_time_ms': processingTime,
            'processing.error_message': error.message || 'Unknown processing error',
            'processing.retry_count': job.attemptsMade || 0,
          });

          // Broadcast failure
          mediaNotificationService.broadcastProcessingFailed({
            mediaId,
            eventId,
            errorMessage: error.message || 'Processing failed'
          });

          // Cleanup on failure
          try {
            if (filePath) {
              await fs.unlink(filePath);
            }
          } catch (cleanupError) {
            logger.warn('Failed to cleanup file on error:', cleanupError);
          }

          throw error;
        }
      },
      {
        connection: getBullMQRedisConfig(),
        concurrency: getConcurrencyLevel(),
      }
    );

    // Event handlers
    imageWorkerInstance.on('completed', (job: Job<ImageProcessingJobData>, result: ProcessingResult) => {
      const processingTime = Date.now() - job.timestamp;
      logger.info(`✅ Worker completed job ${job.id} in ${processingTime}ms`);

      if (processingTime > 60000) {
        logger.warn(`🐌 Very slow job: ${job.id} took ${(processingTime / 1000).toFixed(1)}s`);
      }
    });

    imageWorkerInstance.on('failed', (job: Job<ImageProcessingJobData> | undefined, err: Error) => {
      logger.error(`❌ Worker failed job ${job?.id}:`, {
        error: err.message,
        attempts: job?.attemptsMade,
        filename: job?.data?.originalFilename,
        eventId: job?.data?.eventId
      });
    });

    logger.info(`✅ Image worker initialized with concurrency: ${getConcurrencyLevel()}`);
    return imageWorkerInstance;

  } catch (error) {
    logger.error('❌ Failed to initialize image worker:', error);
    throw error;
  }
};

// Generate image variants with progress callback
async function generateImageVariants(
  filePath: string,
  mediaId: string,
  eventId: string,
  progressCallback: (progress: number) => Promise<void> // Changed to async
): Promise<{
  small?: { webp?: ImageVariant; jpeg?: ImageVariant };
  medium?: { webp?: ImageVariant; jpeg?: ImageVariant };
  large?: { webp?: ImageVariant; jpeg?: ImageVariant };
}> {
  const variants: any = {};

  try {
    const sizes = {
      small: { width: 400, height: 400, quality: 80 },
      medium: { width: 800, height: 800, quality: 85 },
      large: { width: 1200, height: 1200, quality: 90 }
    } as const;

    const sizeNames = Object.keys(sizes) as Array<keyof typeof sizes>;
    let completed = 0;
    const total = sizeNames.length * 2;

    for (const sizeName of sizeNames) {
      const config = sizes[sizeName];

      await progressCallback((completed / total) * 100);

      const [webpVariant, jpegVariant] = await Promise.all([
        generateSingleVariant(filePath, mediaId, eventId, sizeName, 'webp', config),
        generateSingleVariant(filePath, mediaId, eventId, sizeName, 'jpeg', config)
      ]);

      variants[sizeName] = {
        webp: webpVariant,
        jpeg: jpegVariant
      };

      completed += 2;
      await progressCallback((completed / total) * 100);
    }

    return variants;

  } catch (error) {
    logger.error('Failed to generate variants:', error);
    throw error;
  }
}

// Rest of your functions remain the same...
async function generateSingleVariant(
  filePath: string,
  mediaId: string,
  eventId: string,
  sizeName: string,
  format: 'webp' | 'jpeg',
  config: { width: number; height: number; quality: number }
): Promise<ImageVariant> {
  let sharpInstance: sharp.Sharp | null = null;
  try {
    // 🛡️ MEMORY PROTECTION: Check memory pressure before processing
    if (checkMemoryPressure()) {
      logger.warn('High memory pressure detected in worker, delaying processing');
      await waitForMemoryRelief();
    }

    // 🚀 SHARP PIPELINE: Optimized settings with memory protection
    sharpInstance = sharp(filePath, {
      sequentialRead: true,
      limitInputPixels: 268402689  // 🛡️ 16MP limit (268M pixels) - prevents OOM
    })
      .resize(config.width, config.height, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3  // Better quality
      });

    let buffer: Buffer;
    if (format === 'webp') {
      buffer = await sharpInstance
        .webp({
          quality: config.quality,
          effort: 4,
          smartSubsample: true,  // Better compression
          nearLossless: false
        })
        .toBuffer();
    } else {
      buffer = await sharpInstance
        .jpeg({
          quality: config.quality,
          progressive: true,
          mozjpeg: true,
          optimizeScans: true  // Better compression
        })
        .toBuffer();
    }

    // 🧹 CLEANUP: Destroy Sharp instance immediately after processing
    sharpInstance.destroy();
    sharpInstance = null;

    const metadata = await sharp(buffer).metadata();
    const sizeBytes = buffer.length;
    const sizeMB = Math.round((sizeBytes / (1024 * 1024)) * 100) / 100;

    const url = await uploadVariantImage(
      buffer,
      mediaId,
      eventId,
      sizeName as 'small' | 'medium' | 'large',
      format,
      config.quality
    );

    logger.info(`✅ Generated ${sizeName} ${format}: ${url} (${sizeMB}MB)`);

    return {
      public_id: url, // url here is actually the public_id returned by uploadVariantImage
      width: metadata.width || 0,
      height: metadata.height || 0,
      size_mb: sizeMB,
      format
    };

  } catch (error) {
    logger.error(`Failed to generate ${sizeName} ${format} variant:`, error);
    throw error;
  } finally {
    // 🧹 CLEANUP: Ensure Sharp instance is always destroyed
    if (sharpInstance) {
      try {
        sharpInstance.destroy();
      } catch (cleanupError) {
        logger.warn('Error destroying Sharp instance in worker:', cleanupError);
      }
    }
  }
}

async function getOriginalImageMetadata(filePath: string) {
  try {
    const metadata = await sharp(filePath).metadata();
    const stats = await fs.stat(filePath);
    const sizeMB = Math.round((stats.size / (1024 * 1024)) * 100) / 100;

    let colorProfile = '';
    if (metadata.icc) {
      try {
        const iccBuffer = metadata.icc;
        if (Buffer.isBuffer(iccBuffer) && iccBuffer.length > 80) {
          const descriptionMatch = iccBuffer.toString('ascii', 80, 200).match(/[A-Za-z0-9\s]{4,}/);
          colorProfile = descriptionMatch ? descriptionMatch[0].trim() : 'Unknown';
        }
      } catch (iccError) {
        logger.warn('Failed to parse ICC profile:', iccError);
        colorProfile = 'Unknown';
      }
    }

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      aspect_ratio: metadata.height && metadata.width ? metadata.height / metadata.width : 1,
      format: metadata.format || 'jpeg',
      colorProfile,
      hasTransparency: metadata.hasAlpha || false,
      size_mb: sizeMB
    };
  } catch (error) {
    logger.warn('Failed to get original metadata:', error);
    return {
      width: 0,
      height: 0,
      aspect_ratio: 1,
      format: 'jpeg',
      colorProfile: '',
      hasTransparency: false,
      size_mb: 0
    };
  }
}

async function uploadOriginal(filePath: string, mediaId: string, eventId: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    const url = await uploadOriginalImage(buffer, mediaId, eventId);
    logger.info(`✅ Uploaded original: ${url}`);
    return url;
  } catch (error) {
    logger.error('Failed to upload original:', error);
    throw error;
  }
}

// Utility functions remain the same...
function getConcurrencyLevel(): number {
  try {
    const cpuCores = require('os').cpus().length;
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);

    let concurrency = Math.max(1, Math.floor(cpuCores * 1.5));
    const memoryBasedLimit = Math.floor(totalMemoryGB);
    concurrency = Math.min(concurrency, memoryBasedLimit);

    if (process.env.IMAGE_WORKER_CONCURRENCY) {
      concurrency = parseInt(process.env.IMAGE_WORKER_CONCURRENCY);
    }

    return Math.max(1, Math.min(concurrency, 6));
  } catch (error) {
    logger.warn('Could not determine optimal concurrency, using default of 2');
    return 2;
  }
}

function calculateVariantsCount(variants: any): number {
  if (!variants || typeof variants !== 'object') return 0;

  let count = 0;
  ['small', 'medium', 'large'].forEach(size => {
    if (variants[size]) {
      if (variants[size].webp) count++;
      if (variants[size].jpeg) count++;
    }
  });
  return count;
}

function calculateTotalVariantsSize(variants: any): number {
  if (!variants || typeof variants !== 'object') return 0;

  let total = 0;
  ['small', 'medium', 'large'].forEach(size => {
    if (variants[size]) {
      if (variants[size].webp?.size_mb) total += variants[size].webp.size_mb;
      if (variants[size].jpeg?.size_mb) total += variants[size].jpeg.size_mb;
    }
  });

  return Math.round(total * 100) / 100;
}

/**
 * 🛡️ MEMORY MONITORING: Check if system is under memory pressure
 */
function checkMemoryPressure(): boolean {
  try {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const rssMB = memUsage.rss / 1024 / 1024;

    // Check multiple memory pressure indicators
    const heapPressure = heapUsedMB > 1536; // 1.5GB heap used
    const rssPressure = rssMB > 2048; // 2GB RSS
    const heapRatioPressure = (heapUsedMB / heapTotalMB) > 0.85; // 85% heap utilization

    const isUnderPressure = heapPressure || rssPressure || heapRatioPressure;

    if (isUnderPressure) {
      logger.warn('Memory pressure detected in worker:', {
        heapUsedMB: Math.round(heapUsedMB),
        heapTotalMB: Math.round(heapTotalMB),
        rssMB: Math.round(rssMB),
        heapRatio: Math.round((heapUsedMB / heapTotalMB) * 100) + '%'
      });
    }

    return isUnderPressure;
  } catch (error) {
    logger.warn('Failed to check memory pressure in worker:', error);
    return false; // Default to no pressure if check fails
  }
}

/**
 * ⏳ MEMORY RELIEF: Wait for memory pressure to reduce
 */
async function waitForMemoryRelief(): Promise<void> {
  const maxWaitTime = 5000; // 5 seconds max wait
  const checkInterval = 500; // Check every 500ms
  let waitTime = 0;

  while (checkMemoryPressure() && waitTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waitTime += checkInterval;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  if (waitTime >= maxWaitTime) {
    logger.warn('Memory pressure timeout reached in worker, proceeding with processing');
  } else {
    logger.info(`Memory pressure relieved in worker after ${waitTime}ms`);
  }
}

export const getImageWorker = (): Worker | null => {
  return imageWorkerInstance;
};
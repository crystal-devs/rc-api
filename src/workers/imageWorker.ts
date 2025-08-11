// workers/imageWorker.ts - CORRECTED: Fix imports and use only mediaWebSocketService

import { Job, Worker } from 'bullmq';
import { logger } from '@utils/logger';
import { keys } from '@configs/dotenv.config';
import { Media } from '@models/media.model';
import sharp from 'sharp';
import fs from 'fs/promises';
import { uploadVariantImage, uploadOriginalImage } from '@services/uploadService';
import { mediaWebSocketService } from '@services/mediaWebSocket.service'; // CORRECTED: Only this import

// Types that should exist in your types/queue.ts - add these if they don't exist
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
  url: string;
  width: number;
  height: number;
  size_mb: number;
  format: 'webp' | 'jpeg';
}

let imageWorkerInstance: Worker | null = null;

export const initializeImageWorker = async (): Promise<Worker> => {
  try {
    const redisConfig = {
      host: getRedisHost(),
      port: getRedisPort(),
      password: getRedisPassword(),
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4 as const,
    };

    imageWorkerInstance = new Worker(
      'image-processing',
      async (job: Job<ImageProcessingJobData>): Promise<ProcessingResult> => {
        const startTime = Date.now();
        const { mediaId, originalFilename, filePath, eventId, userName, isGuestUpload } = job.data;

        logger.info(`🔄 Processing variants: ${originalFilename} (${mediaId}) - ${isGuestUpload ? 'Guest' : 'Admin'} upload`);

        try {
          // 🚀 STEP 1: Update status to processing
          await Media.findByIdAndUpdate(mediaId, {
            'processing.status': 'processing',
            'processing.started_at': new Date(),
          });

          await job.updateProgress(5);

          // 🚀 STEP 2: Generate all variants (10-90%)
          const variants = await generateImageVariants(filePath, mediaId, eventId, (progress) => {
            job.updateProgress(10 + (progress * 0.8)); // 10% to 90%
          });

          await job.updateProgress(90);

          // 🚀 STEP 3: Get original metadata
          const originalMetadata = await getOriginalImageMetadata(filePath);

          // 🚀 STEP 4: Upload original to permanent storage
          const originalUrl = await uploadOriginal(filePath, mediaId, eventId);

          // 🚀 STEP 5: Update database with everything (95%)
          const processingTime = Date.now() - startTime;

          const updateData = {
            url: originalUrl, // Update to permanent URL
            'metadata.width': originalMetadata.width,
            'metadata.height': originalMetadata.height,
            'metadata.aspect_ratio': originalMetadata.aspect_ratio,
            'metadata.color_profile': originalMetadata.colorProfile,
            'metadata.has_transparency': originalMetadata.hasTransparency,
            'processing.status': 'completed',
            'processing.completed_at': new Date(),
            'processing.processing_time_ms': processingTime,
            'processing.variants_generated': true,
            'processing.variants_count': calculateVariantsCount(variants),
            'processing.total_variants_size_mb': calculateTotalVariantsSize(variants),
            image_variants: {
              original: {
                url: originalUrl,
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

          // 🚀 NEW: Handle WebSocket differently for guest vs admin uploads
          if (!isGuestUpload) {
            // Admin uploads: Broadcast to guests (existing functionality)
            const bestGuestUrl = variants.medium?.webp?.url || variants.medium?.jpeg?.url || originalUrl;

            mediaWebSocketService.broadcastProcessingComplete({
              mediaId,
              eventId,
              newUrl: bestGuestUrl,
              variants: {
                thumbnail: variants.small?.jpeg?.url || bestGuestUrl,
                display: bestGuestUrl,
                full: variants.large?.jpeg?.url || bestGuestUrl
              },
              processingTimeMs: processingTime
            });
          } else {
            // 🚀 NEW: Guest uploads: Only notify admin about new guest content
            logger.info(`✅ Guest upload processed: ${mediaId} - Admin can review`);

            // TODO: In future, you can add admin notification here
            // For now, admin will see guest uploads when they refresh their admin panel
          }

          // 🧹 CLEANUP: Remove local file
          try {
            await fs.unlink(filePath);
            logger.info(`🧹 Cleaned up local file: ${filePath}`);
          } catch (cleanupError) {
            logger.warn('Failed to cleanup local file:', cleanupError);
          }

          await job.updateProgress(100);

          logger.info(`✅ Variants completed: ${originalFilename} in ${processingTime}ms - ${isGuestUpload ? 'Guest' : 'Admin'} upload`);

          return {
            success: true,
            mediaId,
            processingTime,
            variants: calculateVariantsCount(variants),
            originalUrl,
            bestGuestUrl: variants.medium?.webp?.url || variants.medium?.jpeg?.url || originalUrl,
            variantUrls: {
              small_webp: variants.small?.webp?.url,
              small_jpeg: variants.small?.jpeg?.url,
              medium_webp: variants.medium?.webp?.url,
              medium_jpeg: variants.medium?.jpeg?.url,
              large_webp: variants.large?.webp?.url,
              large_jpeg: variants.large?.jpeg?.url,
            },
            guestsBroadcasted: !isGuestUpload, // Only admin uploads broadcast to guests
            isGuestUpload: isGuestUpload || false
          };

        } catch (error: any) {
          const processingTime = Date.now() - startTime;
          logger.error(`❌ Processing failed: ${originalFilename} after ${processingTime}ms (${isGuestUpload ? 'Guest' : 'Admin'}):`, error);

          // 🔧 UPDATE FAILURE STATUS
          await Media.findByIdAndUpdate(mediaId, {
            'processing.status': 'failed',
            'processing.completed_at': new Date(),
            'processing.processing_time_ms': processingTime,
            'processing.error_message': error.message || 'Unknown processing error',
            'processing.retry_count': job.attemptsMade || 0,
          });

          // 🚀 NEW: Handle failure notifications differently for guest vs admin
          if (!isGuestUpload) {
            // Admin uploads: Notify guests of failure
            mediaWebSocketService.broadcastProcessingFailed({
              mediaId,
              eventId,
              errorMessage: error.message || 'Processing failed'
            });
          }

          // 🧹 CLEANUP on failure
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
        connection: redisConfig,
        concurrency: getConcurrencyLevel(),
      }
    );

    // 🚀 EVENT HANDLERS with WebSocket integration
    imageWorkerInstance.on('completed', (job: Job<ImageProcessingJobData>, result: ProcessingResult) => {
      const processingTime = Date.now() - job.timestamp;
      const uploadType = job.data.isGuestUpload ? 'Guest' : 'Admin';

      logger.info(`✅ Worker completed job ${job.id} in ${processingTime}ms - ${uploadType} upload - Guests notified: ${result.guestsBroadcasted}`);

      if (processingTime > 60000) { // 1 minute
        logger.warn(`🐌 Very slow job: ${job.id} took ${(processingTime / 1000).toFixed(1)}s`);
      }

      // 🚀 NEW: Update media statistics (for both admin and guest uploads)
      if (result.success && job.data.eventId) {
        if (!job.data.isGuestUpload) {
          // Only broadcast stats for admin uploads (guests see this)
          mediaWebSocketService.broadcastMediaStats(job.data.eventId);
        }
        // For guest uploads, admin will see updated counts when they refresh
      }
    });

    imageWorkerInstance.on('failed', (job: Job<ImageProcessingJobData> | undefined, err: Error) => {
      const uploadType = job?.data.isGuestUpload ? 'Guest' : 'Admin';

      logger.error(`❌ Worker failed job ${job?.id} (${uploadType}):`, {
        error: err.message,
        attempts: job?.attemptsMade,
        data: job?.data?.originalFilename,
        eventId: job?.data?.eventId,
        isGuestUpload: job?.data.isGuestUpload
      });

      // 🚀 NEW: Handle final failure differently for guest vs admin
      if (job && job.attemptsMade >= 3 && job.data?.eventId && job.data?.mediaId) {
        logger.warn(`❌ Final failure for ${job.data.mediaId} (${uploadType}), notifying appropriately`);

        if (!job.data.isGuestUpload) {
          // Admin upload failure: Notify guests
          mediaWebSocketService.broadcastProcessingFailed({
            mediaId: job.data.mediaId,
            eventId: job.data.eventId,
            errorMessage: 'Processing failed after multiple attempts'
          });
        }
        // Guest upload failure: Just log (admin will see failed status in their panel)
      }
    });

    imageWorkerInstance.on('progress', (job: Job<ImageProcessingJobData>, progress: number | object) => {
      if (typeof progress === 'number' && progress % 20 === 0) { // Log every 20%
        logger.debug(`📊 Job ${job.id} progress: ${progress}%`);
      }
    });

    logger.info(`✅ Enhanced image worker initialized with concurrency: ${getConcurrencyLevel()}`);
    return imageWorkerInstance;

  } catch (error) {
    logger.error('❌ Failed to initialize image worker:', error);
    throw error;
  }
};

/**
 * 🚀 CORE FUNCTION: Generate all image variants efficiently
 */
async function generateImageVariants(
  filePath: string,
  mediaId: string,
  eventId: string,
  progressCallback: (progress: number) => void
): Promise<{
  small?: { webp?: ImageVariant; jpeg?: ImageVariant };
  medium?: { webp?: ImageVariant; jpeg?: ImageVariant };
  large?: { webp?: ImageVariant; jpeg?: ImageVariant };
}> {
  const variants: any = {};

  try {
    // 🔧 DEFINE SIZES: Optimized for different use cases
    const sizes = {
      small: { width: 400, height: 400, quality: 80 },   // Thumbnails, mobile
      medium: { width: 800, height: 800, quality: 85 },  // Desktop feeds  
      large: { width: 1200, height: 1200, quality: 90 }  // Lightbox, zoom
    } as const;

    const sizeNames = Object.keys(sizes) as Array<keyof typeof sizes>;
    let completed = 0;
    const total = sizeNames.length * 2; // 2 formats per size

    // 🚀 PARALLEL PROCESSING: Generate all variants concurrently
    for (const sizeName of sizeNames) {
      const config = sizes[sizeName];

      // Generate both WebP and JPEG in parallel
      const [webpVariant, jpegVariant] = await Promise.all([
        generateSingleVariant(filePath, mediaId, eventId, sizeName, 'webp', config),
        generateSingleVariant(filePath, mediaId, eventId, sizeName, 'jpeg', config)
      ]);

      variants[sizeName] = {
        webp: webpVariant,
        jpeg: jpegVariant
      };

      completed += 2;
      progressCallback((completed / total) * 100);
    }

    return variants;

  } catch (error) {
    logger.error('Failed to generate variants:', error);
    throw error;
  }
}

/**
 * 🚀 OPTIMIZED: Generate single variant efficiently
 */
async function generateSingleVariant(
  filePath: string,
  mediaId: string,
  eventId: string,
  sizeName: string,
  format: 'webp' | 'jpeg',
  config: { width: number; height: number; quality: number }
): Promise<ImageVariant> {
  try {
    // 🔧 SHARP OPTIMIZATION: Progressive, optimized settings
    let sharpInstance = sharp(filePath)
      .resize(config.width, config.height, {
        fit: 'inside',
        withoutEnlargement: true
      });

    let buffer: Buffer;
    if (format === 'webp') {
      buffer = await sharpInstance
        .webp({
          quality: config.quality,
          effort: 4, // Good balance of quality/speed
          nearLossless: false
        })
        .toBuffer();
    } else {
      buffer = await sharpInstance
        .jpeg({
          quality: config.quality,
          progressive: true,
          mozjpeg: true // Better compression
        })
        .toBuffer();
    }

    // 🚀 GET VARIANT METADATA
    const metadata = await sharp(buffer).metadata();
    const sizeBytes = buffer.length;
    const sizeMB = Math.round((sizeBytes / (1024 * 1024)) * 100) / 100;

    // 🚀 UPLOAD TO IMAGEKIT with proper folder structure
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
      url,
      width: metadata.width || 0,
      height: metadata.height || 0,
      size_mb: sizeMB,
      format
    };

  } catch (error) {
    logger.error(`Failed to generate ${sizeName} ${format} variant:`, error);
    throw error;
  }
}

/**
 * 🚀 GET ORIGINAL METADATA: Comprehensive info with proper typing
 */
async function getOriginalImageMetadata(filePath: string) {
  try {
    const metadata = await sharp(filePath).metadata();
    const stats = await fs.stat(filePath);
    const sizeMB = Math.round((stats.size / (1024 * 1024)) * 100) / 100;

    // 🔧 FIX: Proper ICC profile handling
    let colorProfile = '';
    if (metadata.icc) {
      try {
        // ICC profile is a Buffer, extract description properly
        const iccBuffer = metadata.icc;
        if (Buffer.isBuffer(iccBuffer) && iccBuffer.length > 80) {
          // Look for description in ICC profile
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

/**
 * 🚀 UPLOAD ORIGINAL: Move to permanent storage
 */
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

/**
 * 🛠️ UTILITY FUNCTIONS
 */
function getConcurrencyLevel(): number {
  try {
    const cpuCores = require('os').cpus().length;
    const totalMemoryGB = require('os').totalmem() / (1024 * 1024 * 1024);

    // Conservative: 1-2 jobs per CPU core, limited by memory
    let concurrency = Math.max(1, Math.floor(cpuCores * 1.5));

    // Memory limit (assume 1GB per job for large images)
    const memoryBasedLimit = Math.floor(totalMemoryGB);
    concurrency = Math.min(concurrency, memoryBasedLimit);

    // Environment override
    if (process.env.IMAGE_WORKER_CONCURRENCY) {
      concurrency = parseInt(process.env.IMAGE_WORKER_CONCURRENCY);
    }

    // Limits: 1-6 for most servers
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

export const getImageWorker = (): Worker | null => {
  return imageWorkerInstance;
};
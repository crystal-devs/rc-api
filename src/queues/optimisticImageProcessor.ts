// queues/processors/optimisticImageProcessor.ts - ENHANCED BACKGROUND PROCESSING

import { Job } from 'bullmq';
import sharp from 'sharp';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { mediaNotificationService } from '@services/websocket/notifications';
import fs from 'fs/promises';

interface OptimisticProcessingJob {
    mediaId: string;
    userId: string;
    userName: string;
    eventId: string;
    albumId: string;
    filePath: string;
    originalFilename: string;
    fileSize: number;
    mimeType: string;
    isOptimistic?: boolean;
    tempUrl?: string;
    hasPreview?: boolean;
    previewBroadcasted?: boolean;
}

/**
 * Enhanced optimistic image processor with real-time progress updates
 */
export async function processOptimisticImage(job: Job<OptimisticProcessingJob>): Promise<void> {
    const {
        mediaId,
        eventId,
        filePath,
        originalFilename,
        isOptimistic = false,
        tempUrl,
        hasPreview = false
    } = job.data;

    const jobStartTime = Date.now();

    logger.info(`Processing ${isOptimistic ? 'optimistic' : 'regular'} image: ${originalFilename} (${mediaId})`);

    try {
        // STEP 1: Verify file exists and update progress
        try {
            await fs.access(filePath);
        } catch {
            throw new Error('Source file not found');
        }

        // Send progress update - Processing started
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'processing',
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'processing_started',
                progressPercentage: 30
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // STEP 2: Extract metadata
        const metadata = await extractImageMetadata(filePath);
        
        // Progress update - Metadata extracted
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'processing',
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'metadata_extracted',
                progressPercentage: 40
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // STEP 3: Create optimized main image
        const optimizedBuffer = await createOptimizedImage(filePath);
        
        // Progress update - Main image optimized
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'processing',
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'main_image_optimized',
                progressPercentage: 60
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // STEP 4: Upload main image to storage
        const mainUrl = await uploadImageToStorage(optimizedBuffer, mediaId, 'main');
        
        // Progress update - Main image uploaded
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'processing',
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'main_image_uploaded',
                progressPercentage: 75
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // STEP 5: Create variants (thumbnails, different sizes)
        const variants = await createImageVariants(filePath);
        
        // Progress update - Variants created
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'processing',
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'variants_created',
                progressPercentage: 90
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // STEP 6: Upload variants to storage
        const variantUrls = await uploadVariantsToStorage(variants, mediaId);

        // STEP 7: Update database with final URLs
        await updateMediaWithFinalUrls(mediaId, mainUrl, variantUrls, metadata);

        // STEP 8: Send completion notification
        const processingTime = Date.now() - jobStartTime;
        
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_complete',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                finalUrl: mainUrl,
                status: 'completed',
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'completed',
                progressPercentage: 100
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // Also use the existing broadcast method for backward compatibility
        mediaNotificationService.broadcastProcessingComplete({
            mediaId,
            eventId,
            newUrl: mainUrl,
            variants: variantUrls,
            processingTimeMs: processingTime
        });

        // STEP 9: Cleanup temporary files
        await cleanupTempFiles(filePath);

        logger.info(`Successfully processed ${originalFilename} in ${processingTime}ms`, {
            mediaId: mediaId.substring(0, 8) + '...',
            mainUrl,
            variantCount: Object.keys(variantUrls).length,
            isOptimistic
        });

    } catch (error: any) {
        logger.error(`Failed to process ${originalFilename}:`, error);

        // Send failure notification
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_failed',
            eventId,
            mediaData: {
                id: mediaId,
                filename: originalFilename,
                status: 'failed',
                error: error.message,
                uploadedBy: { id: '', name: '', type: 'admin' },
                processingStage: 'failed',
                progressPercentage: 0
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // Also use existing method for backward compatibility
        mediaNotificationService.broadcastProcessingFailed({
            mediaId,
            eventId,
            errorMessage: error.message
        });

        // Update database to mark as failed
        await Media.updateOne(
            { _id: mediaId },
            {
                $set: {
                    'processing.status': 'failed',
                    'processing.current_stage': 'failed',
                    'processing.progress_percentage': 0,
                    'processing.error_message': error.message,
                    'processing.completed_at': new Date()
                }
            }
        );

        // Cleanup temp files even on failure
        await cleanupTempFiles(filePath);

        throw error; // Re-throw for job failure handling
    }
}

/**
 * Extract image metadata efficiently
 */
async function extractImageMetadata(filePath: string): Promise<any> {
    try {
        const metadata = await sharp(filePath).metadata();
        
        return {
            width: metadata.width || 0,
            height: metadata.height || 0,
            format: metadata.format || 'jpeg',
            size: metadata.size || 0,
            density: metadata.density || 72,
            hasAlpha: metadata.hasAlpha || false,
            colorspace: metadata.space || 'srgb'
        };
    } catch (error) {
        logger.error('Failed to extract metadata:', error);
        return {
            width: 800,
            height: 600,
            format: 'jpeg',
            size: 0,
            density: 72,
            hasAlpha: false,
            colorspace: 'srgb'
        };
    }
}

/**
 * Create optimized main image
 */
async function createOptimizedImage(filePath: string): Promise<Buffer> {
    return await sharp(filePath)
        .resize(1920, 1920, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .jpeg({
            quality: 85,
            progressive: true,
            mozjpeg: true
        })
        .toBuffer();
}

/**
 * Create image variants (thumbnail, medium, etc.)
 */
async function createImageVariants(filePath: string): Promise<{
    thumbnail: Buffer;
    medium: Buffer;
    large: Buffer;
}> {
    const [thumbnail, medium, large] = await Promise.all([
        // Thumbnail - 300px
        sharp(filePath)
            .resize(300, 300, {
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer(),
        
        // Medium - 800px
        sharp(filePath)
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 85, progressive: true })
            .toBuffer(),
        
        // Large - 1200px  
        sharp(filePath)
            .resize(1200, 1200, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 90, progressive: true })
            .toBuffer()
    ]);

    return { thumbnail, medium, large };
}

/**
 * Upload image to storage service (replace with your storage logic)
 */
async function uploadImageToStorage(buffer: Buffer, mediaId: string, type: string): Promise<string> {
    try {
        // Replace this with your actual storage service (Cloudinary, S3, etc.)
        const { uploadToCloudinary } = require('@services/cloudinary');
        
        const result = await uploadToCloudinary(buffer, {
            folder: `media/${type}`,
            public_id: `${mediaId}_${type}`,
            resource_type: 'image',
            format: 'auto',
            quality: 'auto:good'
        });

        return result.secure_url;
    } catch (error) {
        logger.error('Failed to upload to storage:', error);
        throw new Error('Storage upload failed');
    }
}

/**
 * Upload variants to storage
 */
async function uploadVariantsToStorage(variants: any, mediaId: string): Promise<{
    thumbnail: string;
    medium: string;
    large: string;
}> {
    const [thumbnailUrl, mediumUrl, largeUrl] = await Promise.all([
        uploadImageToStorage(variants.thumbnail, mediaId, 'thumbnail'),
        uploadImageToStorage(variants.medium, mediaId, 'medium'), 
        uploadImageToStorage(variants.large, mediaId, 'large')
    ]);

    return {
        thumbnail: thumbnailUrl,
        medium: mediumUrl,
        large: largeUrl
    };
}

/**
 * Update media record with final URLs and metadata
 */
async function updateMediaWithFinalUrls(
    mediaId: string,
    mainUrl: string,
    variantUrls: any,
    metadata: any
): Promise<void> {
    await Media.updateOne(
        { _id: mediaId },
        {
            $set: {
                url: mainUrl,
                'image_variants.small.jpeg.url': variantUrls.thumbnail,
                'image_variants.medium.jpeg.url': variantUrls.medium,
                'image_variants.large.jpeg.url': variantUrls.large,
                'metadata.width': metadata.width,
                'metadata.height': metadata.height,
                'metadata.aspect_ratio': metadata.height / metadata.width,
                'processing.status': 'completed',
                'processing.current_stage': 'completed',
                'processing.progress_percentage': 100,
                'processing.completed_at': new Date(),
                'processing.variants_generated': true,
                'processing.variants_count': 3,
                'updated_at': new Date()
            }
        }
    );
}

/**
 * Cleanup temporary files
 */
async function cleanupTempFiles(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
        logger.debug(`Cleaned up temp file: ${filePath}`);
    } catch (error) {
        logger.warn(`Failed to cleanup temp file ${filePath}:`, error);
    }
}
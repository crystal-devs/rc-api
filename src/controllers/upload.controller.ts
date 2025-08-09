// controllers/upload.controller.ts - FIXED race condition

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { getImageQueue } from 'queues/imageQueue';
import { uploadPreviewImage } from '@services/uploadService';
import sharp from 'sharp';

interface AuthenticatedRequest extends Request {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
    };
    files?: Express.Multer.File[];
    sessionID?: string;
}

/**
 * 🚀 OPTIMIZED: Ultra-fast upload - responds immediately to frontend
 * Users see their images instantly while processing happens in background
 */
export const uploadMediaController = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<Response | void> => {
    const startTime = Date.now();

    try {
        const files = req.files as Express.Multer.File[] || [];
        const { album_id, event_id } = req.body;
        const user_id = req.user._id.toString();

        logger.info('📤 Upload request:', {
            fileCount: files.length,
            event_id,
            album_id,
            userId: user_id
        });

        // 🔧 FAST VALIDATION: Basic checks only
        if (!files || files.length === 0) {
            return res.status(400).json({
                status: false,
                message: "No files provided"
            });
        }

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            await cleanupFiles(files);
            return res.status(400).json({
                status: false,
                message: "Valid event_id is required"
            });
        }

        // 🚀 PARALLEL PROCESSING: Process all files concurrently
        const uploadPromises = files.map(file => processFileUpload(file, {
            userId: user_id,
            eventId: event_id,
            albumId: album_id || new mongoose.Types.ObjectId().toString()
        }));

        const results = await Promise.allSettled(uploadPromises);

        // 🔧 SEPARATE SUCCESS/FAILURES
        const successful = results
            .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
            .map(result => result.value);

        const failed = results
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result, index) => ({
                filename: files[index]?.originalname || 'unknown',
                error: result.reason?.message || 'Upload failed'
            }));

        const processingTime = Date.now() - startTime;
        logger.info(`📊 Upload completed in ${processingTime}ms:`, {
            successful: successful.length,
            failed: failed.length,
            total: files.length
        });

        // 🚨 CRITICAL: Send response immediately - users see images right away
        return res.status(200).json({
            status: successful.length > 0,
            message: generateSuccessMessage(successful.length, failed.length, files.length),
            data: {
                uploads: successful,
                errors: failed.length > 0 ? failed : undefined,
                summary: {
                    total: files.length,
                    successful: successful.length,
                    failed: failed.length,
                    processingTime: `${processingTime}ms`
                },
                note: "Images uploaded! High-quality versions processing in background..."
            }
        });

    } catch (error: any) {
        logger.error('❌ Upload controller error:', error);

        // Cleanup files on error
        if (req.files) {
            await cleanupFiles(req.files as Express.Multer.File[]);
        }

        return res.status(500).json({
            status: false,
            message: "Upload failed due to server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * 🚀 KEY FIX: Don't cleanup files immediately - let worker handle cleanup
 */
async function processFileUpload(
    file: Express.Multer.File,
    context: { userId: string; eventId: string; albumId: string }
): Promise<any> {
    try {
        // 🔧 FAST VALIDATION: Quick checks
        if (!isValidImageFile(file)) {
            await cleanupFile(file); // Only cleanup invalid files
            throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > 100) { // 100MB limit
            await cleanupFile(file); // Only cleanup oversized files
            throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB (max 100MB)`);
        }

        // 🚀 GENERATE IDs
        const mediaId = new mongoose.Types.ObjectId();
        const albumObjectId = new mongoose.Types.ObjectId(context.albumId);
        const eventObjectId = new mongoose.Types.ObjectId(context.eventId);
        const userObjectId = new mongoose.Types.ObjectId(context.userId);

        // 🚀 CRITICAL OPTIMIZATION: Create preview image immediately
        // This is what users see instantly while background processing happens
        const previewUrl = await createInstantPreview(file, mediaId.toString(), context.eventId);

        // 🔧 GET BASIC METADATA: Super fast
        const metadata = await getBasicImageMetadata(file.path);

        // 🚀 CREATE DATABASE RECORD: With preview URL so users see something immediately
        const media = new Media({
            _id: mediaId,
            url: previewUrl, // Users see this immediately
            type: 'image',
            album_id: albumObjectId,
            event_id: eventObjectId,
            uploaded_by: userObjectId,
            uploader_type: 'registered_user',
            original_filename: file.originalname,
            size_mb: fileSizeMB,
            format: getFileExtension(file),
            metadata: {
                width: metadata.width,
                height: metadata.height,
                aspect_ratio: metadata.aspect_ratio
            },
            processing: {
                status: 'processing', // Start as processing since we're about to queue
                started_at: new Date(),
                variants_generated: false,
            },
            approval: {
                status: 'approved', // Auto-approve for authenticated users
                auto_approval_reason: 'authenticated_user',
                approved_at: new Date(),
            }
        });

        // 🚀 SAVE TO DATABASE: Single atomic operation
        await media.save();

        logger.info(`✅ Media record created with preview: ${mediaId}`);

        // 🚀 QUEUE FOR BACKGROUND PROCESSING: Generate high-quality variants
        const imageQueue = getImageQueue();
        let jobId = null;

        if (imageQueue) {
            try {
                const job = await imageQueue.add('process-image', {
                    mediaId: mediaId.toString(),
                    userId: context.userId,
                    eventId: context.eventId,
                    albumId: context.albumId,
                    filePath: file.path, // 🔧 CRITICAL: Pass absolute path to worker
                    originalFilename: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                    hasPreview: true // Flag to indicate preview exists
                }, {
                    // 🔧 PRIORITY: Smaller files get higher priority
                    priority: fileSizeMB < 5 ? 10 : 5,
                    delay: 0, // Process immediately
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 }
                });

                jobId = job.id;
                logger.info(`✅ Job queued: ${job.id} for media ${mediaId} with file: ${file.path}`);

            } catch (queueError) {
                logger.error('Queue error (processing will be manual):', queueError);
                // Don't fail the upload if queue fails, but cleanup file
                await cleanupFile(file);
            }
        } else {
            // No queue available, cleanup file
            logger.warn('No image queue available, cleaning up file');
            await cleanupFile(file);
        }

        // 🚀 RETURN SUCCESS: Users see this immediately
        return {
            id: mediaId.toString(),
            filename: file.originalname,
            url: previewUrl, // Users can see image immediately
            status: jobId ? 'processing' : 'pending',
            jobId: jobId,
            size: `${fileSizeMB.toFixed(2)}MB`,
            dimensions: `${metadata.width}x${metadata.height}`,
            aspectRatio: metadata.aspect_ratio,
            estimatedProcessingTime: getEstimatedProcessingTime(file.size),
            message: "Image available! High-quality versions processing..."
        };

    } catch (error: any) {
        logger.error(`File processing error for ${file.originalname}:`, error);
        await cleanupFile(file); // Cleanup on any error
        throw error;
    }
}

/**
 * 🚀 CRITICAL NEW FUNCTION: Create instant preview for immediate user feedback
 * This runs fast (1-2 seconds) so users see their images right away
 */
async function createInstantPreview(
    file: Express.Multer.File,
    mediaId: string,
    eventId: string
): Promise<string> {
    try {
        // 🔧 FAST PREVIEW: Create medium-quality preview quickly
        const previewBuffer = await sharp(file.path)
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({
                quality: 85, // Good quality, fast processing
                progressive: true
            })
            .toBuffer();

        // 🚀 UPLOAD PREVIEW: Use upload service
        const previewUrl = await uploadPreviewImage(previewBuffer, mediaId, eventId);

        logger.info(`✅ Preview created: ${mediaId} -> ${previewUrl}`);
        return previewUrl;

    } catch (error) {
        logger.error('Preview creation failed:', error);
        // Fallback: return placeholder URL
        return '/placeholder-image.jpg';
    }
}

/**
 * 🚀 FAST METADATA: Get basic info quickly
 */
async function getBasicImageMetadata(filePath: string) {
    try {
        const metadata = await sharp(filePath).metadata();
        return {
            width: metadata.width || 0,
            height: metadata.height || 0,
            aspect_ratio: metadata.height && metadata.width ? metadata.height / metadata.width : 1
        };
    } catch (error) {
        logger.warn('Failed to get metadata:', error);
        return { width: 0, height: 0, aspect_ratio: 1 };
    }
}

/**
 * 🚀 STATUS ENDPOINT: Fast status checking
 */
export const getUploadStatusController = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { mediaId } = req.params;

        const media = await Media.findById(mediaId)
            .select('original_filename processing url image_variants metadata')
            .lean();

        if (!media) {
            return res.status(404).json({
                status: false,
                message: 'Media not found'
            });
        }

        const processingStatus = media.processing?.status || 'unknown';
        const hasVariants = !!media.image_variants;

        return res.json({
            status: true,
            data: {
                id: mediaId,
                filename: media.original_filename,
                processingStatus,
                isComplete: processingStatus === 'completed' && hasVariants,
                isFailed: processingStatus === 'failed',
                isProcessing: processingStatus === 'processing',
                url: media.url, // Current best URL
                hasVariants,
                dimensions: media.metadata ? `${media.metadata.width}x${media.metadata.height}` : 'Unknown',
                message: getStatusMessage(processingStatus, hasVariants)
            }
        });

    } catch (error: any) {
        logger.error('Status check error:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to get status'
        });
    }
};

/**
 * 🚀 BATCH STATUS ENDPOINT: For monitoring multiple uploads
 */
export const getBatchUploadStatusController = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { mediaIds } = req.body;

        if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
            return res.status(400).json({
                status: false,
                message: 'mediaIds must be a non-empty array'
            });
        }

        // 🔧 BATCH QUERY: Get all at once
        const mediaList = await Media.find({
            _id: { $in: mediaIds }
        })
            .select('original_filename processing url image_variants')
            .lean();

        const results = mediaList.map(media => ({
            id: media._id,
            filename: media.original_filename,
            processingStatus: media.processing?.status || 'unknown',
            isComplete: media.processing?.status === 'completed' && !!media.image_variants,
            isFailed: media.processing?.status === 'failed',
            isProcessing: media.processing?.status === 'processing',
            url: media.url,
            hasVariants: !!media.image_variants,
            message: getStatusMessage(media.processing?.status || 'unknown', !!media.image_variants)
        }));

        return res.json({
            status: true,
            data: results
        });

    } catch (error: any) {
        logger.error('Batch status check error:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to get batch status'
        });
    }
};

/**
 * 🛠️ UTILITY FUNCTIONS
 */

function isValidImageFile(file: Express.Multer.File): boolean {
    const supportedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
        'image/heic', 'image/heif', 'image/tiff', 'image/tif'
    ];
    return supportedTypes.includes(file.mimetype.toLowerCase());
}

function getFileExtension(file: Express.Multer.File): string {
    return file.mimetype.split('/')[1] || 'jpg';
}

function getEstimatedProcessingTime(fileSizeBytes: number): string {
    const sizeMB = fileSizeBytes / (1024 * 1024);
    const seconds = Math.max(5, Math.min(sizeMB * 2, 30)); // 5-30 seconds
    return `${Math.round(seconds)}s`;
}

function getStatusMessage(status: string, hasVariants: boolean): string {
    switch (status) {
        case 'completed':
            return hasVariants ? 'All variants ready!' : 'Processing completed';
        case 'failed':
            return 'Processing failed';
        case 'processing':
            return 'Creating high-quality versions...';
        case 'pending':
            return 'Queued for processing';
        default:
            return 'Status unknown';
    }
}

function generateSuccessMessage(successful: number, failed: number, total: number): string {
    if (failed === 0) {
        return total === 1
            ? 'Photo uploaded successfully!'
            : `All ${successful} photos uploaded successfully!`;
    }

    if (successful === 0) {
        return total === 1
            ? 'Photo upload failed'
            : 'All photo uploads failed';
    }

    return `${successful} photo${successful > 1 ? 's' : ''} uploaded successfully, ${failed} failed`;
}

async function cleanupFile(file: Express.Multer.File): Promise<void> {
    try {
        if (file.path) {
            await fs.unlink(file.path);
            logger.debug(`🧹 Cleaned up file: ${file.path}`);
        }
    } catch (error) {
        logger.warn(`Failed to cleanup file ${file.path}:`, error);
    }
}

async function cleanupFiles(files: Express.Multer.File[]): Promise<void> {
    await Promise.all(files.map(file => cleanupFile(file)));
}
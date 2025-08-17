// controllers/upload.controller.ts

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { getImageQueue } from 'queues/imageQueue';
import sharp from 'sharp';
import { mediaNotificationService } from '@services/websocket/notifications';
import { uploadPreviewImage } from '@services/upload/core/upload-variants.service';
import { getPhotoWallWebSocketService } from '@services/photoWallWebSocketService';

interface AuthenticatedRequest extends Request {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
        name?: string;
    };
    files?: Express.Multer.File[];
    sessionID?: string;
}

/**
 * 🚀 ENHANCED: Ultra-fast upload with real-time guest broadcasting
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
        const userName = req.user.name || 'Admin';

        logger.info('📤 Upload request:', {
            fileCount: files.length,
            event_id,
            album_id,
            userId: user_id,
            userName
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
        const uploadPromises = files.map(file => processFileUploadWithBroadcast(file, {
            userId: user_id,
            userName,
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

        // 🚀 SINGLE BROADCAST: Update all clients (guests AND photo walls)
        if (successful.length > 0) {
            mediaNotificationService.broadcastMediaStats(event_id);
        }

        logger.info(`📊 Upload completed in ${processingTime}ms:`, {
            successful: successful.length,
            failed: failed.length,
            total: files.length,
            broadcastSent: successful.length > 0
        });

        // 🚨 CRITICAL: Send response immediately
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
                    processingTime: `${processingTime}ms`,
                    allClientsBroadcasted: successful.length > 0
                },
                note: "Images uploaded! All clients (guests & photo walls) updated in real-time. High-quality versions processing..."
            }
        });

    } catch (error: any) {
        logger.error('❌ Upload controller error:', error);

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
 * 🚀 ENHANCED: Process file upload with WebSocket broadcasting
 */
async function processFileUploadWithBroadcast(
    file: Express.Multer.File,
    context: { userId: string; userName: string; eventId: string; albumId: string }
): Promise<any> {
    try {
        // 🔧 FAST VALIDATION: Quick checks
        if (!isValidImageFile(file)) {
            await cleanupFile(file);
            throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > 100) {
            await cleanupFile(file);
            throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB (max 100MB)`);
        }

        // 🚀 GENERATE IDs
        const mediaId = new mongoose.Types.ObjectId();
        const albumObjectId = new mongoose.Types.ObjectId(context.albumId);
        const eventObjectId = new mongoose.Types.ObjectId(context.eventId);
        const userObjectId = new mongoose.Types.ObjectId(context.userId);

        // 🚀 CRITICAL: Create preview image immediately
        const previewUrl = await createInstantPreview(file, mediaId.toString(), context.eventId);

        // 🔧 GET BASIC METADATA
        const metadata = await getBasicImageMetadata(file.path);

        // 🚀 CREATE DATABASE RECORD
        const media = new Media({
            _id: mediaId,
            url: previewUrl,
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
                status: 'processing',
                started_at: new Date(),
                variants_generated: false,
            },
            approval: {
                status: 'approved', // Auto-approve for authenticated users
                auto_approval_reason: 'authenticated_user',
                approved_at: new Date(),
            }
        });

        await media.save();
        // 🚀 NEW: Broadcast to guests immediately after preview is ready
        mediaNotificationService.broadcastNewMediaToGuests({
            mediaId: mediaId.toString(),
            eventId: context.eventId,
            uploadedBy: {
                id: context.userId,
                name: context.userName,
                type: 'admin'
            },
            mediaData: {
                url: previewUrl,
                filename: file.originalname,
                type: 'image',
                size: file.size,
                format: getFileExtension(file)
            }
        });

        logger.info(`✅ Media created and broadcasted to guests: ${mediaId}`);

        // 🚀 QUEUE FOR BACKGROUND PROCESSING
        const imageQueue = getImageQueue();
        let jobId = null;

        if (imageQueue) {
            try {
                const job = await imageQueue.add('process-image', {
                    mediaId: mediaId.toString(),
                    userId: context.userId,
                    userName: context.userName,
                    eventId: context.eventId,
                    albumId: context.albumId,
                    filePath: file.path,
                    originalFilename: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                    hasPreview: true,
                    previewBroadcasted: true
                }, {
                    priority: fileSizeMB < 5 ? 10 : 5,
                    delay: 0,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 }
                });

                jobId = job.id;
                logger.info(`✅ Job queued with broadcast context: ${job.id}`);

            } catch (queueError) {
                logger.error('Queue error:', queueError);
                await cleanupFile(file);
            }
        } else {
            logger.warn('No image queue available');
            await cleanupFile(file);
        }

        return {
            id: mediaId.toString(),
            filename: file.originalname,
            url: previewUrl,
            status: jobId ? 'processing' : 'pending',
            jobId: jobId,
            size: `${fileSizeMB.toFixed(2)}MB`,
            dimensions: `${metadata.width}x${metadata.height}`,
            aspectRatio: metadata.aspect_ratio,
            estimatedProcessingTime: getEstimatedProcessingTime(file.size),
            guestsBroadcasted: true,
            message: "Image available to guests! High-quality versions processing..."
        };

    } catch (error: any) {
        logger.error(`File processing error for ${file.originalname}:`, error);
        await cleanupFile(file);
        throw error;
    }
}

/**
 * 🚀 CRITICAL: Create instant preview for immediate user feedback
 */
async function createInstantPreview(
    file: Express.Multer.File,
    mediaId: string,
    eventId: string
): Promise<string> {
    try {
        const previewBuffer = await sharp(file.path)
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({
                quality: 85,
                progressive: true
            })
            .toBuffer();

        const previewUrl = await uploadPreviewImage(previewBuffer, mediaId, eventId);
        logger.info(`✅ Preview created for guests: ${mediaId} -> ${previewUrl}`);
        return previewUrl;

    } catch (error) {
        logger.error('Preview creation failed:', error);
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

// Keep all existing status controller functions unchanged...
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
                url: media.url,
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

// Utility functions (unchanged)
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
    const seconds = Math.max(5, Math.min(sizeMB * 2, 30));
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
            ? 'Photo uploaded and shared with guests!'
            : `All ${successful} photos uploaded and shared with guests!`;
    }

    if (successful === 0) {
        return total === 1
            ? 'Photo upload failed'
            : 'All photo uploads failed';
    }

    return `${successful} photo${successful > 1 ? 's' : ''} uploaded and shared, ${failed} failed`;
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
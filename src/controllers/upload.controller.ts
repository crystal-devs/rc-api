// controllers/upload.controller.ts - Optimized for smooth upload experience

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { checkUserLimitsService } from '@services/user.service';
import { Media } from '@models/media.model';
import { getImageQueue } from 'queues/imageQueue';

interface AuthenticatedRequest extends Request {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
    };
    file?: Express.Multer.File;
    sessionID?: string;
}

/**
 * 🚀 OPTIMIZED: Ultra-fast upload controller
 * Goal: Return response to frontend immediately, process in background
 */
export const uploadMediaController = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<Response | void> => {
    const startTime = Date.now();
    
    try {
        const files = req.files as Express.Multer.File[] || (req.file ? [req.file] : []);
        const { album_id, event_id } = req.body;
        const user_id = req.user._id.toString();

        logger.info('📤 Upload request:', { 
            fileCount: files.length, 
            event_id, 
            album_id,
            userId: user_id
        });

        // 🔧 FAST VALIDATION: Early validation without complex checks
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

        // 🚨 CRITICAL: Send response immediately to frontend
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
                note: "Files uploaded successfully! Processing in background..."
            }
        });

    } catch (error: any) {
        logger.error('❌ Upload controller error:', error);

        // Cleanup files on error
        if (req.files || req.file) {
            const files = Array.isArray(req.files) ? req.files : [req.file].filter(Boolean);
            await cleanupFiles(files as Express.Multer.File[]);
        }

        return res.status(500).json({
            status: false,
            message: "Upload failed due to server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * 🚀 OPTIMIZED: Single file processing with minimal database overhead
 */
async function processFileUpload(
    file: Express.Multer.File,
    context: { userId: string; eventId: string; albumId: string }
): Promise<any> {
    try {
        // 🔧 FAST VALIDATION: Quick file checks
        if (!isValidImageFile(file)) {
            await cleanupFile(file);
            throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        // 🔧 FAST SIZE CHECK: Quick size validation
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > 100) { // 100MB limit
            await cleanupFile(file);
            throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB (max 100MB)`);
        }

        // 🚀 GENERATE IDS: Pre-generate all IDs
        const mediaId = new mongoose.Types.ObjectId();
        const albumObjectId = new mongoose.Types.ObjectId(context.albumId);
        const eventObjectId = new mongoose.Types.ObjectId(context.eventId);
        const userObjectId = new mongoose.Types.ObjectId(context.userId);

        // 🚀 CREATE DATABASE RECORD: Minimal required fields only
        const media = new Media({
            _id: mediaId,
            url: '', // Will be updated after processing
            type: 'image',
            album_id: albumObjectId,
            event_id: eventObjectId,
            uploaded_by: userObjectId,
            uploader_type: 'registered_user',
            original_filename: file.originalname,
            size_mb: fileSizeMB,
            format: getFileExtension(file),
            processing: {
                status: 'pending',
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
        
        logger.info(`✅ Media record created: ${mediaId}`);

        // 🚀 QUEUE FOR PROCESSING: Add to background queue
        const imageQueue = getImageQueue();
        let jobId = null;

        if (imageQueue) {
            try {
                const job = await imageQueue.add('process-image', {
                    mediaId: mediaId.toString(),
                    userId: context.userId,
                    eventId: context.eventId,
                    albumId: context.albumId,
                    filePath: file.path,
                    originalFilename: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                }, {
                    // 🔧 PRIORITY: Smaller files get higher priority
                    priority: fileSizeMB < 5 ? 10 : 5,
                    delay: 0, // Process immediately
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 }
                });

                jobId = job.id;
                logger.info(`✅ Job queued: ${job.id} for media ${mediaId}`);

            } catch (queueError) {
                logger.error('Queue error (processing will be manual):', queueError);
                // Don't fail the upload if queue fails
            }
        }

        // 🚀 RETURN SUCCESS: Minimal response data
        return {
            id: mediaId.toString(),
            filename: file.originalname,
            status: jobId ? 'queued' : 'pending',
            jobId: jobId,
            size: `${fileSizeMB.toFixed(2)}MB`,
            estimatedProcessingTime: getEstimatedProcessingTime(file.size)
        };

    } catch (error: any) {
        logger.error(`File processing error for ${file.originalname}:`, error);
        await cleanupFile(file);
        throw error;
    }
}

/**
 * 🚀 OPTIMIZED: Lightweight status endpoint
 */
export const getUploadStatusController = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { mediaId } = req.params;

        // 🔧 FAST QUERY: Only get required fields
        const media = await Media.findById(mediaId)
            .select('original_filename processing url image_variants')
            .lean(); // Use lean() for faster queries

        if (!media) {
            return res.status(404).json({
                status: false,
                message: 'Media not found'
            });
        }

        const processingStatus = media.processing?.status || 'unknown';
        const isComplete = processingStatus === 'completed';
        const isFailed = processingStatus === 'failed';
        const isProcessing = processingStatus === 'processing';

        // 🚀 FAST RESPONSE: Minimal data
        return res.json({
            status: true,
            data: {
                id: mediaId,
                filename: media.original_filename,
                processingStatus,
                isComplete,
                isFailed,
                isProcessing,
                url: media.url,
                hasVariants: !!media.image_variants,
                message: getStatusMessage(processingStatus)
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
 * 🚀 OPTIMIZED: Batch status for multiple files
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
        .select('original_filename processing url')
        .lean(); // Faster queries

        const results = mediaList.map(media => ({
            id: media._id,
            filename: media.original_filename,
            status: media.processing?.status || 'unknown',
            isComplete: media.processing?.status === 'completed',
            url: media.url
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
    const seconds = Math.max(3, Math.min(sizeMB * 1.5, 15)); // 3-15 seconds
    return `${Math.round(seconds)}s`;
}

function getStatusMessage(status: string): string {
    switch (status) {
        case 'completed': return 'Processing completed successfully';
        case 'failed': return 'Processing failed';
        case 'processing': return 'Image is being processed...';
        case 'pending': return 'Queued for processing';
        default: return 'Status unknown';
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
        }
    } catch (error) {
        logger.warn(`Failed to cleanup file ${file.path}:`, error);
    }
}

async function cleanupFiles(files: Express.Multer.File[]): Promise<void> {
    await Promise.all(files.map(file => cleanupFile(file)));
}
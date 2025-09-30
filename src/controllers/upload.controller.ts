// controllers/modernOptimisticUpload.controller.ts - ImageKit Integration

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { logger } from '@utils/logger';
import { Media, ProcessingStage } from '@models/media.model';
import { getImageQueue } from 'queues/imageQueue';
import { mediaNotificationService } from '@services/websocket/notifications';
import { EventParticipant } from '@models/event-participants.model';
import { Event } from '@models/event.model';
import { imagekit } from '@configs/imagekit.config';

interface AuthenticatedRequest extends Request {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        name?: string;
    };
    files?: Express.Multer.File[];
}

/**
 * MODERN: Optimistic Upload with ImageKit
 * Flow: Upload low-quality to ImageKit → Broadcast → Process variants in background
 */
export const optimisticUploadController = async (
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

        logger.info('Optimistic upload started:', {
            fileCount: files.length,
            event_id,
            userId: user_id.substring(0, 8) + '...'
        });

        // Validation
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

        // STEP 1: Upload to ImageKit immediately (low quality, fast)
        const optimisticUploads = await uploadToImageKitOptimistic(files, {
            eventId: event_id,
            userId: user_id,
            userName
        });

        // STEP 2: Broadcast to ALL users via WebSocket
        for (const upload of optimisticUploads) {
            mediaNotificationService.broadcastOptimisticMediaUpdate({
                type: 'optimistic_upload',
                eventId: event_id,
                mediaData: {
                    id: upload.mediaId,
                    filename: upload.filename,
                    tempUrl: upload.tempUrl, // ImageKit URL - no CORS issues
                    status: 'optimistic',
                    uploadedBy: {
                        id: user_id,
                        name: userName,
                        type: 'admin'
                    },
                    metadata: {
                        size: upload.size,
                        format: upload.format,
                        uploadTime: new Date()
                    },
                    processingStage: 'optimistic',
                    progressPercentage: 10
                },
                timestamp: new Date(),
                allUsersCanSee: true
            });
        }

        // STEP 3: Queue background processing for variants
        setImmediate(() => {
            processHighQualityVariants(optimisticUploads, {
                userId: user_id,
                userName,
                eventId: event_id,
                albumId: album_id || new mongoose.Types.ObjectId().toString()
            });
        });

        const processingTime = Date.now() - startTime;

        logger.info(`Optimistic upload completed in ${processingTime}ms`);

        // STEP 4: Return immediate response
        return res.status(200).json({
            status: true,
            message: `${optimisticUploads.length} photo${optimisticUploads.length > 1 ? 's' : ''} uploaded instantly!`,
            data: {
                uploads: optimisticUploads.map(upload => ({
                    id: upload.mediaId,
                    filename: upload.filename,
                    tempUrl: upload.tempUrl,
                    status: 'visible_to_all',
                    processingStatus: 'optimistic',
                    visibleToGuests: true
                })),
                processingTime: `${processingTime}ms`,
                strategy: 'optimistic_ui',
                note: "Images visible immediately! High-quality versions processing..."
            }
        });

    } catch (error: any) {
        logger.error('Optimistic upload failed:', error);

        if (req.files) {
            await cleanupFiles(req.files as Express.Multer.File[]);
        }

        return res.status(500).json({
            status: false,
            message: error.message || "Upload failed"
        });
    }
};

/**
 * STEP 1: Upload to ImageKit (low quality for instant preview)
 */
async function uploadToImageKitOptimistic(
    files: Express.Multer.File[],
    context: { eventId: string; userId: string; userName: string }
) {
    const uploads = [];

    for (const file of files) {
        try {
            // Validate
            if (!isValidImageFile(file)) {
                await cleanupFile(file);
                continue;
            }

            if (file.size > 100 * 1024 * 1024) {
                await cleanupFile(file);
                continue;
            }

            const mediaId = new mongoose.Types.ObjectId();

            // Create low-quality version for instant preview
            const lowQualityBuffer = await sharp(file.path)
                .resize(800, 800, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 60, progressive: true })
                .toBuffer();

            // Upload to ImageKit
            const uploadResult = await imagekit.upload({
                file: lowQualityBuffer,
                fileName: `temp_${mediaId}_${file.originalname}`,
                folder: `/events/${context.eventId}/temp`,
                useUniqueFileName: true,
                tags: ['optimistic', 'temp', context.eventId]
            });

            uploads.push({
                mediaId: mediaId.toString(),
                filename: file.originalname,
                tempUrl: uploadResult.url, // ImageKit CDN URL (no CORS)
                tempFileId: uploadResult.fileId,
                originalPath: file.path, // Keep for variant processing
                size: file.size,
                format: getFileExtension(file)
            });

            logger.info(`Uploaded to ImageKit: ${file.originalname} (${uploadResult.fileId})`);

        } catch (error) {
            logger.error(`Failed to upload ${file.originalname} to ImageKit:`, error);
            await cleanupFile(file);
        }
    }

    return uploads;
}

/**
 * STEP 3: Background processing - Create variants and upload to ImageKit
 */
async function processHighQualityVariants(
    uploads: any[],
    context: { userId: string; userName: string; eventId: string; albumId: string }
) {
    for (const upload of uploads) {
        try {
            const mediaId = upload.mediaId;
            const originalPath = upload.originalPath;

            // Progress: Starting variant creation
            mediaNotificationService.broadcastOptimisticMediaUpdate({
                type: 'processing_progress',
                eventId: context.eventId,
                mediaData: {
                    id: mediaId,
                    filename: upload.filename,
                    status: 'processing',
                    processingStage: 'creating_variants',
                    progressPercentage: 30,
                    uploadedBy: { id: '', name: '', type: 'admin' }
                },
                timestamp: new Date(),
                allUsersCanSee: true
            });

            // Create variants using Sharp
            const variants = await createImageVariants(originalPath);

            // Progress: Uploading variants
            mediaNotificationService.broadcastOptimisticMediaUpdate({
                type: 'processing_progress',
                eventId: context.eventId,
                mediaData: {
                    id: mediaId,
                    filename: upload.filename,
                    status: 'processing',
                    processingStage: 'uploading_variants',
                    progressPercentage: 60,
                    uploadedBy: { id: '', name: '', type: 'admin' }
                },
                timestamp: new Date(),
                allUsersCanSee: true
            });

            // Upload variants to ImageKit
            const variantUrls = await uploadVariantsToImageKit(variants, {
                mediaId,
                eventId: context.eventId,
                filename: upload.filename
            });

            // Progress: Saving to database
            mediaNotificationService.broadcastOptimisticMediaUpdate({
                type: 'processing_progress',
                eventId: context.eventId,
                mediaData: {
                    id: mediaId,
                    filename: upload.filename,
                    status: 'processing',
                    processingStage: 'saving_to_database',
                    progressPercentage: 90,
                    uploadedBy: { id: '', name: '', type: 'admin' }
                },
                timestamp: new Date(),
                allUsersCanSee: true
            });

            // Save to database
            await saveMediaToDatabase(mediaId, upload, variantUrls, context);

            // Delete temp low-quality version from ImageKit
            try {
                await imagekit.deleteFile(upload.tempFileId);
            } catch (err) {
                logger.warn(`Failed to delete temp file: ${upload.tempFileId}`);
            }

            // Cleanup local file
            await cleanupFile({ path: originalPath } as any);

            // Broadcast completion with final URLs
            mediaNotificationService.broadcastOptimisticMediaUpdate({
                type: 'processing_complete',
                eventId: context.eventId,
                mediaData: {
                    id: mediaId,
                    filename: upload.filename,
                    finalUrl: variantUrls.large,
                    status: 'completed',
                    image_variants: {
                        small: { jpeg: { url: variantUrls.small } },
                        medium: { jpeg: { url: variantUrls.medium } },
                        large: { jpeg: { url: variantUrls.large } }
                    },
                    processingStage: 'completed',
                    progressPercentage: 100,
                    uploadedBy: { id: '', name: '', type: 'admin' }
                },
                timestamp: new Date(),
                allUsersCanSee: true
            });

            logger.info(`Successfully processed ${upload.filename}`);

        } catch (error) {
            logger.error(`Failed to process ${upload.filename}:`, error);

            // Broadcast failure
            mediaNotificationService.broadcastOptimisticMediaUpdate({
                type: 'processing_failed',
                eventId: context.eventId,
                mediaData: {
                    id: upload.mediaId,
                    filename: upload.filename,
                    status: 'failed',
                    error: 'Processing failed',
                    processingStage: 'failed',
                    progressPercentage: 0,
                    uploadedBy: { id: '', name: '', type: 'admin' }
                },
                timestamp: new Date(),
                allUsersCanSee: true
            });

            // Cleanup
            await cleanupFile({ path: upload.originalPath } as any);
        }
    }
}

/**
 * Create image variants using Sharp
 */
async function createImageVariants(filePath: string) {
    const [small, medium, large] = await Promise.all([
        // Small - 300px (thumbnail)
        sharp(filePath)
            .resize(300, 300, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer(),

        // Medium - 800px
        sharp(filePath)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85, progressive: true })
            .toBuffer(),

        // Large - 1920px (high quality)
        sharp(filePath)
            .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90, progressive: true, mozjpeg: true })
            .toBuffer()
    ]);

    return { small, medium, large };
}

/**
 * Upload variants to ImageKit
 */
async function uploadVariantsToImageKit(
    variants: any,
    context: { mediaId: string; eventId: string; filename: string }
) {
    const [smallResult, mediumResult, largeResult] = await Promise.all([
        imagekit.upload({
            file: variants.small,
            fileName: `${context.mediaId}_small_${context.filename}`,
            folder: `/events/${context.eventId}/variants`,
            tags: ['small', 'thumbnail', context.eventId]
        }),
        imagekit.upload({
            file: variants.medium,
            fileName: `${context.mediaId}_medium_${context.filename}`,
            folder: `/events/${context.eventId}/variants`,
            tags: ['medium', context.eventId]
        }),
        imagekit.upload({
            file: variants.large,
            fileName: `${context.mediaId}_large_${context.filename}`,
            folder: `/events/${context.eventId}/variants`,
            tags: ['large', 'high-quality', context.eventId]
        })
    ]);

    return {
        small: smallResult.url,
        medium: mediumResult.url,
        large: largeResult.url
    };
}

/**
 * Save media to database with all variant URLs
 */
async function saveMediaToDatabase(
    mediaId: string,
    upload: any,
    variantUrls: any,
    context: { userId: string; eventId: string; albumId: string }
) {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            // 1. Save media document
            const media = new Media({
                _id: new mongoose.Types.ObjectId(mediaId),
                url: variantUrls.large,
                type: 'image',
                album_id: new mongoose.Types.ObjectId(context.albumId),
                event_id: new mongoose.Types.ObjectId(context.eventId),
                uploaded_by: new mongoose.Types.ObjectId(context.userId),
                uploader_type: 'registered_user',
                original_filename: upload.filename,
                size_mb: upload.size / (1024 * 1024),
                format: upload.format,

                // Only JPEG variants (WebP optional)
                image_variants: {
                    small: {
                        jpeg: {
                            url: variantUrls.small,
                            width: 300,
                            height: 300,
                            size_mb: 0.05,
                            format: 'jpeg'
                        }
                    },
                    medium: {
                        jpeg: {
                            url: variantUrls.medium,
                            width: 800,
                            height: 800,
                            size_mb: 0.15,
                            format: 'jpeg'
                        }
                    },
                    large: {
                        jpeg: {
                            url: variantUrls.large,
                            width: 1920,
                            height: 1920,
                            size_mb: 0.3,
                            format: 'jpeg'
                        }
                    },
                    original: {
                        url: variantUrls.large,
                        width: 1920,
                        height: 1920,
                        size_mb: upload.size / (1024 * 1024),
                        format: 'jpeg'
                    }
                },

                processing: {
                    status: 'completed',
                    current_stage: 'completed',
                    progress_percentage: 100,
                    started_at: new Date(),
                    completed_at: new Date(),
                    variants_generated: true,
                    variants_count: 3
                },

                approval: {
                    status: 'approved',
                    auto_approval_reason: 'authenticated_user',
                    approved_at: new Date()
                }
            });

            await media.save({ session });

            // 2. Update Event stats (simple increment)
            await Event.updateOne(
                { _id: new mongoose.Types.ObjectId(context.eventId) },
                {
                    $inc: {
                        'stats.photos': 1,
                        'stats.total_size_mb': upload.size / (1024 * 1024)
                    },
                    $set: { 'updated_at': new Date() }
                },
                { session }
            );

            // 3. INDUSTRY STANDARD: Check first, then update or create
            const participant = await EventParticipant.findOne({
                user_id: new mongoose.Types.ObjectId(context.userId),
                event_id: new mongoose.Types.ObjectId(context.eventId)
            }).session(session);

            if (participant) {
                // Update existing participant
                await EventParticipant.updateOne(
                    { _id: participant._id },
                    {
                        $inc: {
                            'stats.uploads_count': 1,
                            'stats.total_file_size_mb': upload.size / (1024 * 1024)
                        },
                        $set: {
                            'stats.last_upload_at': new Date(),
                            'last_activity_at': new Date()
                        }
                    },
                    { session }
                );
            } else {
                // Create new participant with all required fields
                await EventParticipant.create([{
                    user_id: new mongoose.Types.ObjectId(context.userId),
                    event_id: new mongoose.Types.ObjectId(context.eventId),
                    join_method: 'admin_upload',
                    status: 'active',
                    joined_at: new Date(),
                    stats: {
                        uploads_count: 1,
                        total_file_size_mb: upload.size / (1024 * 1024),
                        last_upload_at: new Date()
                    },
                    last_activity_at: new Date()
                }], { session });
            }
        });

        logger.info(`Successfully saved media ${mediaId} to database`);

    } catch (error) {
        logger.error('Failed to save media to database:', error);
        throw error;
    } finally {
        await session.endSession();
    }
}

// Utility functions
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
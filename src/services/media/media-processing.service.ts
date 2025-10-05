// services/media/media-processing.service.ts - FIXED VERSION
// ====================================

import fs from 'fs/promises';
import sharp from 'sharp';
import { logger } from '@utils/logger';
import mongoose from 'mongoose';
import { variantConfigService } from '@services/processing/config/variant-config.service';
import { imageOptimizerService } from '@services/processing/core/image-optimizer.service';
import { variantOrganizerService } from '@services/processing/organizer/variant-organizer.service';
import { mediaNotificationService } from '@services/websocket/notifications';
import { createGuestUploaderInfo, Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { EventParticipant } from '@models/event-participants.model';
import { ImageKitUploadService } from '@services/external/imagekit';
import { unifiedProgressService } from '@services/websocket/unified-progress.service';
import { GuestSession } from '@models/guest-session.model';
import { accessControlService } from '@services/event/access';

interface ProcessingContext {
    eventId: string;
    albumId?: string;
    userId: string;
    userName: string;
    isGuestUpload?: boolean;
    guestSessionId?: string;
    guestInfo: any
}

interface ProcessingResult {
    mediaId: string;
    filename: string;
    tempUrl: string;
    status: string;
    size: number;
    format: string;
}

enum ProcessingStage {
    UPLOADING = 'uploading',           // 0-20%
    CREATING_PREVIEW = 'creating_preview', // 20-30%
    PROCESSING = 'processing',          // 30-60%
    OPTIMIZING = 'optimizing',          // 60-80%
    FINALIZING = 'finalizing',          // 80-95%
    COMPLETED = 'completed'             // 100%
}

class MediaProcessingServiceClass {
    /**
     * MAIN ENTRY POINT: Process optimistic upload
     */
    async processOptimisticUpload(
        files: Express.Multer.File[],
        context: ProcessingContext
    ): Promise<ProcessingResult[]> {
        const results: ProcessingResult[] = [];

        for (const file of files) {
            try {
                // Validate file
                if (!this.isValidImageFile(file)) {
                    await this.cleanupFile(file.path);
                    continue;
                }

                const mediaId = new mongoose.Types.ObjectId().toString();

                // STEP 1: Initialize progress tracking
                unifiedProgressService.initializeUpload(
                    mediaId,
                    context.eventId,
                    file.originalname,
                    file.size
                );

                // STEP 2: Update progress - Starting upload
                unifiedProgressService.updateUploadProgress(mediaId, 0, file.size);

                // STEP 3: Create and upload optimistic preview
                const previewResult = await this.createAndUploadOptimisticPreview(
                    file,
                    mediaId,
                    context.eventId
                );

                // STEP 4: Update progress - Preview ready
                unifiedProgressService.updatePreviewProgress(mediaId, true);

                // STEP 5: Broadcast optimistic update (for backward compatibility)
                this.broadcastOptimisticUpload(
                    mediaId,
                    file.originalname,
                    previewResult.url,
                    context
                );

                // STEP 6: Queue background processing
                setImmediate(() => {
                    this.processInBackground({
                        mediaId,
                        eventId: context.eventId,
                        albumId: context.albumId || new mongoose.Types.ObjectId().toString(),
                        filePath: file.path,
                        originalFilename: file.originalname,
                        fileSize: file.size,
                        mimeType: file.mimetype,
                        userId: context.userId,
                        userName: context.userName,
                        isGuestUpload: context.isGuestUpload || false,
                        optimisticFileId: previewResult.fileId,
                        guestSessionId: context.guestSessionId,
                        guestInfo: context.guestInfo
                    }).catch(error => {
                        logger.error(`Background processing failed for ${file.originalname}:`, error);
                        // Mark as failed in progress service
                        unifiedProgressService.markFailed(mediaId, error.message || 'Processing failed');
                    });
                });

                results.push({
                    mediaId,
                    filename: file.originalname,
                    tempUrl: previewResult.url,
                    status: 'optimistic',
                    size: file.size,
                    format: this.getFileFormat(file)
                });

            } catch (error: any) {
                logger.error(`Failed to process ${file.originalname}:`, error);
                await this.cleanupFile(file.path);
            }
        }

        return results;
    }

    /**
     * Process background job from queue
     */
    async processBackgroundJob(jobData: any): Promise<void> {
        return this.processInBackground(jobData);
    }

    /**
     * Create and upload optimistic preview
     */
    private async createAndUploadOptimisticPreview(
        file: Express.Multer.File,
        mediaId: string,
        eventId: string
    ): Promise<{ url: string; fileId: string }> {
        // Create low-quality preview
        const previewBuffer = await sharp(file.path)
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 60, progressive: true })
            .toBuffer();

        // Upload to ImageKit
        return await ImageKitUploadService.uploadOptimisticPreview(
            previewBuffer,
            mediaId,
            eventId,
            file.originalname
        );
    }

    /**
     * Process image in background with all variants
     */
    private async processInBackground(jobData: any): Promise<void> {
        const startTime = Date.now();

        try {
            logger.info(`🔄 Background processing: ${jobData.originalFilename}`);

            // Stage 1: Processing (30-60%)
            this.broadcastProgress(jobData, ProcessingStage.PROCESSING, 30);

            // Read file and extract metadata
            const fileBuffer = await fs.readFile(jobData.filePath);
            const metadata = await imageOptimizerService.getImageMetadata(fileBuffer);

            this.broadcastProgress(jobData, ProcessingStage.PROCESSING, 45);

            // Process and upload original
            const originalResult = await ImageKitUploadService.uploadOriginal(fileBuffer, {
                ...jobData,
                format: metadata.format
            });

            // Stage 2: Optimizing (60-80%)
            this.broadcastProgress(jobData, ProcessingStage.OPTIMIZING, 60);

            // Process all variants in parallel (no individual tracking)
            const variants = variantConfigService.variants;
            const processedVariants = await imageOptimizerService.processAllVariants(
                fileBuffer,
                variants,
                metadata
            );

            this.broadcastProgress(jobData, ProcessingStage.OPTIMIZING, 70);

            // Upload all variants
            const uploadedVariants = await ImageKitUploadService.uploadAllVariants(
                processedVariants,
                jobData.eventId,
                jobData.mediaId,
                jobData.isGuestUpload
            );

            // Stage 3: Finalizing (80-95%)
            this.broadcastProgress(jobData, ProcessingStage.FINALIZING, 80);

            // Organize variants for schema
            const organizedVariants = variantOrganizerService.organizeVariantsForSchema(
                uploadedVariants || []
            );

            const completeVariants = {
                small: organizedVariants.small || { webp: null, jpeg: null },
                medium: organizedVariants.medium || { webp: null, jpeg: null },
                large: organizedVariants.large || { webp: null, jpeg: null },
                original: {
                    url: originalResult.url,
                    width: metadata.width || 1920,
                    height: metadata.height || 1080,
                    size_mb: (originalResult.size || jobData.fileSize) / (1024 * 1024),
                    format: metadata.format || 'jpeg'
                }
            };

            // Save to database
            await this.saveToDatabase(
                jobData,
                originalResult,
                completeVariants,
                metadata
            );

            this.broadcastProgress(jobData, ProcessingStage.FINALIZING, 95);

            // Cleanup
            if (jobData.optimisticFileId) {
                await ImageKitUploadService.deleteFile(jobData.optimisticFileId);
            }
            await this.cleanupFile(jobData.filePath);

            // Stage 4: Complete (100%)
            const processingTime = Date.now() - startTime;
            this.broadcastComplete(jobData, originalResult.url, completeVariants, processingTime);

            logger.info(`✅ Processing completed: ${jobData.originalFilename} in ${processingTime}ms`);

        } catch (error) {
            logger.error(`❌ Processing failed: ${jobData.originalFilename}`, error);
            this.broadcastError(jobData, error);
            await this.cleanupFile(jobData.filePath);
            throw error;
        }
    }

    /**
     * Save media to database with transaction
     */
    private async saveToDatabase(
        jobData: any,
        originalResult: any,
        completeVariants: any,
        metadata: any
    ): Promise<void> {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const safeMetadata = {
                    width: metadata?.width || 1920,
                    height: metadata?.height || 1080,
                    format: metadata?.format || 'jpeg',
                    size: metadata?.size || jobData.fileSize || 0
                };

                // Fetch event permissions for approval logic (cached in transaction)
                const event = await Event.findById(jobData.eventId)
                    .select('permissions')
                    .session(session)
                    .lean();

                if (!event) {
                    throw new Error('Event not found');
                }

                // Determine approval status based on uploader type and event settings
                let approvalStatus: 'pending' | 'approved' | 'auto_approved' = 'approved';
                let autoApprovalReason: string | null = null;

                if (jobData.isGuestUpload) {
                    // Guest upload logic
                    if (event.permissions?.can_upload === false) {
                        throw new Error('Guest uploads not allowed for this event');
                    }

                    if (event.permissions?.require_approval === true) {
                        approvalStatus = 'pending';
                        autoApprovalReason = null;
                    } else {
                        approvalStatus = 'auto_approved';
                        autoApprovalReason = 'guest_auto_approve';
                    }
                } else {
                    // Authenticated user - auto approve
                    approvalStatus = 'auto_approved';
                    autoApprovalReason = 'authenticated_user';
                }

                // Build media document
                const mediaDoc: any = {
                    _id: new mongoose.Types.ObjectId(jobData.mediaId),
                    url: originalResult.url,
                    type: 'image',
                    album_id: new mongoose.Types.ObjectId(jobData.albumId),
                    event_id: new mongoose.Types.ObjectId(jobData.eventId),
                    original_filename: jobData.originalFilename,
                    size_mb: jobData.fileSize / (1024 * 1024),
                    format: safeMetadata.format,
                    image_variants: {
                        small: completeVariants.small || { webp: null, jpeg: null },
                        medium: completeVariants.medium || { webp: null, jpeg: null },
                        large: completeVariants.large || { webp: null, jpeg: null },
                        original: {
                            url: originalResult.url,
                            width: safeMetadata.width,
                            height: safeMetadata.height,
                            size_mb: (originalResult.size || jobData.fileSize) / (1024 * 1024),
                            format: safeMetadata.format
                        }
                    },
                    metadata: {
                        width: safeMetadata.width,
                        height: safeMetadata.height,
                        aspect_ratio: safeMetadata.height / safeMetadata.width,
                        format: safeMetadata.format,
                        size: safeMetadata.size
                    },
                    processing: {
                        status: 'completed',
                        current_stage: 'completed',
                        progress_percentage: 100,
                        started_at: new Date(),
                        completed_at: new Date(),
                        variants_generated: true,
                        variants_count: this.calculateAllVariantsCount(completeVariants)
                    },
                    approval: {
                        status: approvalStatus,
                        auto_approval_reason: autoApprovalReason,
                        approved_at: approvalStatus !== 'pending' ? new Date() : null,
                        approved_by: null,
                        rejection_reason: ''
                    }
                };

                // Handle guest vs authenticated user
                if (jobData.isGuestUpload && jobData.guestSessionId) {
                    mediaDoc.uploader_type = 'guest';
                    mediaDoc.guest_session_id = jobData.guestSessionId;
                    mediaDoc.uploaded_by = null;

                    if (jobData.guestInfo) {
                        // Include sessionId in guestData for createGuestUploaderInfo
                        const guestDataWithSession = {
                            ...jobData.guestInfo,
                            sessionId: jobData.guestSessionId
                        };
                        mediaDoc.guest_uploader = createGuestUploaderInfo(guestDataWithSession, true);
                    }
                } else if (jobData.userId && mongoose.Types.ObjectId.isValid(jobData.userId)) {
                    mediaDoc.uploader_type = 'registered_user';
                    mediaDoc.uploaded_by = new mongoose.Types.ObjectId(jobData.userId);
                } else {
                    logger.warn(`Invalid userId: ${jobData.userId}, treating as guest`);
                    mediaDoc.uploader_type = 'guest';
                    mediaDoc.uploaded_by = null;
                }

                const media = new Media(mediaDoc);
                await media.save({ session });

                // Update event stats based on approval status
                const statsUpdate: any = {
                    $inc: {
                        'stats.total_size_mb': jobData.fileSize / (1024 * 1024)
                    },
                    $set: { 'updated_at': new Date() }
                };

                if (approvalStatus === 'pending') {
                    // Pending approval - increment pending count
                    statsUpdate.$inc['stats.pending_approval'] = 1;
                } else {
                    // Auto-approved - increment photo count
                    statsUpdate.$inc['stats.photos'] = 1;
                }

                await Event.updateOne(
                    { _id: new mongoose.Types.ObjectId(jobData.eventId) },
                    statsUpdate,
                    { session }
                );

                // Only update participant for valid authenticated users
                if (!jobData.isGuestUpload &&
                    jobData.userId &&
                    mongoose.Types.ObjectId.isValid(jobData.userId)) {

                    const participant = await EventParticipant.findOne({
                        user_id: new mongoose.Types.ObjectId(jobData.userId),
                        event_id: new mongoose.Types.ObjectId(jobData.eventId)
                    }).session(session);

                    if (participant) {
                        await EventParticipant.updateOne(
                            { _id: participant._id },
                            {
                                $inc: {
                                    'stats.uploads_count': 1,
                                    'stats.total_file_size_mb': jobData.fileSize / (1024 * 1024)
                                },
                                $set: {
                                    'stats.last_upload_at': new Date(),
                                    'last_activity_at': new Date()
                                }
                            },
                            { session }
                        );
                    } else {
                        await EventParticipant.create([{
                            user_id: new mongoose.Types.ObjectId(jobData.userId),
                            event_id: new mongoose.Types.ObjectId(jobData.eventId),
                            join_method: 'admin_upload',
                            status: 'active',
                            joined_at: new Date(),
                            stats: {
                                uploads_count: 1,
                                total_file_size_mb: jobData.fileSize / (1024 * 1024),
                                last_upload_at: new Date()
                            },
                            last_activity_at: new Date()
                        }], { session });
                    }
                }

                // Update guest session stats if applicable
                if (jobData.isGuestUpload && jobData.guestSessionId) {
                    await GuestSession.updateOne(
                        { _id: jobData.guestSessionId },
                        {
                            $inc: {
                                'upload_stats.successful_uploads': 1,
                                'upload_stats.total_uploads': 1,
                                'upload_stats.total_size_mb': jobData.fileSize / (1024 * 1024)
                            },
                            $set: {
                                'upload_stats.last_upload_at': new Date(),
                                'last_activity_at': new Date()
                            },
                            $setOnInsert: {
                                'upload_stats.first_upload_at': new Date()
                            }
                        },
                        { session }
                    );
                }
            });

            logger.info(`Successfully saved media ${jobData.mediaId} with approval status`);

        } catch (dbError) {
            logger.error(`Database save failed for ${jobData.mediaId}:`, dbError);
            throw dbError;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Calculate total variants count including original
     */
    private calculateAllVariantsCount(variants: any): number {
        let count = 0;

        // Count size variants
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

        // Count original
        if (variants.original) count++;

        return count;
    }

    /**
     * Broadcast notifications
     */
    private broadcastOptimisticUpload(
        mediaId: string,
        filename: string,
        tempUrl: string,
        context: any
    ): void {
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'optimistic_upload',
            eventId: context.eventId,
            mediaData: {
                id: mediaId,
                filename,
                tempUrl,
                status: 'optimistic',
                uploadedBy: {
                    id: context.userId,
                    name: context.userName,
                    type: context.isGuestUpload ? 'guest' : 'admin'
                },
                processingStage: 'optimistic',
                progressPercentage: 10
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });
    }

    private broadcastProgress(jobData: any, stage: ProcessingStage, percentage: number): void {
        const stageMessages = {
            [ProcessingStage.UPLOADING]: 'Uploading image...',
            [ProcessingStage.CREATING_PREVIEW]: 'Creating preview...',
            [ProcessingStage.PROCESSING]: 'Processing image...',
            [ProcessingStage.OPTIMIZING]: 'Creating optimized versions...',
            [ProcessingStage.FINALIZING]: 'Finalizing...',
            [ProcessingStage.COMPLETED]: 'Complete!'
        };

        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId: jobData.eventId,
            mediaData: {
                id: jobData.mediaId,
                filename: jobData.originalFilename,
                status: 'processing',
                processingStage: stage,
                progressPercentage: percentage,
                message: stageMessages[stage],
                uploadedBy: {
                    id: jobData.userId,
                    name: jobData.userName,
                    type: jobData.isGuestUpload ? 'guest' : 'admin'
                }
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });
    }

    private broadcastComplete(jobData: any, finalUrl: string, variants: any, processingTime: number): void {
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_complete',
            eventId: jobData.eventId,
            mediaData: {
                id: jobData.mediaId,
                filename: jobData.originalFilename,
                finalUrl,
                status: 'completed',
                image_variants: variants,
                processingStage: 'completed',
                progressPercentage: 100,
                uploadedBy: {
                    id: jobData.userId,
                    name: jobData.userName,
                    type: jobData.isGuestUpload ? 'guest' : 'admin'
                }
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // Also use existing method for backward compatibility
        if (mediaNotificationService.broadcastProcessingComplete) {
            mediaNotificationService.broadcastProcessingComplete({
                mediaId: jobData.mediaId,
                eventId: jobData.eventId,
                newUrl: finalUrl,
                variants,
                processingTimeMs: processingTime
            });
        }
    }

    private broadcastError(jobData: any, error: any): void {
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_failed',
            eventId: jobData.eventId,
            mediaData: {
                id: jobData.mediaId,
                filename: jobData.originalFilename,
                status: 'failed',
                error: error.message || 'Processing failed',
                processingStage: 'failed',
                progressPercentage: 0,
                uploadedBy: {
                    id: jobData.userId,
                    name: jobData.userName,
                    type: jobData.isGuestUpload ? 'guest' : 'admin'
                }
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });
    }

    /**
     * Utility functions
     */
    private isValidImageFile(file: Express.Multer.File): boolean {
        return variantConfigService.isValidImageFormat(file);
    }

    private getFileFormat(file: Express.Multer.File): string {
        return file.mimetype.split('/')[1] || 'jpeg';
    }

    private async cleanupFile(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
            logger.debug(`🗑️ Cleaned up temp file: ${filePath}`);
        } catch (error) {
            logger.warn(`Failed to cleanup file ${filePath}:`, error);
        }
    }
}

// Export singleton instance
export const mediaProcessingService = new MediaProcessingServiceClass();
// 5. services/guest/guest-upload.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media, createGuestUploaderInfo } from '@models/media.model';
import { determineApprovalStatus } from '@utils/user.utils';
import { bytesToMB } from '@utils/file.util';

// Import shared services
import { queueImageProcessing } from '../upload/shared/queue-processing.service';
import { validateGuestFile, validateShareToken } from './guest-validation.service';
import { GuestSessionService } from './guest-session.service';

import type { GuestUploadResult, GuestUploadInfo } from './guest.types';
import { getOrCreateDefaultAlbum } from '@services/album';
import { EventParticipant } from '@models/event-participants.model';

export const uploadGuestMedia = async (
    shareToken: string,
    file: Express.Multer.File,
    guestInfo: GuestUploadInfo,
    authenticatedUserId?: string
): Promise<GuestUploadResult> => {
    try {
        logger.info(`🔗 Guest upload started`, {
            shareToken: shareToken.substring(0, 8) + '...',
            fileName: file.originalname,
            fileSize: bytesToMB(file.size) + 'MB',
            guestInfo: {
                name: guestInfo.name || 'Anonymous',
                email: guestInfo.email ? 'provided' : 'not provided',
                authenticated: !!authenticatedUserId
            }
        });

        // 1. Validate share token and permissions
        const event = await validateShareToken(shareToken);

        // 2. Check upload rate limits for guest sessions
        if (guestInfo.sessionId && !authenticatedUserId) {
            const fileSizeMB = bytesToMB(file.size);
            const rateLimitCheck = await GuestSessionService.checkUploadRateLimit(
                guestInfo.sessionId,
                fileSizeMB
            );

            if (!rateLimitCheck.allowed) {
                logger.warn('Guest upload rate limit exceeded', {
                    sessionId: guestInfo.sessionId.substring(0, 8) + '...',
                    reason: rateLimitCheck.reason,
                    currentStats: rateLimitCheck.currentStats
                });

                return {
                    success: false,
                    error: rateLimitCheck.reason || 'Upload limit exceeded'
                };
            }
        }

        // 3. Validate file
        const fileValidation = await validateGuestFile(file);
        if (!fileValidation.valid) {
            return {
                success: false,
                error: fileValidation.error!
            };
        }

        // 3. Get or create default album
        const defaultAlbumResponse = await getOrCreateDefaultAlbum(
            event._id.toString(),
            authenticatedUserId || 'guest'
        );

        if (!defaultAlbumResponse.status) {
            return {
                success: false,
                error: 'Failed to get or create album for upload'
            };
        }

        // 4. Determine approval status
        const approvalConfig = await determineApprovalStatus(
            event._id.toString(),
            authenticatedUserId || null
        );

        // 5. Create guest uploader info
        const guestUploaderInfo = createGuestUploaderInfo(guestInfo, true);

        // 6. Process upload based on file type
        if (fileValidation.fileType === 'image') {
            return await processGuestImageUpload(
                file,
                event._id.toString(),
                defaultAlbumResponse.data._id.toString(),
                guestUploaderInfo,
                approvalConfig,
                authenticatedUserId
            );
        } else {
            return await processGuestVideoUpload(
                file,
                event._id.toString(),
                defaultAlbumResponse.data._id.toString(),
                guestUploaderInfo,
                approvalConfig,
                authenticatedUserId
            );
        }

    } catch (error: any) {
        logger.error('Guest upload error:', {
            error: error.message,
            shareToken: shareToken.substring(0, 8) + '...',
            fileName: file.originalname
        });

        return {
            success: false,
            error: 'Upload failed due to server error'
        };
    }
};

const processGuestImageUpload = async (
    file: Express.Multer.File,
    eventId: string,
    albumId: string,
    guestUploaderInfo: any,
    approvalConfig: any,
    authenticatedUserId?: string
): Promise<GuestUploadResult> => {
    try {
        const fileSizeMB = bytesToMB(file.size);

        // Generate IDs
        const mediaId = new mongoose.Types.ObjectId();
        const albumObjectId = new mongoose.Types.ObjectId(albumId);
        const eventObjectId = new mongoose.Types.ObjectId(eventId);
        const userObjectId = authenticatedUserId ? new mongoose.Types.ObjectId(authenticatedUserId) : null;

        // Create preview image immediately
        // const previewUrl = await createInstantPreview(file, mediaId.toString(), eventId);

        // Get basic metadata
        // const metadata = await getBasicImageMetadata(file.path);

        // Create database record
        // Create database record
        const uploadId = mediaId.toString(); // Use _id as upload_id
        const media = new Media({
            _id: mediaId,
            upload_id: uploadId,
            type: 'image',
            album_id: albumObjectId,
            event_id: eventObjectId,

            owner: {
                type: authenticatedUserId ? 'registered_user' : 'guest',
                user_id: userObjectId || undefined,
                guest_id: !authenticatedUserId ? guestUploaderInfo.session_id : undefined
            },

            original: {
                public_id: `guest_upload_${uploadId}`, // Placeholder until processed
                filename: file.originalname,
                format: file.mimetype.split('/')[1] || '',
                size_mb: fileSizeMB,
                width: 0,
                height: 0
            },

            processing: {
                status: 'processing',
                stage: 'uploading',
                progress: 0,
                started_at: new Date(),
                variants_generated: false,
            },

            approval: {
                status: approvalConfig.status,
                auto_approval_reason: approvalConfig.autoApprovalReason,
                approved_at: approvalConfig.approvedAt,
                approved_by: approvalConfig.approvedBy,
                rejection_reason: ''
            },

            deleteGroup: `guest-upload-${guestUploaderInfo.session_id || 'anon'}`
        });

        await media.save();
        logger.info(`✅ Guest media record created: ${mediaId}`);

        // Update participant stats for authenticated users
        if (authenticatedUserId) {
            try {
                await EventParticipant.updateOne(
                    {
                        user_id: new mongoose.Types.ObjectId(authenticatedUserId),
                        event_id: new mongoose.Types.ObjectId(eventId)
                    },
                    {
                        $inc: {
                            'stats.uploads_count': 1,
                            'stats.total_file_size_mb': fileSizeMB
                        },
                        $set: {
                            'stats.last_upload_at': new Date(),
                            'last_activity_at': new Date()
                        }
                    }
                );
            } catch (statsError) {
                logger.warn('Failed to update guest participant stats:', statsError);
                // Don't fail the upload if stats update fails
            }
        }

        // Queue for background processing
        let jobId: string | null = null;
        try {
            jobId = await queueImageProcessing(
                file,
                media._id.toString(),
                eventId,
                albumId,
                {
                    userId: authenticatedUserId || 'guest',
                    userName: guestUploaderInfo.name || 'Guest User',
                    isGuest: !authenticatedUserId
                }
            );
        } catch (queueError) {
            logger.error('Queue processing failed, but upload succeeded:', queueError);
        }

        return {
            success: true,
            media_id: mediaId.toString(),
            url: 'previewUrl',
            approval_status: media.approval.status,
            processing_status: jobId ? 'processing' : 'pending',
            message: `${authenticatedUserId ? 'Image' : 'Guest image'} uploaded successfully! High-quality versions processing...`
        };

    } catch (error: any) {
        logger.error('❌ Guest image upload error:', error);
        return {
            success: false,
            error: 'Failed to upload image'
        };
    }
};

const processGuestVideoUpload = async (
    file: Express.Multer.File,
    eventId: string,
    albumId: string,
    guestUploaderInfo: any,
    approvalConfig: any,
    authenticatedUserId?: string
): Promise<GuestUploadResult> => {
    try {
        const fileSizeMB = bytesToMB(file.size);

        // Create media record directly for videos
        // Create media record directly for videos
        const mediaId = new mongoose.Types.ObjectId();
        const uploadId = mediaId.toString();

        const media = new Media({
            _id: mediaId,
            upload_id: uploadId,
            type: 'video',
            album_id: new mongoose.Types.ObjectId(albumId),
            event_id: new mongoose.Types.ObjectId(eventId),

            owner: {
                type: authenticatedUserId ? 'registered_user' : 'guest',
                user_id: authenticatedUserId ? new mongoose.Types.ObjectId(authenticatedUserId) : undefined,
                guest_id: !authenticatedUserId ? guestUploaderInfo.session_id : undefined
            },

            original: {
                public_id: `guest_video_${uploadId}`, // Placeholder
                filename: file.originalname,
                format: file.mimetype.split('/')[1] || 'mp4',
                size_mb: fileSizeMB,
                width: 0,
                height: 0,
                duration: 0
            },

            processing: {
                status: 'pending',
                stage: 'uploading',
                progress: 0,
                started_at: new Date(),
                variants_generated: false,
            },

            approval: {
                status: approvalConfig.status,
                auto_approval_reason: approvalConfig.autoApprovalReason,
                approved_at: approvalConfig.approvedAt,
                approved_by: approvalConfig.approvedBy,
                rejection_reason: ''
            },

            deleteGroup: `guest-upload-${guestUploaderInfo.session_id || 'anon'}`
        });

        await media.save();

        // Update participant stats for authenticated users
        if (authenticatedUserId) {
            try {
                await EventParticipant.updateOne(
                    {
                        user_id: new mongoose.Types.ObjectId(authenticatedUserId),
                        event_id: new mongoose.Types.ObjectId(eventId)
                    },
                    {
                        $inc: {
                            'stats.uploads_count': 1,
                            'stats.total_file_size_mb': fileSizeMB
                        },
                        $set: {
                            'stats.last_upload_at': new Date(),
                            'last_activity_at': new Date()
                        }
                    }
                );
            } catch (statsError) {
                logger.warn('Failed to update guest video participant stats:', statsError);
                // Don't fail the upload if stats update fails
            }
        }

        logger.info(`✅ Guest video upload completed`, {
            mediaId: media._id.toString(),
            fileName: file.originalname,
            approvalStatus: media.approval.status
        });

        return {
            success: true,
            media_id: media._id.toString(),
            url: media.getOptimizedUrl(),
            approval_status: media.approval.status,
            processing_status: 'pending',
            message: 'Video uploaded successfully'
        };

    } catch (error: any) {
        logger.error('Guest video upload error:', error);
        return {
            success: false,
            error: 'Failed to upload video'
        };
    } finally {
    }
};
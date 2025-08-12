// 5. services/guest/guest-upload.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media, createGuestUploaderInfo } from '@models/media.model';
import { determineApprovalStatus } from '@utils/user.utils';
import { bytesToMB, cleanupFile } from '@utils/file.util';

// Import shared services
import { createInstantPreview, getBasicImageMetadata, getFileExtension } from '@services/upload/shared/image-processing.service';
import { queueImageProcessing } from '../upload/shared/queue-processing.service';
import { validateGuestFile, validateShareToken } from './guest-validation.service';

import type { GuestUploadResult, GuestUploadInfo } from './guest.types';
import { getEstimatedProcessingTime } from '@services/upload/shared/image-processing.service';
import { getOrCreateDefaultAlbum } from '@services/album';

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

        // 2. Validate file
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
            await cleanupFile(file);
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

        await cleanupFile(file);
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
        const previewUrl = await createInstantPreview(file, mediaId.toString(), eventId);

        // Get basic metadata
        const metadata = await getBasicImageMetadata(file.path);

        // Create database record
        const media = new Media({
            _id: mediaId,
            url: previewUrl,
            type: 'image',
            album_id: albumObjectId,
            event_id: eventObjectId,
            uploaded_by: userObjectId,
            guest_uploader: !authenticatedUserId ? guestUploaderInfo : null,
            uploader_type: authenticatedUserId ? 'registered_user' : 'guest',
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
                status: approvalConfig.status,
                auto_approval_reason: approvalConfig.autoApprovalReason,
                approved_at: approvalConfig.approvedAt,
                approved_by: approvalConfig.approvedBy,
                rejection_reason: ''
            },
            upload_context: {
                method: 'guest_upload',
                ip_address: guestUploaderInfo.session_id?.split('_')[0] || '',
                user_agent: guestUploaderInfo.device_fingerprint || '',
                upload_session_id: guestUploaderInfo.session_id || '',
                referrer_url: guestUploaderInfo.platform_info?.referrer || '',
                platform: 'web'
            }
        });

        await media.save();
        logger.info(`✅ Guest media record created: ${mediaId}`);

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
            url: previewUrl,
            approval_status: media.approval.status,
            processing_status: jobId ? 'processing' : 'pending',
            estimated_processing_time: getEstimatedProcessingTime(file.size),
            message: `${authenticatedUserId ? 'Image' : 'Guest image'} uploaded successfully! High-quality versions processing...`
        };

    } catch (error: any) {
        logger.error('❌ Guest image upload error:', error);
        await cleanupFile(file);
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
        const media = new Media({
            url: '/placeholder-video.mp4',
            type: 'video',
            album_id: new mongoose.Types.ObjectId(albumId),
            event_id: new mongoose.Types.ObjectId(eventId),
            uploaded_by: authenticatedUserId ? new mongoose.Types.ObjectId(authenticatedUserId) : null,
            guest_uploader: !authenticatedUserId ? guestUploaderInfo : null,
            uploader_type: authenticatedUserId ? 'registered_user' : 'guest',
            original_filename: file.originalname,
            size_mb: fileSizeMB,
            format: file.mimetype.split('/')[1],
            processing: {
                status: 'pending',
                started_at: new Date(),
                variants_generated: false,
            },
            approval: {
                status: approvalConfig.status,
                auto_approval_reason: approvalConfig.autoApprovalReason,
                approved_at: approvalConfig.approvedAt,
                approved_by: approvalConfig.approvedBy,
                rejection_reason: ''
            }
        });

        await media.save();

        logger.info(`✅ Guest video upload completed`, {
            mediaId: media._id.toString(),
            fileName: file.originalname,
            approvalStatus: media.approval.status
        });

        return {
            success: true,
            media_id: media._id.toString(),
            url: media.url,
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
        await cleanupFile(file);
    }
};
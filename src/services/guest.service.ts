// services/guest.service.ts - Guest media upload service matching your model

import fs from 'fs/promises';
import mongoose from 'mongoose';
import ImageKit from 'imagekit';
import { logger } from '@utils/logger';
import { Media, createGuestUploaderInfo, generateGuestId } from '@models/media.model';
import { Event } from '@models/event.model';
import { getOrCreateDefaultAlbum } from '@services/album.service';
import { imageProcessingService } from '@services/imageProcessing.service';
import { determineApprovalStatus } from '@utils/user.utils';
import { getFileType, isValidImageFormat, cleanupFile, bytesToMB } from '@utils/file.util';

// ImageKit configuration
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});
interface GuestUploadResult {
    success: boolean;
    media_id?: string;
    url?: string;
    approval_status?: string;
    message?: string;
    error?: string;
}

interface GuestUploadInfo {
    name?: string;
    email?: string;
    phone?: string;
    sessionId?: string;
    deviceFingerprint?: string;
    uploadMethod?: string;
    platformInfo?: any;
}

class GuestMediaUploadService {
    /**
     * Upload media as a guest user
     */
    async uploadGuestMedia(
        shareToken: string,
        file: Express.Multer.File,
        guestInfo: GuestUploadInfo,
        authenticatedUserId?: string
    ): Promise<GuestUploadResult> {
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

            // Find event by share token
            const event = await Event.findOne({ share_token: shareToken });
            if (!event) {
                await cleanupFile(file);
                return {
                    success: false,
                    error: 'Invalid share token or event not found'
                };
            }

            // Check if uploads are allowed
            if (!event.permissions?.can_upload) {
                await cleanupFile(file);
                return {
                    success: false,
                    error: 'Uploads are not allowed for this event'
                };
            }

            // Validate file type
            const fileType = getFileType(file);
            if (!fileType) {
                await cleanupFile(file);
                return {
                    success: false,
                    error: 'Unsupported file type. Only images and videos are allowed.'
                };
            }

            // For images, validate format
            if (fileType === 'image' && !isValidImageFormat(file)) {
                await cleanupFile(file);
                return {
                    success: false,
                    error: 'Unsupported image format. Supported formats: JPEG, PNG, WebP, HEIC'
                };
            }

            // Check file size limits (you can adjust these based on your event settings)
            const maxSizeMB = 10;
            const fileSizeMB = bytesToMB(file.size);
            if (fileSizeMB > maxSizeMB) {
                await cleanupFile(file);
                return {
                    success: false,
                    error: `File size exceeds limit of ${maxSizeMB}MB`
                };
            }

            // Get or create default album
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

            // Determine approval status
            const approvalConfig = await determineApprovalStatus(
                event._id.toString(),
                authenticatedUserId || null
            );

            // Create guest uploader info matching your model structure
            const guestUploaderInfo = createGuestUploaderInfo(guestInfo, true);

            // Process upload based on file type
            if (fileType === 'image') {
                return await this.processGuestImageUpload(
                    file,
                    event._id.toString(),
                    defaultAlbumResponse.data._id.toString(),
                    guestUploaderInfo,
                    approvalConfig,
                    authenticatedUserId
                );
            } else {
                return await this.processGuestVideoUpload(
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
    }

    /**
     * Process guest image upload with variants
     */
    private async processGuestImageUpload(
        file: Express.Multer.File,
        eventId: string,
        albumId: string,
        guestUploaderInfo: any,
        approvalConfig: any,
        authenticatedUserId?: string
    ): Promise<GuestUploadResult> {
        try {
            const fileSizeMB = bytesToMB(file.size);

            // Create media record first (with processing status)
            const media = new Media({
                url: '', // Will be updated after processing
                type: 'image',
                album_id: new mongoose.Types.ObjectId(albumId),
                event_id: new mongoose.Types.ObjectId(eventId),
                uploaded_by: authenticatedUserId ? new mongoose.Types.ObjectId(authenticatedUserId) : null,
                guest_uploader: !authenticatedUserId ? guestUploaderInfo : null,
                uploader_type: authenticatedUserId ? 'registered_user' : 'guest',
                original_filename: file.originalname,
                size_mb: fileSizeMB,
                format: file.mimetype.split('/')[1],
                processing: {
                    status: 'processing',
                    started_at: new Date(),
                    completed_at: null,
                    processing_time_ms: 0,
                    variants_generated: false,
                    variants_count: 0,
                    total_variants_size_mb: 0,
                    error_message: '',
                    retry_count: 0
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
                    ip_address: guestUploaderInfo.session_id.split('_')[0] || '',
                    user_agent: guestUploaderInfo.device_fingerprint || '',
                    upload_session_id: guestUploaderInfo.session_id || '',
                    referrer_url: guestUploaderInfo.platform_info?.referrer || '',
                    platform: 'web'
                }
            });

            await media.save();
            const mediaId = media._id.toString();

            try {
                // Process image and generate variants
                const processingResult = await imageProcessingService.processImage(file, eventId, mediaId);

                // Update media with processing results matching your model structure
                media.url = processingResult.original.url;
                media.image_variants = {
                    original: processingResult.original,
                    small: processingResult.variants.small,
                    medium: processingResult.variants.medium,
                    large: processingResult.variants.large
                };

                // Update metadata
                media.metadata = {
                    width: processingResult.original.width || 0,
                    height: processingResult.original.height || 0,
                    duration: 0,
                    aspect_ratio: processingResult.original.height && processingResult.original.width ?
                        processingResult.original.height / processingResult.original.width : 1,
                    color_profile: '',
                    has_transparency: false,
                    timestamp: new Date(),
                    device_info: {
                        brand: '',
                        model: '',
                        os: ''
                    },
                    location: {
                        latitude: null,
                        longitude: null,
                        address: ''
                    },
                    camera_settings: {
                        iso: null,
                        aperture: '',
                        shutter_speed: '',
                        focal_length: ''
                    }
                };

                // Update processing status
                const processingStartTime = media.processing.started_at?.getTime() || Date.now();
                media.processing = {
                    status: 'completed',
                    started_at: media.processing.started_at,
                    completed_at: new Date(),
                    processing_time_ms: Date.now() - processingStartTime,
                    variants_generated: true,
                    variants_count: 6, // 3 sizes × 2 formats
                    total_variants_size_mb: this.calculateTotalVariantsSize(processingResult.variants),
                    error_message: '',
                    retry_count: 0
                };

                await media.save();

                logger.info(`✅ Guest image upload completed`, {
                    mediaId,
                    fileName: file.originalname,
                    processingTime: media.processing.processing_time_ms + 'ms',
                    approvalStatus: media.approval.status
                });

                return {
                    success: true,
                    media_id: mediaId,
                    url: media.url,
                    approval_status: media.approval.status,
                    message: 'Image uploaded and processed successfully'
                };

            } catch (processingError: any) {
                logger.error(`❌ Guest image processing failed:`, processingError);

                // Update processing status with error
                const processingStartTime = media.processing.started_at?.getTime() || Date.now();
                media.processing = {
                    status: 'failed',
                    started_at: media.processing.started_at,
                    completed_at: new Date(),
                    processing_time_ms: Date.now() - processingStartTime,
                    variants_generated: false,
                    variants_count: 0,
                    total_variants_size_mb: 0,
                    error_message: processingError.message,
                    retry_count: 0
                };

                // Try to upload original to ImageKit as fallback
                try {
                    const fileBuffer = await fs.readFile(file.path);
                    const uploadResult = await imagekit.upload({
                        file: fileBuffer,
                        fileName: `${mediaId}_original_${file.originalname}`,
                        folder: `/events/${eventId}/images`,
                    });
                    media.url = uploadResult.url;
                    await media.save();

                    return {
                        success: true,
                        media_id: mediaId,
                        url: media.url,
                        approval_status: media.approval.status,
                        message: 'Image uploaded but processing failed - original image saved'
                    };
                } catch (uploadError) {
                    logger.error('Failed to upload original image after processing failure:', uploadError);
                    return {
                        success: false,
                        error: 'Image processing and upload failed'
                    };
                }
            }

        } catch (error: any) {
            logger.error('Guest image upload error:', error);
            return {
                success: false,
                error: 'Failed to upload image'
            };
        } finally {
            await cleanupFile(file);
        }
    }

    /**
     * Process guest video upload (simplified)
     */
    private async processGuestVideoUpload(
        file: Express.Multer.File,
        eventId: string,
        albumId: string,
        guestUploaderInfo: any,
        approvalConfig: any,
        authenticatedUserId?: string
    ): Promise<GuestUploadResult> {
        try {
            const fileSizeMB = bytesToMB(file.size);

            // Upload video to ImageKit
            const fileBuffer = await fs.readFile(file.path);
            const uploadResult = await imagekit.upload({
                file: fileBuffer,
                fileName: `${Date.now()}_guest_${file.originalname}`,
                folder: `/events/${eventId}/videos`,
                transformation: {
                    pre: 'q_auto,f_auto' // Auto quality and format optimization
                }
            });

            // Create media record
            const media = new Media({
                url: uploadResult.url,
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
                    status: 'completed',
                    started_at: new Date(),
                    completed_at: new Date(),
                    processing_time_ms: 0,
                    variants_generated: false,
                    variants_count: 0,
                    total_variants_size_mb: 0,
                    error_message: '',
                    retry_count: 0
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
                    ip_address: guestUploaderInfo.session_id.split('_')[0] || '',
                    user_agent: guestUploaderInfo.device_fingerprint || '',
                    upload_session_id: guestUploaderInfo.session_id || '',
                    referrer_url: guestUploaderInfo.platform_info?.referrer || '',
                    platform: 'web'
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
    }

    /**
     * Calculate total size of variants
     */
    private calculateTotalVariantsSize(variants: any): number {
        let total = 0;
        try {
            Object.values(variants).forEach((sizeVariants: any) => {
                if (sizeVariants && typeof sizeVariants === 'object') {
                    Object.values(sizeVariants).forEach((formatVariant: any) => {
                        if (formatVariant && formatVariant.size_mb) {
                            total += formatVariant.size_mb;
                        }
                    });
                }
            });
        } catch (error) {
            logger.warn('Error calculating variants size:', error);
        }
        return Math.round(total * 100) / 100;
    }

    /**
     * Check if guest has permission to upload
     */
    async checkGuestUploadPermission(shareToken: string): Promise<{
        allowed: boolean;
        event?: any;
        reason?: string;
    }> {
        try {
            const event = await Event.findOne({ share_token: shareToken });

            if (!event) {
                return {
                    allowed: false,
                    reason: 'Event not found'
                };
            }

            if (!event.permissions?.can_upload) {
                return {
                    allowed: false,
                    event,
                    reason: 'Uploads not allowed for this event'
                };
            }

            return {
                allowed: true,
                event
            };

        } catch (error: any) {
            logger.error('Error checking guest upload permission:', error);
            return {
                allowed: false,
                reason: 'Server error'
            };
        }
    }

    /**
     * Get guest upload statistics for an event
     */
    async getGuestUploadStats(eventId: string): Promise<{
        totalGuestUploads: number;
        totalGuestUploaders: number;
        recentUploads: number; // Last 24 hours
        avgUploadsPerGuest: number;
    }> {
        try {
            const eventObjectId = new mongoose.Types.ObjectId(eventId);

            // Total guest uploads
            const totalGuestUploads = await Media.countDocuments({
                event_id: eventObjectId,
                uploader_type: 'guest'
            });

            // Unique guest uploaders
            const uniqueGuests = await Media.distinct('guest_uploader.guest_id', {
                event_id: eventObjectId,
                uploader_type: 'guest'
            });

            // Recent uploads (last 24 hours)
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentUploads = await Media.countDocuments({
                event_id: eventObjectId,
                uploader_type: 'guest',
                created_at: { $gte: oneDayAgo }
            });

            return {
                totalGuestUploads,
                totalGuestUploaders: uniqueGuests.length,
                recentUploads,
                avgUploadsPerGuest: uniqueGuests.length > 0 ?
                    Math.round(totalGuestUploads / uniqueGuests.length * 100) / 100 : 0
            };

        } catch (error: any) {
            logger.error('Error getting guest upload stats:', error);
            return {
                totalGuestUploads: 0,
                totalGuestUploaders: 0,
                recentUploads: 0,
                avgUploadsPerGuest: 0
            };
        }
    }
}

// Export singleton instance
const guestMediaUploadService = new GuestMediaUploadService();
export default guestMediaUploadService;
// ====================================
// 3. services/upload/admin/admin-upload.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { bytesToMB, cleanupFile } from '@utils/file.util';

// Import shared utilities
import { createInstantPreview, getBasicImageMetadata, getFileExtension, getEstimatedProcessingTime } from '../shared/image-processing.service';
import { getOrCreateDefaultAlbum } from '@services/album';
import { queueImageProcessing } from '@services/guest';
import { EventParticipant } from '@models/event-participants.model';

export interface AdminUploadResult {
    success: boolean;
    media_id?: string;
    url?: string;
    processing_status?: string;
    estimated_processing_time?: string;
    message?: string;
    error?: string;
}

export interface AdminUploadOptions {
    eventId: string;
    albumId?: string;
    userId: string;
    userName: string;
    uploadMethod?: string;
}

/**
 * 🚀 ADMIN/COHOST UPLOAD (NO PERMISSION CHECKS NEEDED)
 */
export const uploadAdminMedia = async (
    file: Express.Multer.File,
    options: AdminUploadOptions
): Promise<AdminUploadResult> => {
    try {
        logger.info(`🔗 Admin upload started`, {
            fileName: file.originalname,
            fileSize: bytesToMB(file.size) + 'MB',
            userId: options.userId,
            eventId: options.eventId
        });

        // No permission checks needed - admin/cohost always allowed
        
        // Get or create album
        const albumResponse = options.albumId 
            ? { status: true, data: { _id: options.albumId } }
            : await getOrCreateDefaultAlbum(options.eventId, options.userId);

        if (!albumResponse.status) {
            await cleanupFile(file);
            return {
                success: false,
                error: 'Failed to get or create album for upload'
            };
        }

        // Process upload (images get instant preview + queue, videos get direct processing)
        const fileType = getFileType(file);
        
        if (fileType === 'image') {
            return await processAdminImageUpload(file, options, albumResponse.data._id.toString());
        } else {
            return await processAdminVideoUpload(file, options, albumResponse.data._id.toString());
        }

    } catch (error: any) {
        logger.error('Admin upload error:', {
            error: error.message,
            fileName: file.originalname,
            userId: options.userId
        });

        await cleanupFile(file);
        return {
            success: false,
            error: 'Upload failed due to server error'
        };
    }
};

const processAdminImageUpload = async (
    file: Express.Multer.File,
    options: AdminUploadOptions,
    albumId: string
): Promise<AdminUploadResult> => {
    try {
        const fileSizeMB = bytesToMB(file.size);

        // Generate IDs
        const mediaId = new mongoose.Types.ObjectId();
        
        // Create instant preview
        const previewUrl = await createInstantPreview(file, mediaId.toString(), options.eventId);

        // Get metadata
        const metadata = await getBasicImageMetadata(file.path);

        // Create database record (admin uploads are auto-approved)
        const media = new Media({
            _id: mediaId,
            url: previewUrl,
            type: 'image',
            album_id: new mongoose.Types.ObjectId(albumId),
            event_id: new mongoose.Types.ObjectId(options.eventId),
            uploaded_by: new mongoose.Types.ObjectId(options.userId),
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
                status: 'auto_approved', // Admin uploads are always approved
                auto_approval_reason: 'admin_upload',
                approved_at: new Date(),
                approved_by: new mongoose.Types.ObjectId(options.userId),
                rejection_reason: ''
            },
            upload_context: {
                method: options.uploadMethod || 'admin_upload',
                platform: 'web'
            }
        });

        await media.save();
        logger.info(`✅ Admin media record created: ${mediaId}`);

        // Update participant stats
        try {
            await EventParticipant.updateOne(
                { 
                    user_id: new mongoose.Types.ObjectId(options.userId),
                    event_id: new mongoose.Types.ObjectId(options.eventId)
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
            logger.warn('Failed to update admin participant stats:', statsError);
            // Don't fail the upload if stats update fails
        }

        // Queue for processing with higher priority
        let jobId: string | null = null;
        try {
            jobId = await queueImageProcessing(
                file,
                media._id.toString(),
                options.eventId,
                albumId,
                {
                    userId: options.userId,
                    userName: options.userName,
                    isGuest: false // Admin upload
                }
            );
        } catch (queueError) {
            logger.error('Queue processing failed:', queueError);
        }

        return {
            success: true,
            media_id: mediaId.toString(),
            url: previewUrl,
            processing_status: jobId ? 'processing' : 'pending',
            estimated_processing_time: getEstimatedProcessingTime(file.size),
            message: 'Image uploaded successfully! High-quality versions processing...'
        };

    } catch (error: any) {
        logger.error('❌ Admin image upload error:', error);
        await cleanupFile(file);
        return {
            success: false,
            error: 'Failed to upload image'
        };
    }
};

const processAdminVideoUpload = async (
    file: Express.Multer.File,
    options: AdminUploadOptions,
    albumId: string
): Promise<AdminUploadResult> => {
    try {
        const fileSizeMB = bytesToMB(file.size);

        // Create media record for video
        const media = new Media({
            url: '/placeholder-video.mp4',
            type: 'video',
            album_id: new mongoose.Types.ObjectId(albumId),
            event_id: new mongoose.Types.ObjectId(options.eventId),
            uploaded_by: new mongoose.Types.ObjectId(options.userId),
            uploader_type: 'registered_user',
            original_filename: file.originalname,
            size_mb: fileSizeMB,
            format: file.mimetype.split('/')[1],
            processing: {
                status: 'pending',
                started_at: new Date(),
                variants_generated: false,
            },
            approval: {
                status: 'auto_approved', // Admin uploads are always approved
                auto_approval_reason: 'admin_upload',
                approved_at: new Date(),
                approved_by: new mongoose.Types.ObjectId(options.userId),
                rejection_reason: ''
            }
        });

        await media.save();

        // Update participant stats
        try {
            await EventParticipant.updateOne(
                { 
                    user_id: new mongoose.Types.ObjectId(options.userId),
                    event_id: new mongoose.Types.ObjectId(options.eventId)
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
            logger.warn('Failed to update admin video participant stats:', statsError);
            // Don't fail the upload if stats update fails
        }

        return {
            success: true,
            media_id: media._id.toString(),
            url: media.url,
            processing_status: 'pending',
            message: 'Video uploaded successfully'
        };

    } catch (error: any) {
        logger.error('Admin video upload error:', error);
        return {
            success: false,
            error: 'Failed to upload video'
        };
    } finally {
        await cleanupFile(file);
    }
};

// Helper function (could be shared)
const getFileType = (file: Express.Multer.File): 'image' | 'video' | null => {
    if (file.mimetype.startsWith('image/')) return 'image';
    if (file.mimetype.startsWith('video/')) return 'video';
    return null;
};
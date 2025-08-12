// // services/guest.service.ts - ENHANCED with queue and variant processing

// import fs from 'fs/promises';
// import mongoose from 'mongoose';
// import { logger } from '@utils/logger';
// import { Media, createGuestUploaderInfo } from '@models/media.model';
// import { Event } from '@models/event.model';
// import { getOrCreateDefaultAlbum } from '@services/album.service';
// import { uploadPreviewImage } from '@services/uploadService';
// import { getImageQueue } from 'queues/imageQueue';
// import { determineApprovalStatus } from '@utils/user.utils';
// import { getFileType, isValidImageFormat, cleanupFile, bytesToMB } from '@utils/file.util';
// import sharp from 'sharp';

// interface GuestUploadResult {
//     success: boolean;
//     media_id?: string;
//     url?: string;
//     approval_status?: string;
//     message?: string;
//     error?: string;
//     processing_status?: string;
//     estimated_processing_time?: string;
// }

// interface GuestUploadInfo {
//     name?: string;
//     email?: string;
//     phone?: string;
//     sessionId?: string;
//     deviceFingerprint?: string;
//     uploadMethod?: string;
//     platformInfo?: any;
// }

// class GuestMediaUploadService {
//     /**
//      * 🚀 ENHANCED: Upload media as a guest user with queue processing
//      */
//     async uploadGuestMedia(
//         shareToken: string,
//         file: Express.Multer.File,
//         guestInfo: GuestUploadInfo,
//         authenticatedUserId?: string
//     ): Promise<GuestUploadResult> {
//         try {
//             logger.info(`🔗 Guest upload started`, {
//                 shareToken: shareToken.substring(0, 8) + '...',
//                 fileName: file.originalname,
//                 fileSize: bytesToMB(file.size) + 'MB',
//                 guestInfo: {
//                     name: guestInfo.name || 'Anonymous',
//                     email: guestInfo.email ? 'provided' : 'not provided',
//                     authenticated: !!authenticatedUserId
//                 }
//             });

//             // Find event by share token
//             const event = await Event.findOne({ share_token: shareToken });
//             if (!event) {
//                 await cleanupFile(file);
//                 return {
//                     success: false,
//                     error: 'Invalid share token or event not found'
//                 };
//             }

//             // Check if uploads are allowed
//             if (!event.permissions?.can_upload) {
//                 await cleanupFile(file);
//                 return {
//                     success: false,
//                     error: 'Uploads are not allowed for this event'
//                 };
//             }

//             // Validate file type
//             const fileType = getFileType(file);
//             if (!fileType) {
//                 await cleanupFile(file);
//                 return {
//                     success: false,
//                     error: 'Unsupported file type. Only images and videos are allowed.'
//                 };
//             }

//             // For images, validate format
//             if (fileType === 'image' && !isValidImageFormat(file)) {
//                 await cleanupFile(file);
//                 return {
//                     success: false,
//                     error: 'Unsupported image format. Supported formats: JPEG, PNG, WebP, HEIC'
//                 };
//             }

//             // Check file size limits (adjust based on your event settings)
//             const maxSizeMB = 100; // Increased to match admin uploads
//             const fileSizeMB = bytesToMB(file.size);
//             if (fileSizeMB > maxSizeMB) {
//                 await cleanupFile(file);
//                 return {
//                     success: false,
//                     error: `File size exceeds limit of ${maxSizeMB}MB`
//                 };
//             }

//             // Get or create default album
//             const defaultAlbumResponse = await getOrCreateDefaultAlbum(
//                 event._id.toString(),
//                 authenticatedUserId || 'guest'
//             );

//             if (!defaultAlbumResponse.status) {
//                 await cleanupFile(file);
//                 return {
//                     success: false,
//                     error: 'Failed to get or create album for upload'
//                 };
//             }

//             // Determine approval status
//             const approvalConfig = await determineApprovalStatus(
//                 event._id.toString(),
//                 authenticatedUserId || null
//             );

//             // Create guest uploader info matching your model structure
//             const guestUploaderInfo = createGuestUploaderInfo(guestInfo, true);

//             // Process upload based on file type
//             if (fileType === 'image') {
//                 return await this.processGuestImageUploadWithQueue(
//                     file,
//                     event._id.toString(),
//                     defaultAlbumResponse.data._id.toString(),
//                     guestUploaderInfo,
//                     approvalConfig,
//                     authenticatedUserId
//                 );
//             } else {
//                 return await this.processGuestVideoUpload(
//                     file,
//                     event._id.toString(),
//                     defaultAlbumResponse.data._id.toString(),
//                     guestUploaderInfo,
//                     approvalConfig,
//                     authenticatedUserId
//                 );
//             }

//         } catch (error: any) {
//             logger.error('Guest upload error:', {
//                 error: error.message,
//                 shareToken: shareToken.substring(0, 8) + '...',
//                 fileName: file.originalname
//             });

//             await cleanupFile(file);
//             return {
//                 success: false,
//                 error: 'Upload failed due to server error'
//             };
//         }
//     }

//     /**
//      * 🚀 NEW: Process guest image upload with queue and variants (similar to admin)
//      */
//     private async processGuestImageUploadWithQueue(
//         file: Express.Multer.File,
//         eventId: string,
//         albumId: string,
//         guestUploaderInfo: any,
//         approvalConfig: any,
//         authenticatedUserId?: string
//     ): Promise<GuestUploadResult> {
//         try {
//             const fileSizeMB = bytesToMB(file.size);

//             // 🚀 GENERATE IDs
//             const mediaId = new mongoose.Types.ObjectId();
//             const albumObjectId = new mongoose.Types.ObjectId(albumId);
//             const eventObjectId = new mongoose.Types.ObjectId(eventId);
//             const userObjectId = authenticatedUserId ? new mongoose.Types.ObjectId(authenticatedUserId) : null;

//             // 🚀 CRITICAL: Create preview image immediately (same as admin)
//             const previewUrl = await this.createInstantPreview(file, mediaId.toString(), eventId);

//             // 🔧 GET BASIC METADATA
//             const metadata = await this.getBasicImageMetadata(file.path);

//             // 🚀 CREATE DATABASE RECORD (similar to admin but with guest info)
//             const media = new Media({
//                 _id: mediaId,
//                 url: previewUrl,
//                 type: 'image',
//                 album_id: albumObjectId,
//                 event_id: eventObjectId,
//                 uploaded_by: userObjectId,
//                 guest_uploader: !authenticatedUserId ? guestUploaderInfo : null,
//                 uploader_type: authenticatedUserId ? 'registered_user' : 'guest',
//                 original_filename: file.originalname,
//                 size_mb: fileSizeMB,
//                 format: this.getFileExtension(file),
//                 metadata: {
//                     width: metadata.width,
//                     height: metadata.height,
//                     aspect_ratio: metadata.aspect_ratio
//                 },
//                 processing: {
//                     status: 'processing',
//                     started_at: new Date(),
//                     variants_generated: false,
//                 },
//                 approval: {
//                     status: approvalConfig.status,
//                     auto_approval_reason: approvalConfig.autoApprovalReason,
//                     approved_at: approvalConfig.approvedAt,
//                     approved_by: approvalConfig.approvedBy,
//                     rejection_reason: ''
//                 },
//                 upload_context: {
//                     method: 'guest_upload',
//                     ip_address: guestUploaderInfo.session_id?.split('_')[0] || '',
//                     user_agent: guestUploaderInfo.device_fingerprint || '',
//                     upload_session_id: guestUploaderInfo.session_id || '',
//                     referrer_url: guestUploaderInfo.platform_info?.referrer || '',
//                     platform: 'web'
//                 }
//             });

//             await media.save();

//             logger.info(`✅ Guest media record created: ${mediaId}`);

//             // 🚀 QUEUE FOR BACKGROUND PROCESSING (same as admin)
//             const imageQueue = getImageQueue();
//             let jobId = null;

//             if (imageQueue) {
//                 try {
//                     const job = await imageQueue.add('process-image', {
//                         mediaId: mediaId.toString(),
//                         userId: authenticatedUserId || 'guest',
//                         userName: guestUploaderInfo.name || 'Guest User',
//                         eventId,
//                         albumId,
//                         filePath: file.path,
//                         originalFilename: file.originalname,
//                         fileSize: file.size,
//                         mimeType: file.mimetype,
//                         hasPreview: true,
//                         previewBroadcasted: false, // No WebSocket for guests yet
//                         isGuestUpload: true // NEW: Flag for guest uploads
//                     }, {
//                         priority: fileSizeMB < 5 ? 8 : 3, // Slightly lower priority than admin
//                         delay: 0,
//                         attempts: 3,
//                         backoff: { type: 'exponential', delay: 2000 }
//                     });

//                     jobId = job.id;
//                     logger.info(`✅ Guest upload job queued: ${job.id}`);

//                 } catch (queueError) {
//                     logger.error('Guest upload queue error:', queueError);
//                     // Don't fail the upload if queue fails, but cleanup file
//                     await cleanupFile(file);
//                 }
//             } else {
//                 logger.warn('No image queue available for guest upload');
//                 await cleanupFile(file);
//             }

//             // 🚀 RETURN SUCCESS (similar to admin response)
//             return {
//                 success: true,
//                 media_id: mediaId.toString(),
//                 url: previewUrl,
//                 approval_status: media.approval.status,
//                 processing_status: jobId ? 'processing' : 'pending',
//                 estimated_processing_time: this.getEstimatedProcessingTime(file.size),
//                 message: `${authenticatedUserId ? 'Image' : 'Guest image'} uploaded successfully! High-quality versions processing...`
//             };

//         } catch (error: any) {
//             logger.error('❌ Guest image upload error:', error);
//             await cleanupFile(file);
//             return {
//                 success: false,
//                 error: 'Failed to upload image'
//             };
//         }
//     }

//     /**
//      * 🚀 NEW: Create instant preview for guest uploads (same as admin)
//      */
//     private async createInstantPreview(
//         file: Express.Multer.File,
//         mediaId: string,
//         eventId: string
//     ): Promise<string> {
//         try {
//             const previewBuffer = await sharp(file.path)
//                 .resize(800, 800, {
//                     fit: 'inside',
//                     withoutEnlargement: true
//                 })
//                 .jpeg({
//                     quality: 85,
//                     progressive: true
//                 })
//                 .toBuffer();

//             const previewUrl = await uploadPreviewImage(previewBuffer, mediaId, eventId);
//             logger.info(`✅ Guest preview created: ${mediaId} -> ${previewUrl}`);
//             return previewUrl;

//         } catch (error) {
//             logger.error('Guest preview creation failed:', error);
//             return '/placeholder-image.jpg';
//         }
//     }

//     /**
//      * 🚀 NEW: Get basic image metadata (same as admin)
//      */
//     private async getBasicImageMetadata(filePath: string) {
//         try {
//             const metadata = await sharp(filePath).metadata();
//             return {
//                 width: metadata.width || 0,
//                 height: metadata.height || 0,
//                 aspect_ratio: metadata.height && metadata.width ? metadata.height / metadata.width : 1
//             };
//         } catch (error) {
//             logger.warn('Failed to get guest upload metadata:', error);
//             return { width: 0, height: 0, aspect_ratio: 1 };
//         }
//     }

//     /**
//      * 🚀 NEW: Helper functions (same as admin)
//      */
//     private getFileExtension(file: Express.Multer.File): string {
//         return file.mimetype.split('/')[1] || 'jpg';
//     }

//     private getEstimatedProcessingTime(fileSizeBytes: number): string {
//         const sizeMB = fileSizeBytes / (1024 * 1024);
//         const seconds = Math.max(5, Math.min(sizeMB * 2, 30));
//         return `${Math.round(seconds)}s`;
//     }

//     /**
//      * Process guest video upload (existing implementation)
//      */
//     private async processGuestVideoUpload(
//         file: Express.Multer.File,
//         eventId: string,
//         albumId: string,
//         guestUploaderInfo: any,
//         approvalConfig: any,
//         authenticatedUserId?: string
//     ): Promise<GuestUploadResult> {
//         try {
//             const fileSizeMB = bytesToMB(file.size);

//             // For videos, we'll use a simpler approach for now
//             // You can enhance this later with video processing queue

//             // Create media record directly for videos
//             const media = new Media({
//                 url: '/placeholder-video.mp4', // Will be updated after processing
//                 type: 'video',
//                 album_id: new mongoose.Types.ObjectId(albumId),
//                 event_id: new mongoose.Types.ObjectId(eventId),
//                 uploaded_by: authenticatedUserId ? new mongoose.Types.ObjectId(authenticatedUserId) : null,
//                 guest_uploader: !authenticatedUserId ? guestUploaderInfo : null,
//                 uploader_type: authenticatedUserId ? 'registered_user' : 'guest',
//                 original_filename: file.originalname,
//                 size_mb: fileSizeMB,
//                 format: file.mimetype.split('/')[1],
//                 processing: {
//                     status: 'pending', // Videos need processing too
//                     started_at: new Date(),
//                     variants_generated: false,
//                 },
//                 approval: {
//                     status: approvalConfig.status,
//                     auto_approval_reason: approvalConfig.autoApprovalReason,
//                     approved_at: approvalConfig.approvedAt,
//                     approved_by: approvalConfig.approvedBy,
//                     rejection_reason: ''
//                 }
//             });

//             await media.save();

//             logger.info(`✅ Guest video upload completed`, {
//                 mediaId: media._id.toString(),
//                 fileName: file.originalname,
//                 approvalStatus: media.approval.status
//             });

//             return {
//                 success: true,
//                 media_id: media._id.toString(),
//                 url: media.url,
//                 approval_status: media.approval.status,
//                 processing_status: 'pending',
//                 message: 'Video uploaded successfully'
//             };

//         } catch (error: any) {
//             logger.error('Guest video upload error:', error);
//             return {
//                 success: false,
//                 error: 'Failed to upload video'
//             };
//         } finally {
//             await cleanupFile(file);
//         }
//     }

//     /**
//      * Calculate total size of variants (same as admin)
//      */
//     private calculateTotalVariantsSize(variants: any): number {
//         let total = 0;
//         try {
//             Object.values(variants).forEach((sizeVariants: any) => {
//                 if (sizeVariants && typeof sizeVariants === 'object') {
//                     Object.values(sizeVariants).forEach((formatVariant: any) => {
//                         if (formatVariant && formatVariant.size_mb) {
//                             total += formatVariant.size_mb;
//                         }
//                     });
//                 }
//             });
//         } catch (error) {
//             logger.warn('Error calculating variants size:', error);
//         }
//         return Math.round(total * 100) / 100;
//     }

//     /**
//      * Check if guest has permission to upload (existing)
//      */
//     async checkGuestUploadPermission(shareToken: string): Promise<{
//         allowed: boolean;
//         event?: any;
//         reason?: string;
//     }> {
//         try {
//             const event = await Event.findOne({ share_token: shareToken });

//             if (!event) {
//                 return {
//                     allowed: false,
//                     reason: 'Event not found'
//                 };
//             }

//             if (!event.permissions?.can_upload) {
//                 return {
//                     allowed: false,
//                     event,
//                     reason: 'Uploads not allowed for this event'
//                 };
//             }

//             return {
//                 allowed: true,
//                 event
//             };

//         } catch (error: any) {
//             logger.error('Error checking guest upload permission:', error);
//             return {
//                 allowed: false,
//                 reason: 'Server error'
//             };
//         }
//     }

//     /**
//      * Get guest upload statistics for an event (existing)
//      */
//     async getGuestUploadStats(eventId: string): Promise<{
//         totalGuestUploads: number;
//         totalGuestUploaders: number;
//         recentUploads: number;
//         avgUploadsPerGuest: number;
//     }> {
//         try {
//             const eventObjectId = new mongoose.Types.ObjectId(eventId);

//             const totalGuestUploads = await Media.countDocuments({
//                 event_id: eventObjectId,
//                 uploader_type: 'guest'
//             });

//             const uniqueGuests = await Media.distinct('guest_uploader.guest_id', {
//                 event_id: eventObjectId,
//                 uploader_type: 'guest'
//             });

//             const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
//             const recentUploads = await Media.countDocuments({
//                 event_id: eventObjectId,
//                 uploader_type: 'guest',
//                 created_at: { $gte: oneDayAgo }
//             });

//             return {
//                 totalGuestUploads,
//                 totalGuestUploaders: uniqueGuests.length,
//                 recentUploads,
//                 avgUploadsPerGuest: uniqueGuests.length > 0 ?
//                     Math.round(totalGuestUploads / uniqueGuests.length * 100) / 100 : 0
//             };

//         } catch (error: any) {
//             logger.error('Error getting guest upload stats:', error);
//             return {
//                 totalGuestUploads: 0,
//                 totalGuestUploaders: 0,
//                 recentUploads: 0,
//                 avgUploadsPerGuest: 0
//             };
//         }
//     }
// }

// // Export singleton instance
// const guestMediaUploadService = new GuestMediaUploadService();
// export default guestMediaUploadService;
// controllers/upload.controller.ts - Improved and cleaned up

import { Request, Response, NextFunction, RequestHandler } from 'express';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import ImageKit from 'imagekit';
import { logger } from '@utils/logger';
import { getOrCreateDefaultAlbum } from '@services/album.service';
import { imageProcessingService } from '@services/imageProcessing.service';
import { checkUserLimitsService } from '@services/user.service';
import { determineApprovalStatus } from '@utils/user.utils';
import { Media } from '@models/media.model';
import { updateUsageForUpload } from '@models/user-usage.model';

// Enhanced service response interface
interface ServiceResponse<T> {
    status: boolean;
    code: number;
    message: string;
    data: T | null;
    error: any;
    other?: any;
}

// Helper function to send consistent responses
function sendResponse<T>(res: Response, response: ServiceResponse<T>) {
    res.status(response.code).json(response);
}

// ImageKit configuration with error handling
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

// Enhanced request interfaces
interface AuthenticatedRequest extends Request {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
    };
    file?: Express.Multer.File;
    sessionID?: string;
}

interface MediaCreationType {
    _id?: mongoose.Types.ObjectId;
    url: string;
    type: 'image' | 'video';
    album_id: mongoose.Types.ObjectId;
    event_id: mongoose.Types.ObjectId;
    uploaded_by?: mongoose.Types.ObjectId;
    guest_uploader?: any;
    uploader_type: 'registered_user' | 'guest';
    original_filename: string;
    size_mb: number;
    format: string;
    image_variants?: any;
    metadata?: any;
    processing?: any;
    approval?: any;
    upload_context?: any;
    toObject?: () => any;
}

/**
 * Main upload controller for authenticated users
 */
export const uploadMediaController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const file = req.file;
        let { album_id, event_id } = req.body;
        const user_id = req.user._id;

        logger.info('📤 Media upload request received', {
            file: file ? `${file.originalname} (${file.size} bytes)` : 'No file',
            album_id,
            event_id,
            user_id: user_id?.toString(),
            mimetype: file?.mimetype
        });

        // Validation
        if (!file) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "Missing file",
                data: null,
                error: { message: "File is required" },
                other: null
            });
            return;
        }

        if (!event_id) {
            res.status(400).json({
                status: false,
                code: 400,
                message: "Missing event_id",
                data: null,
                error: { message: "event_id is required" },
                other: null
            });
            return;
        }

        // Validate event_id format
        if (!mongoose.Types.ObjectId.isValid(event_id)) {
            await cleanupFile(file);
            res.status(400).json({
                status: false,
                code: 400,
                message: "Invalid event_id format",
                data: null,
                error: { message: "event_id must be a valid ObjectId" },
                other: null
            });
            return;
        }

        // Validate file type
        const fileType = getFileType(file);
        if (!fileType) {
            await cleanupFile(file);
            res.status(400).json({
                status: false,
                code: 400,
                message: "Unsupported file type",
                data: null,
                error: { message: "Only image and video files are supported" },
                other: null
            });
            return;
        }

        // For images, validate format support
        if (fileType === 'image' && !isValidImageFormat(file)) {
            await cleanupFile(file);
            res.status(400).json({
                status: false,
                code: 400,
                message: "Unsupported image format",
                data: null,
                error: { message: "Supported formats: JPEG, PNG, WebP, HEIC, TIFF" },
                other: null
            });
            return;
        }

        // Handle default album
        if (!album_id) {
            const defaultAlbumResponse = await getOrCreateDefaultAlbum(event_id, user_id.toString());
            if (!defaultAlbumResponse.status || !defaultAlbumResponse.data) {
                await cleanupFile(file);
                res.status(500).json({
                    status: false,
                    code: 500,
                    message: "Failed to get or create default album",
                    data: null,
                    error: { message: "Could not create or find default album" },
                    other: null
                });
                return;
            }
            album_id = defaultAlbumResponse.data._id.toString();
        }

        // Validate album_id format if provided
        if (album_id && !mongoose.Types.ObjectId.isValid(album_id)) {
            await cleanupFile(file);
            res.status(400).json({
                status: false,
                code: 400,
                message: "Invalid album_id format",
                data: null,
                error: { message: "album_id must be a valid ObjectId" },
                other: null
            });
            return;
        }

        // Process upload based on file type
        let response: ServiceResponse<MediaCreationType>;
        if (fileType === 'image') {
            response = await uploadImageWithProcessing(file, user_id.toString(), album_id, event_id, req);
        } else {
            response = await uploadVideoService(file, user_id.toString(), album_id, event_id, req);
        }

        sendResponse(res, response);
    } catch (error: any) {
        logger.error('Upload controller error:', error);
        if (req.file?.path) {
            await cleanupFile(req.file).catch(() => { });
        }
        next(error);
    }
};

/**
 * Upload and process image with all variants
 */

export const uploadImageWithProcessing = async (
    file: Express.Multer.File,
    user_id: string,
    album_id: string,
    event_id: string,
    req: AuthenticatedRequest
): Promise<ServiceResponse<MediaCreationType>> => {
    try {
        logger.info(`🖼️ Starting image upload and processing: ${file.originalname}`);

        const fileSizeInMB = file.size / (1024 * 1024);

        // Check storage limits
        const canUpload = await checkUserLimitsService(user_id, 'storage', fileSizeInMB);
        if (!canUpload) {
            await cleanupFile(file);
            return {
                status: false,
                code: 403,
                message: "Storage limit exceeded",
                data: null,
                error: { message: "You have reached your storage limit. Please upgrade your subscription." },
                other: null
            };
        }

        // Determine approval status
        const approvalConfig = await determineApprovalStatus(event_id, user_id);
        logger.info(`📸 Approval config for user ${user_id}:`, approvalConfig);

        // ✅ FIX: Process image FIRST, then create media record
        let processingResult;
        let media_id = new mongoose.Types.ObjectId().toString();

        try {
            // Process image and generate variants FIRST
            processingResult = await imageProcessingService.processImage(file, event_id, media_id);

            logger.info(`✅ Image processing completed for ${file.originalname}`);

        } catch (processingError: any) {
            logger.error(`❌ Image processing failed for ${file.originalname}:`, processingError);

            // If processing fails, try to upload original to ImageKit as fallback
            let fallbackUrl = '';
            try {
                const fileBuffer = await fs.readFile(file.path);
                const uploadResult = await imagekit.upload({
                    file: fileBuffer,
                    fileName: `${Date.now()}_${file.originalname}`,
                    folder: `/events/${event_id}/images`,
                });
                fallbackUrl = uploadResult.url;
                logger.info('✅ Fallback upload successful');
            } catch (uploadError) {
                logger.error('❌ Fallback upload also failed:', uploadError);
                return {
                    status: false,
                    code: 500,
                    message: "Image processing and fallback upload failed",
                    data: null,
                    error: { message: processingError.message },
                    other: null
                };
            }

            // Create media record with fallback URL
            const media = new Media({
                _id: new mongoose.Types.ObjectId(media_id),
                url: fallbackUrl, // ✅ URL is available
                type: 'image',
                album_id: new mongoose.Types.ObjectId(album_id),
                event_id: new mongoose.Types.ObjectId(event_id),
                uploaded_by: new mongoose.Types.ObjectId(user_id),
                uploader_type: 'registered_user',
                original_filename: file.originalname,
                size_mb: fileSizeInMB,
                format: file.mimetype.split('/')[1],
                processing: {
                    status: 'failed',
                    started_at: new Date(),
                    completed_at: new Date(),
                    processing_time_ms: 0,
                    variants_generated: false,
                    variants_count: 0,
                    total_variants_size_mb: 0,
                    error_message: processingError.message,
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
                    method: 'web',
                    ip_address: req.ip || '',
                    user_agent: req.get('User-Agent') || '',
                    upload_session_id: req.sessionID || '',
                    referrer_url: req.get('Referer') || '',
                    platform: 'web'
                }
            });

            await media.save();
            await updateUsageForUpload(user_id, fileSizeInMB, event_id);

            return {
                status: false,
                code: 500,
                message: "Image processing failed but file uploaded",
                data: media.toObject(),
                error: { message: processingError.message },
                other: {
                    fallback_uploaded: true,
                    processing_error: processingError.message
                }
            };
        }

        // ✅ SUCCESS: Create media record with processing results
        const media = new Media({
            _id: new mongoose.Types.ObjectId(media_id),
            url: processingResult.original.url, // ✅ URL is available from processing
            type: 'image',
            album_id: new mongoose.Types.ObjectId(album_id),
            event_id: new mongoose.Types.ObjectId(event_id),
            uploaded_by: new mongoose.Types.ObjectId(user_id),
            uploader_type: 'registered_user',
            original_filename: file.originalname,
            size_mb: fileSizeInMB,
            format: file.mimetype.split('/')[1],
            image_variants: {
                original: processingResult.original,
                small: processingResult.variants.small,
                medium: processingResult.variants.medium,
                large: processingResult.variants.large
            },
            metadata: {
                width: processingResult.original.width || 0,
                height: processingResult.original.height || 0,
                duration: 0,
                aspect_ratio: processingResult.original.height && processingResult.original.width ?
                    processingResult.original.height / processingResult.original.width : 1,
                color_profile: '',
                has_transparency: false,
                timestamp: new Date(),
                device_info: { brand: '', model: '', os: '' },
                location: { latitude: null, longitude: null, address: '' },
                camera_settings: { iso: null, aperture: '', shutter_speed: '', focal_length: '' }
            },
            processing: {
                status: 'completed',
                started_at: new Date(),
                completed_at: new Date(),
                processing_time_ms: 0, // You can calculate this if needed
                variants_generated: true,
                variants_count: calculateVariantsCount(processingResult.variants),
                total_variants_size_mb: calculateTotalVariantsSize(processingResult.variants),
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
                method: 'web',
                ip_address: req.ip || '',
                user_agent: req.get('User-Agent') || '',
                upload_session_id: req.sessionID || '',
                referrer_url: req.get('Referer') || '',
                platform: 'web'
            }
        });

        await media.save(); // ✅ This will work because URL is present
        await updateUsageForUpload(user_id, fileSizeInMB, event_id);

        logger.info(`✅ Image upload and processing completed successfully`, {
            media_id,
            original_size: `${processingResult.original.width}x${processingResult.original.height}`,
            variants_count: calculateVariantsCount(processingResult.variants)
        });

        return {
            status: true,
            code: 200,
            message: "Image upload and processing successful",
            data: media.toObject(),
            error: null,
            other: {
                processing_info: {
                    variants_generated: calculateVariantsCount(processingResult.variants),
                    total_size_mb: calculateTotalVariantsSize(processingResult.variants)
                }
            }
        };

    } catch (error: any) {
        logger.error('Image upload service error:', error);
        return {
            status: false,
            code: 500,
            message: "Failed to upload image",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await cleanupFile(file);
    }
};

/**
 * Upload video service (simplified - no processing for now)
 */
export const uploadVideoService = async (
    file: Express.Multer.File,
    user_id: string,
    album_id: string,
    event_id: string,
    req: AuthenticatedRequest
): Promise<ServiceResponse<MediaCreationType>> => {
    try {
        logger.info(`🎥 Starting video upload: ${file.originalname}`);

        const fileSizeInMB = file.size / (1024 * 1024);

        // Check storage limits
        const canUpload = await checkUserLimitsService(user_id, 'storage', fileSizeInMB);
        if (!canUpload) {
            await cleanupFile(file);
            return {
                status: false,
                code: 403,
                message: "Storage limit exceeded",
                data: null,
                error: { message: "Storage limit exceeded" },
                other: null
            };
        }

        // Upload video to ImageKit
        const fileBuffer = await fs.readFile(file.path);

        const uploadResult = await imagekit.upload({
            file: fileBuffer,
            fileName: `${Date.now()}_${file.originalname}`,
            folder: `/events/${event_id}/videos`,
            transformation: {
                pre: 'q_auto,f_auto' // Auto quality and format optimization
            }
        });

        const approvalConfig = await determineApprovalStatus(event_id, user_id);

        const media = await Media.create({
            url: uploadResult.url,
            type: 'video',
            album_id: new mongoose.Types.ObjectId(album_id),
            event_id: new mongoose.Types.ObjectId(event_id),
            uploaded_by: new mongoose.Types.ObjectId(user_id),
            uploader_type: 'registered_user',
            original_filename: file.originalname,
            size_mb: fileSizeInMB,
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
                method: 'web',
                ip_address: req.ip || '',
                user_agent: req.get('User-Agent') || '',
                upload_session_id: req.sessionID || '',
                referrer_url: req.get('Referer') || '',
                platform: 'web'
            }
        });

        await updateUsageForUpload(user_id, fileSizeInMB, event_id);

        logger.info(`✅ Video upload completed: ${file.originalname}`, {
            media_id: media._id.toString(),
            url: uploadResult.url
        });

        return {
            status: true,
            code: 200,
            message: "Video upload successful",
            data: media.toObject(),
            error: null,
            other: {
                imagekit_file_id: uploadResult.fileId,
                video_info: {
                    duration: 0,
                    size_mb: fileSizeInMB
                }
            }
        };

    } catch (error: any) {
        logger.error('Video upload error:', error);
        return {
            status: false,
            code: 500,
            message: "Failed to upload video",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await cleanupFile(file);
    }
};

/**
 * Utility functions
 */
function getFileType(file: Express.Multer.File): 'image' | 'video' | null {
    if (file.mimetype.startsWith("image/")) return "image";
    if (file.mimetype.startsWith("video/")) return "video";
    return null;
}

function isValidImageFormat(file: Express.Multer.File): boolean {
    const validImageTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/tiff',
        'image/tif'
    ];
    return validImageTypes.includes(file.mimetype.toLowerCase());
}

async function cleanupFile(file: Express.Multer.File): Promise<void> {
    try {
        if (file?.path) {
            await fs.unlink(file.path);
            logger.debug(`🗑️ Cleaned up temp file: ${file.path}`);
        }
    } catch (error) {
        logger.warn(`Failed to cleanup file ${file.path}:`, error);
    }
}

function calculateTotalVariantsSize(variants: any): number {
    if (!variants) return 0;

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

function calculateVariantsCount(variants: any): number {
    if (!variants) return 0;

    let count = 0;
    try {
        Object.values(variants).forEach((sizeVariants: any) => {
            if (sizeVariants && typeof sizeVariants === 'object') {
                Object.keys(sizeVariants).forEach(() => {
                    count++;
                });
            }
        });
    } catch (error) {
        logger.warn('Error calculating variants count:', error);
    }
    return count;
}
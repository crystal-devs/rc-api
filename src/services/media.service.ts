// services/media.service.ts

import fs from "fs/promises";
import mongoose from "mongoose";
import ImageKit from "imagekit";
import { Media, MediaCreationType } from "@models/media.model";
import { ServiceResponse } from "types/service.types";
import { updateUsageForUpload, updateUsageForDelete } from "@models/user-usage.model";
import { checkUserLimitsService } from "@services/user.service";
import { logger } from "@utils/logger";

const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

/**
 * Upload regular media to ImageKit and create a Media record
 */
export const uploadMediaService = async (
    file: Express.Multer.File,
    user_id: string,
    album_id: string,
    event_id: string
): Promise<ServiceResponse<MediaCreationType>> => {
    try {
        const fileBuffer = await fs.readFile(file.path);

        const fileType = (() => {
            if (file.mimetype.startsWith("image/")) return "image";
            if (file.mimetype.startsWith("video/")) return "video";
            return null;
        })();

        if (!fileType) {
            await fs.unlink(file.path);
            return {
                status: false,
                code: 400,
                message: "Unsupported file type",
                data: null,
                error: { message: "Only image and video files are supported" },
                other: null,
            };
        }

        // Calculate file size in MB
        const fileSizeInMB = file.size / (1024 * 1024);

        // Check if user has enough storage in their subscription
        const canUpload = await checkUserLimitsService(user_id, 'storage', fileSizeInMB);

        if (!canUpload) {
            await fs.unlink(file.path);
            return {
                status: false,
                code: 403,
                message: "Storage limit exceeded",
                data: null,
                error: {
                    message: "You have reached your storage limit. Please upgrade your subscription to upload more files."
                },
                other: null,
            };
        }

        // Upload file to ImageKit
        const uploadResult = await imagekit.upload({
            file: fileBuffer,
            fileName: `${Date.now()}_${file.originalname}`,
            folder: `/media`,
        });

        await fs.unlink(file.path); // Always clean up

        // Create media record
        const media = await Media.create({
            url: uploadResult.url,
            type: fileType,
            album_id: new mongoose.Types.ObjectId(album_id),
            event_id: new mongoose.Types.ObjectId(event_id),
            uploaded_by: new mongoose.Types.ObjectId(user_id),
            size_mb: fileSizeInMB, // Store the file size for future reference
        });

        // Update user usage metrics
        try {
            await updateUsageForUpload(user_id, fileSizeInMB, event_id);
            logger.info(`Updated usage for user ${user_id} - Added ${fileSizeInMB}MB`);
        } catch (usageError) {
            logger.error(`Failed to update usage for user ${user_id}: ${usageError}`);
            // Don't fail the upload if usage tracking fails
        }

        return {
            status: true,
            code: 200,
            message: "Media upload successful",
            data: media,
            error: null,
            other: null,
        };

    } catch (err: any) {
        if (file?.path) await fs.unlink(file.path).catch(() => { });

        return {
            status: false,
            code: 500,
            message: "Failed to upload media",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Simply upload a cover image and return its URL
 * No Media record is created - just uploads to ImageKit and returns the URL
 */
export const uploadCoverImageService = async (
    file: Express.Multer.File,
    folder: string = "covers"
): Promise<ServiceResponse<{ url: string }>> => {
    try {
        const fileBuffer = await fs.readFile(file.path);

        // Check if file is an image
        if (!file.mimetype.startsWith("image/")) {
            await fs.unlink(file.path);
            return {
                status: false,
                code: 400,
                message: "Unsupported file type",
                data: null,
                error: { message: "Only image files are supported for cover images" },
                other: null,
            };
        }

        // Upload to the covers folder
        const uploadResult = await imagekit.upload({
            file: fileBuffer,
            fileName: `${Date.now()}_cover_${file.originalname}`,
            folder: `/${folder}`, // Simple folder structure
        });

        await fs.unlink(file.path); // Clean up

        return {
            status: true,
            code: 200,
            message: "Cover image upload successful",
            data: { url: uploadResult.url },
            error: null,
            other: null,
        };

    } catch (err: any) {
        if (file?.path) await fs.unlink(file.path).catch(() => { });

        return {
            status: false,
            code: 500,
            message: "Failed to upload cover image",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Get all media for a specific event
 */
export const getMediaByEventService = async (
    eventId: string,
    options: {
        includeProcessing?: boolean;
        includePending?: boolean;
        page?: number;
        limit?: number;
        quality?: 'thumbnail' | 'display' | 'full';
        since?: string;
    } = {},
    userId?: string // Optional, for permission checks
): Promise<ServiceResponse<any[]>> => {
    try {
        // Validate event_id
        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'Invalid ObjectId format' },
                other: null,
            };
        }

        // Build query
        const query: any = { event_id: new mongoose.Types.ObjectId(eventId) };

        // Filter by approval status
        if (!options.includePending) {
            query['approval.status'] = { $in: ['approved', 'auto_approved'] };
        }

        // Filter by processing status
        if (!options.includeProcessing) {
            query['processing.status'] = 'completed';
        }

        // Filter by since date
        if (options.since) {
            query.updated_at = { $gt: new Date(options.since) };
        }

        // Build aggregation pipeline
        const pipeline: mongoose.PipelineStage[] = [
            { $match: query },
            { $sort: { created_at: -1 } },
        ];

        // Handle pagination
        const page = options.page || 1;
        const limit = options.limit || 20;
        if (page && limit) {
            pipeline.push(
                { $skip: (page - 1) * limit },
                { $limit: limit }
            );
        }

        // Project fields based on quality
        const projection: any = {
            url: 1,
            public_id: 1,
            type: 1,
            album_id: 1,
            event_id: 1,
            uploaded_by: 1,
            original_filename: 1,
            size_mb: 1,
            format: 1,
            approval: 1,
            processing: 1,
            metadata: 1,
            stats: 1,
            content_flags: 1,
            created_at: 1,
            updated_at: 1,
        };

        if (options.quality) {
            if (options.quality === 'thumbnail') {
                projection.url = '$processing.compressed_versions.url';
                projection['processing.compressed_versions'] = {
                    $filter: {
                        input: '$processing.compressed_versions',
                        as: 'version',
                        cond: { $eq: ['$$version.quality', 'low'] },
                    },
                };
            } else if (options.quality === 'display') {
                projection.url = '$processing.compressed_versions.url';
                projection['processing.compressed_versions'] = {
                    $filter: {
                        input: '$processing.compressed_versions',
                        as: 'version',
                        cond: { $eq: ['$$version.quality', 'medium'] },
                    },
                };
            }
            // 'full' uses the original url, so no change needed
        }

        pipeline.push({ $project: projection });

        const media = await Media.aggregate(pipeline);

        return {
            status: true,
            code: 200,
            message: 'Media retrieved successfully',
            data: media,
            error: null,
            other: null,
        };
    } catch (err: any) {
        console.error(`[getMediaByEventService] Error: ${err.message}`);
        return {
            status: false,
            code: 500,
            message: 'Failed to retrieve media',
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            },
            other: null,
        };
    }
};
/**
 * Get all media for a specific album
 */
export const getMediaByAlbumService = async (
    album_id: string
): Promise<ServiceResponse<any[]>> => {
    try {
        const media = await Media.find({ album_id: new mongoose.Types.ObjectId(album_id) })
            .sort({ created_at: -1 });

        return {
            status: true,
            code: 200,
            message: "Media retrieved successfully",
            data: media,
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to retrieve media",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Delete a media item and update user usage
 */
export const deleteMediaService = async (
    media_id: string,
    user_id: string
): Promise<ServiceResponse<any>> => {
    try {
        // Find the media to get its size before deletion
        const media = await Media.findById(media_id);

        if (!media) {
            return {
                status: false,
                code: 404,
                message: "Media not found",
                data: null,
                error: { message: "Media item does not exist or was already deleted" },
                other: null,
            };
        }

        // Check if the user is authorized to delete this media
        // This could be expanded to check if user is event owner or has admin permissions
        const isAuthorized = media.uploaded_by.toString() === user_id;

        if (!isAuthorized) {
            return {
                status: false,
                code: 403,
                message: "Not authorized",
                data: null,
                error: { message: "You do not have permission to delete this media" },
                other: null,
            };
        }

        // Get the media size or default to 0 if not recorded
        const mediaSizeMB = media.size_mb || 0;

        // Delete from imagekit if needed (this would require parsing the URL to get the file ID)
        // Example: const fileId = getFileIdFromUrl(media.url);
        // await imagekit.deleteFile(fileId);

        // Delete the media record
        await Media.findByIdAndDelete(media_id);

        // Update user usage metrics
        try {
            if (mediaSizeMB > 0) {
                await updateUsageForDelete(user_id, mediaSizeMB);
                logger.info(`Updated usage for user ${user_id} - Removed ${mediaSizeMB}MB`);
            }
        } catch (usageError) {
            logger.error(`Failed to update usage for user ${user_id}: ${usageError}`);
            // Don't fail the deletion if usage tracking fails
        }

        return {
            status: true,
            code: 200,
            message: "Media deleted successfully",
            data: { id: media_id },
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to delete media",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};
// services/media.service.ts

import fs from "fs/promises";
import mongoose from "mongoose";
import ImageKit from "imagekit";
import { Media, MediaCreationType } from "@models/media.model";
import { ServiceResponse } from "types/service.types";
import { updateUsageForUpload, updateUsageForDelete } from "@models/user-usage.model";
import { checkUserLimitsService } from "@services/user.service";
import { logger } from "@utils/logger";
import { validateGuestShareToken } from "./share-token.service";
import { Event } from "@models/event.model";

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
        // New options for status filtering and infinite scroll
        status?: 'approved' | 'pending' | 'rejected' | 'hidden' | 'auto_approved';
        cursor?: string; // For infinite scroll
        scrollType?: 'pagination' | 'infinite'; // Toggle between pagination and infinite scroll
    } = {},
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

        // Build base query
        const query: any = {
            event_id: new mongoose.Types.ObjectId(eventId)
        };

        // Handle status-based filtering (new approach)
        if (options.status) {
            switch (options.status) {
                case 'approved':
                    query['approval.status'] = { $in: ['approved', 'auto_approved'] };
                    break;
                case 'pending':
                    query['approval.status'] = 'pending';
                    break;
                case 'rejected':
                    query['approval.status'] = 'rejected';
                    break;
                case 'hidden':
                    query['approval.status'] = 'hidden';
                    break;
                case 'auto_approved':
                    query['approval.status'] = 'auto_approved';
                    break;
            }
        } else {
            // Legacy behavior - maintain backward compatibility
            if (options.includePending === false) {
                query['approval.status'] = { $in: ['approved', 'auto_approved'] };
            }
        }

        if (options.includeProcessing === false) {
            query['processing.status'] = 'completed';
        }

        // Handle cursor-based pagination for infinite scroll
        if (options.scrollType === 'infinite' && options.cursor) {
            try {
                const cursorDate = new Date(options.cursor);
                if (!isNaN(cursorDate.getTime())) {
                    query.created_at = { $lt: cursorDate };
                }
            } catch (cursorError) {
                console.warn('Invalid cursor provided:', options.cursor);
            }
        }

        if (options.since) {
            try {
                const sinceDate = new Date(options.since);
                if (isNaN(sinceDate.getTime())) {
                    throw new Error('Invalid date format');
                }
                // Merge with existing created_at filter if cursor exists
                if (query.created_at) {
                    query.created_at = { ...query.created_at, $gt: sinceDate };
                } else {
                    query.created_at = { $gt: sinceDate };
                }
            } catch (dateError) {
                console.warn('Invalid since date provided:', options.since);
            }
        }

        // Debug: Check total count without filters first
        const totalCount = await Media.countDocuments({
            event_id: new mongoose.Types.ObjectId(eventId)
        });

        // Check count with filters
        const filteredCount = await Media.countDocuments(query);

        if (filteredCount === 0) {
            return {
                status: true,
                code: 200,
                message: 'No media found for this event with the given filters',
                data: [],
                error: null,
                other: {
                    totalCount,
                    filteredCount: 0,
                    appliedFilters: {
                        includePending: options.includePending,
                        includeProcessing: options.includeProcessing,
                        since: options.since,
                        status: options.status,
                        scrollType: options.scrollType
                    }
                },
            };
        }

        // Handle pagination vs infinite scroll
        const limit = Math.max(1, Math.min(100, options.limit || 20));
        let mediaQuery = Media.find(query).sort({ created_at: -1 });

        if (options.scrollType === 'infinite') {
            // For infinite scroll, fetch one extra item to check if there's more
            mediaQuery = mediaQuery.limit(limit + 1);
        } else {
            // Traditional pagination
            const page = Math.max(1, options.page || 1);
            const skip = (page - 1) * limit;
            mediaQuery = mediaQuery.skip(skip).limit(limit);
        }

        let media = await mediaQuery.lean().exec();

        // Handle infinite scroll response
        let hasMore = false;
        let nextCursor = null;

        if (options.scrollType === 'infinite') {
            hasMore = media.length > limit;
            if (hasMore) {
                media = media.slice(0, -1); // Remove the extra item
            }
            if (media.length > 0) {
                nextCursor = media[media.length - 1].created_at;
            }
        }

        // Post-process for quality requirements
        if (options.quality && options.quality !== 'full' && media.length > 0) {
            media = media.map(item => {
                const processedItem = { ...item };

                if (options.quality === 'thumbnail') {
                    const thumbnail = item.processing?.compressed_versions?.find(
                        (v: any) => v.quality === 'low'
                    );
                    if (thumbnail?.url) {
                        processedItem.url = thumbnail.url;
                    }
                } else if (options.quality === 'display') {
                    const display = item.processing?.compressed_versions?.find(
                        (v: any) => v.quality === 'medium'
                    );
                    if (display?.url) {
                        processedItem.url = display.url;
                    }
                }

                return processedItem;
            });
        }

        // Prepare response based on scroll type
        if (options.scrollType === 'infinite') {
            return {
                status: true,
                code: 200,
                message: 'Media retrieved successfully',
                data: media,
                error: null,
                other: {
                    infinite: {
                        hasMore,
                        nextCursor,
                        count: media.length
                    },
                    appliedFilters: {
                        includePending: options.includePending,
                        includeProcessing: options.includeProcessing,
                        quality: options.quality,
                        since: options.since,
                        status: options.status,
                        scrollType: options.scrollType
                    }
                },
            };
        } else {
            // Traditional pagination response
            const page = Math.max(1, options.page || 1);
            const totalPages = Math.ceil(filteredCount / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                status: true,
                code: 200,
                message: 'Media retrieved successfully',
                data: media,
                error: null,
                other: {
                    pagination: {
                        page,
                        limit,
                        totalCount: filteredCount,
                        totalPages,
                        hasNext,
                        hasPrev
                    },
                    appliedFilters: {
                        includePending: options.includePending,
                        includeProcessing: options.includeProcessing,
                        quality: options.quality,
                        since: options.since,
                        status: options.status,
                        scrollType: options.scrollType
                    }
                },
            };
        }

    } catch (err: any) {
        console.error(`[getMediaByEventService] Error:`, {
            message: err.message,
            stack: err.stack,
            eventId,
            options
        });

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

export const updateMediaStatusService = async (
    mediaId: string,
    newStatus: 'approved' | 'pending' | 'rejected' | 'hidden' | 'auto_approved',
    options: {
        adminId?: string;
        reason?: string;
        hideReason?: string;
        bulkUpdate?: boolean;
        eventId?: string;
    } = {}
): Promise<ServiceResponse<any>> => {
    try {
        console.log(newStatus, 'newStatusnewStatusnewStatus')
        // Validate mediaId
        if (!mongoose.Types.ObjectId.isValid(mediaId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'Invalid ObjectId format' },
                other: null,
            };
        }

        // Find the media item first
        const media = await Media.findById(mediaId);
        if (!media) {
            return {
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media with the provided ID does not exist' },
                other: null,
            };
        }

        // Store previous status for response/logging
        const previousStatus = media.approval.status;

        // Prepare update object
        const updateObj: any = {
            updated_at: new Date()
        };

        // Handle different status changes
        switch (newStatus) {
            case 'approved':
                updateObj['approval.status'] = 'approved';
                updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
                updateObj['approval.approved_at'] = new Date();
                updateObj['approval.rejection_reason'] = '';
                updateObj['approval.auto_approval_reason'] = null;
                break;

            case 'auto_approved':
                updateObj['approval.status'] = 'auto_approved';
                updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
                updateObj['approval.approved_at'] = new Date();
                updateObj['approval.rejection_reason'] = '';
                updateObj['approval.auto_approval_reason'] = 'admin_action';
                break;

            case 'pending':
                updateObj['approval.status'] = 'pending';
                updateObj['approval.approved_by'] = null;
                updateObj['approval.approved_at'] = null;
                updateObj['approval.rejection_reason'] = '';
                updateObj['approval.auto_approval_reason'] = null;
                break;

            case 'rejected':
                updateObj['approval.status'] = 'rejected';
                updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
                updateObj['approval.approved_at'] = null;
                updateObj['approval.rejection_reason'] = options.reason || 'No reason provided';
                updateObj['approval.auto_approval_reason'] = null;
                break;

            case 'hidden':
                updateObj['approval.status'] = 'hidden';
                updateObj['content_flags.inappropriate'] = true;
                updateObj['approval.rejection_reason'] = options.hideReason || 'Content hidden by admin';
                if (options.adminId) {
                    updateObj['approval.approved_by'] = new mongoose.Types.ObjectId(options.adminId);
                }
                break;

            default:
                return {
                    status: false,
                    code: 400,
                    message: 'Invalid status provided',
                    data: null,
                    error: { message: 'Status must be one of: approved, pending, rejected, hidden, auto_approved' },
                    other: null,
                };
        }

        console.log('Updating media status:', {
            mediaId,
            previousStatus,
            newStatus,
            updateObj
        });

        // Update the media
        const updatedMedia = await Media.findByIdAndUpdate(
            mediaId,
            updateObj,
            {
                new: true,
                runValidators: true,
                lean: true
            }
        );

        if (!updatedMedia) {
            return {
                status: false,
                code: 500,
                message: 'Failed to update media status',
                data: null,
                error: { message: 'Update operation failed' },
                other: null,
            };
        }

        console.log('Media status updated successfully:', {
            mediaId,
            previousStatus,
            newStatus: updatedMedia.approval.status
        });

        return {
            status: true,
            code: 200,
            message: 'Media status updated successfully',
            data: updatedMedia,
            error: null,
            other: {
                previousStatus,
                newStatus: updatedMedia.approval.status,
                updatedAt: updatedMedia.updated_at,
                updatedBy: options.adminId || 'system'
            },
        };

    } catch (err: any) {
        console.error(`[updateMediaStatusService] Error:`, {
            message: err.message,
            stack: err.stack,
            mediaId,
            newStatus,
            options
        });

        return {
            status: false,
            code: 500,
            message: 'Failed to update media status',
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            },
            other: null,
        };
    }
};

// NEW: Bulk status update service
export const bulkUpdateMediaStatusService = async (
    eventId: string,
    mediaIds: string[],
    newStatus: 'approved' | 'pending' | 'rejected' | 'hidden' | 'auto_approved',
    options: {
        adminId?: string;
        reason?: string;
        hideReason?: string;
    } = {}
): Promise<ServiceResponse<any>> => {
    try {
        // Validate eventId
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

        // Validate mediaIds
        const validMediaIds = mediaIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validMediaIds.length === 0) {
            return {
                status: false,
                code: 400,
                message: 'No valid media IDs provided',
                data: null,
                error: { message: 'At least one valid media ID is required' },
                other: null,
            };
        }

        // Prepare update object (similar to single update)
        const updateObj: any = {
            updated_at: new Date()
        };

        switch (newStatus) {
            case 'approved':
                updateObj['approval.status'] = 'approved';
                updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
                updateObj['approval.approved_at'] = new Date();
                updateObj['approval.rejection_reason'] = '';
                break;

            case 'rejected':
                updateObj['approval.status'] = 'rejected';
                updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
                updateObj['approval.approved_at'] = null;
                updateObj['approval.rejection_reason'] = options.reason || 'Bulk rejection';
                break;

            case 'hidden':
                updateObj['approval.status'] = 'hidden';
                updateObj['content_flags.inappropriate'] = true;
                updateObj['approval.rejection_reason'] = options.hideReason || 'Bulk hidden by admin';
                break;

            case 'pending':
                updateObj['approval.status'] = 'pending';
                updateObj['approval.approved_by'] = null;
                updateObj['approval.approved_at'] = null;
                updateObj['approval.rejection_reason'] = '';
                break;

            // Add other cases as needed
        }

        // Perform bulk update
        const result = await Media.updateMany(
            {
                _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            updateObj
        );

        console.log('Bulk update completed:', {
            eventId,
            mediaCount: validMediaIds.length,
            modifiedCount: result.modifiedCount,
            newStatus
        });

        return {
            status: true,
            code: 200,
            message: `Successfully updated ${result.modifiedCount} media items`,
            data: {
                modifiedCount: result.modifiedCount,
                requestedCount: validMediaIds.length
            },
            error: null,
            other: {
                newStatus,
                updatedBy: options.adminId || 'system',
                updatedAt: new Date()
            },
        };

    } catch (err: any) {
        console.error(`[bulkUpdateMediaStatusService] Error:`, {
            message: err.message,
            eventId,
            mediaIds,
            newStatus
        });

        return {
            status: false,
            code: 500,
            message: 'Failed to bulk update media status',
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
 * Delete a media item and update user usage
 */
export const deleteMediaService = async (
    media_id: string,
    user_id: string
): Promise<ServiceResponse<any>> => {
    try {
        logger.info(`Attempting to delete media ${media_id} for admin user ${user_id}`);

        // Validate inputs
        if (!media_id || !user_id) {
            logger.error(`Invalid inputs - media_id: ${media_id}, user_id: ${user_id}`);
            return {
                status: false,
                code: 400,
                message: "Invalid media ID or user ID",
                data: null,
                error: { message: "Media ID and User ID are required" },
                other: null,
            };
        }

        // Find the media to get its size before deletion
        logger.info(`Finding media with ID: ${media_id}`);
        const media = await Media.findById(media_id);

        if (!media) {
            logger.warn(`Media not found: ${media_id}`);
            return {
                status: false,
                code: 404,
                message: "Media not found",
                data: null,
                error: { message: "Media item does not exist or was already deleted" },
                other: null,
            };
        }

        logger.info(`Media found: ${media._id}`);

        // Get the media size or default to 0 if not recorded
        const mediaSizeMB = media.size_mb || 0;
        logger.info(`Media size: ${mediaSizeMB}MB`);

        // Delete from imagekit if needed (this would require parsing the URL to get the file ID)
        // Example: const fileId = getFileIdFromUrl(media.url);
        // await imagekit.deleteFile(fileId);

        // Delete the media record
        logger.info(`Deleting media record: ${media_id}`);
        await Media.findByIdAndDelete(media_id);
        logger.info(`Media record deleted successfully: ${media_id}`);

        // Update user usage metrics (if you want to update the original uploader's usage)
        try {
            if (mediaSizeMB > 0 && media.uploaded_by) {
                logger.info(`Updating usage for original uploader ${media.uploaded_by} - Removing ${mediaSizeMB}MB`);
                await updateUsageForDelete(media.uploaded_by.toString(), mediaSizeMB);
                logger.info(`Updated usage for user ${media.uploaded_by} - Removed ${mediaSizeMB}MB`);
            }
        } catch (usageError: any) {
            logger.error(`Failed to update usage for user ${media.uploaded_by}:`, usageError);
            // Don't fail the deletion if usage tracking fails
        }

        logger.info(`Media deletion completed successfully: ${media_id}`);
        return {
            status: true,
            code: 200,
            message: "Media deleted successfully",
            data: { id: media_id },
            error: null,
            other: null,
        };
    } catch (err: any) {
        logger.error(`Error in deleteMediaService:`, {
            error: err.message,
            stack: err.stack,
            media_id,
            user_id
        });

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

export const getGuestMediaService = async (
    shareToken: string,
    userEmail?: string,
    authToken?: string,
    options: any = {}
): Promise<ServiceResponse<any>> => {
    try {
        // Validate the share token first
        const validation = await validateGuestShareToken(shareToken, userEmail, authToken);

        if (!validation.valid) {
            return {
                status: false,
                code: validation.requiresAuth ? 401 : 403,
                message: validation.reason || "Access denied",
                data: null,
                error: { message: validation.reason },
                other: {
                    requires_auth: validation.requiresAuth || false,
                    visibility: validation.visibility
                }
            };
        }

        // Now get media using the validated event_id
        const mediaOptions = {
            ...options,
            // For guests, only show approved content
            status: 'approved',
            // DON'T set includeProcessing: false - let it default to include all processing states
            // DON'T set includePending: false - status: 'approved' already handles this
        };

        // Use your existing getMediaByEventService
        const mediaResponse = await getMediaByEventService(validation.event_id!, mediaOptions);

        if (mediaResponse.status) {
            // Add guest context to the response
            mediaResponse.other = {
                ...mediaResponse.other, // Keep existing pagination/infinite scroll data
                guest_access: true,
                share_token: shareToken,
                permissions: validation.permissions,
                event_data: validation.eventData,
                visibility: validation.visibility
            };
        }

        return mediaResponse;

    } catch (error) {
        console.error('Error in getGuestMediaService:', error);
        return {
            status: false,
            code: 500,
            message: "Failed to get guest media",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};
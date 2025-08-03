// services/media.service.ts - Enhanced media service layer

import mongoose from 'mongoose';
import ImageKit from 'imagekit';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { Album } from '@models/album.model';
import { transformMediaForResponse } from '@utils/file.util';

// ImageKit configuration
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

// Service response interface
interface ServiceResponse<T> {
    status: boolean;
    code: number;
    message: string;
    data: T | null;
    error: any;
    other?: any;
}

// Query options interface
interface MediaQueryOptions {
    includeProcessing?: boolean;
    includePending?: boolean;
    page?: number;
    limit?: number;
    since?: string;
    status?: string;
    cursor?: string;
    scrollType?: 'pagination' | 'infinite';
    quality?: 'small' | 'medium' | 'large' | 'original' | 'thumbnail' | 'display' | 'full';
    format?: 'webp' | 'jpeg' | 'auto';
    context?: 'mobile' | 'desktop' | 'lightbox';
}

/**
 * Upload cover image service
 */
export const uploadCoverImageService = async (
    file: Express.Multer.File,
    folder: string = 'covers'
): Promise<ServiceResponse<any>> => {
    try {
        const fs = await import('fs/promises');
        const fileBuffer = await fs.readFile(file.path);

        const uploadResult = await imagekit.upload({
            file: fileBuffer,
            fileName: `cover_${Date.now()}_${file.originalname}`,
            folder: `/${folder}`,
            transformation: {
                pre: 'q_auto,f_auto,w_1920,h_1080,c_limit' // Optimize and limit size
            }
        });

        // Clean up temp file
        await fs.unlink(file.path).catch(() => { });

        logger.info('Cover image uploaded successfully', {
            filename: file.originalname,
            url: uploadResult.url,
            fileId: uploadResult.fileId
        });

        return {
            status: true,
            code: 200,
            message: 'Cover image uploaded successfully',
            data: {
                url: uploadResult.url,
                fileId: uploadResult.fileId,
                originalName: file.originalname,
                size: file.size
            },
            error: null,
            other: {
                folder,
                imagekit_response: uploadResult
            }
        };

    } catch (error: any) {
        logger.error('Cover image upload failed:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to upload cover image',
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

/**
 * Get media by event with enhanced filtering and optimization
 */
export const getMediaByEventService = async (
    eventId: string,
    options: MediaQueryOptions,
    userAgent?: string
): Promise<ServiceResponse<any[]>> => {
    try {
        // Validate event_id (keeping from working version)
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

        // Build base query (same as working version)
        const query: any = {
            event_id: new mongoose.Types.ObjectId(eventId)
        };

        // Handle status filtering - using the working logic from old version
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
            // Default behavior - include approved and auto_approved
            const statusFilters = ['approved', 'auto_approved'];

            if (options.includePending) {
                statusFilters.push('pending');
            }

            query['approval.status'] = { $in: statusFilters };
        }

        // Handle processing status
        if (options.includeProcessing === false) {
            query['processing.status'] = 'completed';
        }

        // Apply date filter - FIXED: use correct field name
        if (options.since) {
            try {
                const sinceDate = new Date(options.since);
                if (isNaN(sinceDate.getTime())) {
                    throw new Error('Invalid date format');
                }
                query.created_at = { $gte: sinceDate }; // FIXED: was $gte instead of $gt
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

        console.log('Debug info:', {
            eventId,
            totalCount,
            filteredCount,
            query: JSON.stringify(query, null, 2)
        });

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
                        status: options.status
                    }
                },
            };
        }

        // Set pagination
        const limit = Math.min(options.limit || 20, 100);
        const page = options.page || 1;
        const skip = (page - 1) * limit;

        // SIMPLIFIED: Use direct query instead of aggregation for debugging
        let mediaQuery = Media.find(query)
            .sort({ created_at: -1 }) // FIXED: Use correct field name
            .skip(skip)
            .limit(limit)
            .lean(); // Keep lean for performance

        let mediaItems = await mediaQuery.exec();

        console.log('Raw media items found:', mediaItems.length);
        console.log('First item sample:', mediaItems[0] ? {
            id: mediaItems[0]._id,
            url: mediaItems[0].url,
            approval_status: mediaItems[0].approval?.status,
            processing_status: mediaItems[0].processing?.status,
            created_at: mediaItems[0].created_at
        } : 'No items');

        // Apply image optimization
        const optimizedMedia = transformMediaForResponse(mediaItems, {
            quality: options.quality || 'medium',
            format: options.format || 'auto',
            context: options.context || 'desktop',
            includeVariants: true
        }, userAgent);

        // Calculate pagination info
        const totalPages = Math.ceil(filteredCount / limit);

        return {
            status: true,
            code: 200,
            message: 'Media retrieved successfully',
            data: optimizedMedia,
            error: null,
            other: {
                pagination: {
                    page,
                    limit,
                    totalCount: filteredCount,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                },
                debug: {
                    totalInEvent: totalCount,
                    afterFilters: filteredCount,
                    returned: optimizedMedia.length
                },
                optimization_settings: {
                    quality: options.quality || 'medium',
                    format: options.format || 'auto',
                    context: options.context || 'desktop',
                    webp_supported: userAgent ?
                        /Chrome|Firefox|Edge|Opera/.test(userAgent) && !/Safari/.test(userAgent) :
                        true
                },
                appliedFilters: {
                    includePending: options.includePending,
                    includeProcessing: options.includeProcessing,
                    quality: options.quality,
                    since: options.since,
                    status: options.status
                }
            }
        };

    } catch (error: any) {
        console.error('[getMediaByEventService] Error:', {
            message: error.message,
            stack: error.stack,
            eventId,
            options
        });

        return {
            status: false,
            code: 500,
            message: 'Failed to retrieve media',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    }
};
/**
 * Get media by album with enhanced filtering and optimization
 */
export const getMediaByAlbumService = async (
    albumId: string,
    options: MediaQueryOptions,
    userAgent?: string
): Promise<ServiceResponse<any>> => {
    try {
        // Validate albumId
        if (!albumId || !mongoose.Types.ObjectId.isValid(albumId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid album ID',
                data: null,
                error: { message: 'A valid album ID is required' },
                other: null
            };
        }

        // Build query
        const query: any = {
            album_id: new mongoose.Types.ObjectId(albumId)
        };

        // Apply status filters
        const statusFilters = [];
        statusFilters.push('approved');

        if (options.includeProcessing) {
            statusFilters.push('processing');
        }

        if (options.includePending) {
            statusFilters.push('pending');
        }

        if (options.status) {
            query['approval.status'] = options.status;
        } else {
            query['approval.status'] = { $in: statusFilters };
        }

        // Apply date filter
        if (options.since) {
            query.createdAt = { $gte: new Date(options.since) };
        }

        // Set pagination
        const limit = Math.min(options.limit || 20, 100);
        const currentPage = options.page || 1; // Fix: Rename to avoid redeclaration
        const skip = (currentPage - 1) * limit;

        // Get media with pagination
        const mediaItems = await Media.find(query)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const totalCount = await Media.countDocuments(query);

        // Optimize images for response using the utility function
        const optimizedMedia = transformMediaForResponse(mediaItems, {
            quality: options.quality,
            format: options.format,
            context: options.context,
            includeVariants: true
        }, userAgent);

        // Calculate pagination info
        const totalPages = Math.ceil(totalCount / limit);

        return {
            status: true,
            code: 200,
            message: 'Media retrieved successfully',
            data: optimizedMedia,
            error: null,
            other: {
                pagination: {
                    page: currentPage, // Fix: Use renamed variable
                    limit,
                    totalCount,
                    totalPages,
                    hasNext: currentPage < totalPages,
                    hasPrev: currentPage > 1
                },
                optimization_settings: {
                    quality: options.quality || 'medium',
                    format: options.format || 'auto',
                    context: options.context || 'desktop',
                    webp_supported: userAgent ?
                        /Chrome|Firefox|Edge|Opera/.test(userAgent) && !/Safari/.test(userAgent) :
                        true
                }
            }
        };

    } catch (error: any) {
        logger.error('Error in getMediaByAlbumService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to retrieve media',
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

/**
 * Update single media status
 */
export const updateMediaStatusService = async (
    mediaId: string,
    status: string,
    options: {
        adminId?: string;
        reason?: string;
        hideReason?: string;
    }
): Promise<ServiceResponse<any>> => {
    try {
        // Validate mediaId
        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'A valid media ID is required' },
                other: null
            };
        }

        // Find the media item
        const media = await Media.findById(mediaId);
        if (!media) {
            return {
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media with the provided ID does not exist' },
                other: null
            };
        }

        const previousStatus = media.approval?.status;

        // Update the media status
        const updateObj: any = {
            'approval.status': status,
            updated_at: new Date()
        };

        if (status === 'approved' || status === 'auto_approved') {
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
            updateObj['approval.approved_at'] = new Date();
            updateObj['approval.rejection_reason'] = '';
        } else if (status === 'rejected') {
            updateObj['approval.rejection_reason'] = options.reason || 'Rejected by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        } else if (status === 'hidden') {
            updateObj['approval.rejection_reason'] = options.hideReason || 'Hidden by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        }

        const updatedMedia = await Media.findByIdAndUpdate(
            mediaId,
            updateObj,
            { new: true, lean: true }
        );

        logger.info('Media status updated:', {
            mediaId,
            previousStatus,
            newStatus: status,
            adminId: options.adminId
        });

        return {
            status: true,
            code: 200,
            message: 'Media status updated successfully',
            data: updatedMedia,
            error: null,
            other: {
                previousStatus,
                newStatus: status
            }
        };

    } catch (error: any) {
        logger.error('Error in updateMediaStatusService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to update media status',
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

/**
 * Bulk update media status
 */
export const bulkUpdateMediaStatusService = async (
    eventId: string,
    mediaIds: string[],
    status: string,
    options: {
        adminId?: string;
        reason?: string;
        hideReason?: string;
    }
): Promise<ServiceResponse<any>> => {
    try {
        // Validate eventId
        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'A valid event ID is required' },
                other: null
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
                other: null
            };
        }

        // Prepare update object
        const updateObj: any = {
            'approval.status': status,
            updated_at: new Date()
        };

        if (status === 'approved' || status === 'auto_approved') {
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
            updateObj['approval.approved_at'] = new Date();
            updateObj['approval.rejection_reason'] = '';
        } else if (status === 'rejected') {
            updateObj['approval.rejection_reason'] = options.reason || 'Bulk rejected by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        } else if (status === 'hidden') {
            updateObj['approval.rejection_reason'] = options.hideReason || 'Bulk hidden by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        }

        // Perform bulk update
        const result = await Media.updateMany(
            {
                _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            updateObj
        );

        logger.info('Bulk media status update completed:', {
            eventId,
            mediaCount: validMediaIds.length,
            modifiedCount: result.modifiedCount,
            status
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
                newStatus: status,
                updatedBy: options.adminId || 'system'
            }
        };

    } catch (error: any) {
        logger.error('Error in bulkUpdateMediaStatusService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to bulk update media status',
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

/**
 * Delete a media item
 */
export const deleteMediaService = async (
    mediaId: string,
    userId: string
): Promise<ServiceResponse<any>> => {
    try {
        // Validate inputs
        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'A valid media ID is required' },
                other: null
            };
        }

        // Find the media item
        const media = await Media.findById(mediaId);
        if (!media) {
            return {
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media item does not exist' },
                other: null
            };
        }

        // Delete the media record
        await Media.findByIdAndDelete(mediaId);

        logger.info('Media deleted successfully:', {
            mediaId,
            deletedBy: userId
        });

        return {
            status: true,
            code: 200,
            message: 'Media deleted successfully',
            data: { id: mediaId },
            error: null,
            other: null
        };

    } catch (error: any) {
        logger.error('Error in deleteMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to delete media',
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

/**
 * Get guest media with enhanced variant support
 */
export const getGuestMediaService = async (
    shareToken: string,
    userEmail?: string,
    authToken?: string,
    options: any = {}
): Promise<any> => {
    try {
        // OPTIMIZED: Cache-friendly event lookup
        const event = await Event.findOne({ share_token: shareToken })
            .select('_id title permissions share_token')
            .lean();

        if (!event) {
            return {
                status: false,
                code: 404,
                message: 'Invalid share token',
                data: null,
                error: { message: 'Event not found' },
                other: null
            };
        }

        // QUICK permission check
        if (!event.permissions?.can_view) {
            return {
                status: false,
                code: 403,
                message: 'Viewing not allowed',
                data: null,
                error: { message: 'This event does not allow viewing photos' },
                other: null
            };
        }

        // OPTIMIZED: Guest-only options for speed
        const guestOptions = {
            ...options,
            includeProcessing: false,
            includePending: false,
            status: 'approved', // ONLY approved content
            quality: 'thumbnail', // ALWAYS thumbnail
            format: 'jpeg' // FASTER than auto
        };

        // Use optimized service
        const mediaResponse = await getMediaByEventService(
            event._id.toString(),
            guestOptions
        );

        if (mediaResponse.status) {
            // MINIMAL additional data
            mediaResponse.other = {
                ...mediaResponse.other,
                guest_access: true,
                event_info: {
                    id: event._id,
                    title: event.title
                }
            };
        }

        return mediaResponse;

    } catch (error: any) {
        logger.error('Error in getGuestMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to get guest media',
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};
// services/media.service.ts - Enhanced media service layer

import mongoose from 'mongoose';
import ImageKit from 'imagekit';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { Album } from '@models/album.model';
import { transformMediaForResponse } from '@utils/file.util';
import mediaWebSocketService from './mediaWebSocket.service';

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
export interface MediaQueryOptions {
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
        adminName?: string; // Add this for better WebSocket info
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

        // Find the media item with event_id populated for WebSocket
        const media = await Media.findById(mediaId).select(
            'approval event_id url image_variants original_filename type'
        );

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
        const eventId = media.event_id.toString(); // FIX: Get eventId from media

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

        // 🚀 NEW: Broadcast status change via WebSocket to both admin and guests
        try {
            // Your existing WebSocket service emitStatusUpdate already handles this correctly
            // But let's also broadcast stats update
            mediaWebSocketService.broadcastMediaStats(eventId);

            logger.info('📤 WebSocket status update and stats broadcasted', {
                mediaId: mediaId.substring(0, 8) + '...',
                previousStatus,
                newStatus: status,
                eventId: eventId.substring(0, 8) + '...'
            });
        } catch (wsError) {
            logger.error('❌ Failed to broadcast via WebSocket:', wsError);
            // Don't fail the service if WebSocket fails
        }

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
                newStatus: status,
                websocketBroadcasted: true // Indicate WebSocket was attempted
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
        adminName?: string; // Add this for better WebSocket info
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

        // 🚀 NEW: Broadcast stats update after bulk change
        try {
            mediaWebSocketService.broadcastMediaStats(eventId);

            logger.info(`📤 Bulk WebSocket stats update broadcasted for ${result.modifiedCount} items`);
        } catch (wsError) {
            logger.error('❌ Failed to broadcast bulk update via WebSocket:', wsError);
            // Don't fail the service if WebSocket fails
        }

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
                updatedBy: options.adminId || 'system',
                websocketBroadcasted: true // Indicate WebSocket was attempted
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
    userId: string,
    options?: {
        adminName?: string; // For better WebSocket info
        reason?: string; // Reason for deletion
    }
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

        // 🚀 NEW: Find the media item BEFORE deletion to get event info
        const media = await Media.findById(mediaId).select(
            'event_id url original_filename type approval.status'
        );

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

        const eventId = media.event_id.toString();
        const wasVisible = ['approved', 'auto_approved'].includes(media.approval?.status || '');

        // Delete the media record
        await Media.findByIdAndDelete(mediaId);

        // 🚀 NEW: Broadcast deletion to guests if the image was visible to them
        if (wasVisible) {
            try {
                mediaWebSocketService.broadcastMediaRemoved({
                    mediaId,
                    eventId,
                    reason: options?.reason || 'deleted_by_admin',
                    adminName: options?.adminName
                });

                // Also update stats since total count changed
                mediaWebSocketService.broadcastMediaStats(eventId);

                logger.info('📤 Media deletion broadcasted to guests', {
                    mediaId: mediaId.substring(0, 8) + '...',
                    eventId: eventId.substring(0, 8) + '...',
                    wasVisible
                });
            } catch (wsError) {
                logger.error('❌ Failed to broadcast media deletion via WebSocket:', wsError);
                // Don't fail the deletion if WebSocket fails
            }
        }

        logger.info('Media deleted successfully:', {
            mediaId,
            deletedBy: userId,
            eventId,
            wasVisibleToGuests: wasVisible
        });

        return {
            status: true,
            code: 200,
            message: 'Media deleted successfully',
            data: {
                id: mediaId,
                wasVisibleToGuests: wasVisible
            },
            error: null,
            other: {
                websocketBroadcasted: wasVisible // Indicate if guests were notified
            }
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
        logger.info(`🔍 Guest media request for token: ${shareToken.substring(0, 8)}...`, {
            page: options.page,
            limit: options.limit,
            quality: options.quality
        });

        // Find event by share token
        const event = await Event.findOne({
            share_token: shareToken
        }).select('_id title permissions share_settings').lean();

        if (!event) {
            logger.warn(`❌ Event not found for share token: ${shareToken}`);
            return {
                status: false,
                code: 404,
                message: 'Invalid share token',
                data: null,
                error: { message: 'Event not found' },
                other: null
            };
        }

        logger.info(`✅ Event found: ${event._id}`, {
            title: event.title,
            canView: event.permissions?.can_view
        });

        // Check if viewing is allowed
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

        // Check if sharing is active
        if (!event.share_settings?.is_active) {
            return {
                status: false,
                code: 403,
                message: 'Sharing disabled',
                data: null,
                error: { message: 'Photo sharing is currently disabled for this event' },
                other: null
            };
        }

        // 🔥 DIRECT DATABASE QUERY - Only approved photos for guests
        const query = {
            event_id: event._id,
            'approval.status': { $in: ['approved', 'auto_approved'] }, // STRICT filtering
            type: 'image' // Only images for now
        };

        logger.debug('📋 Database query for guest media:', query);

        // Get total count
        const totalCount = await Media.countDocuments(query);

        // Calculate pagination
        const page = parseInt(options.page) || 1;
        const limit = Math.min(parseInt(options.limit) || 20, 30);
        const skip = (page - 1) * limit;

        // Get media with projection for performance
        const mediaItems = await Media.find(query)
            .select({
                _id: 1,
                url: 1,
                type: 1,
                original_filename: 1,
                size_mb: 1,
                format: 1,
                'metadata.width': 1,
                'metadata.height': 1,
                'metadata.aspect_ratio': 1,
                'approval.status': 1,
                'approval.approved_at': 1,
                'image_variants': 1, // Include variants for optimization
                created_at: 1,
                updated_at: 1
            })
            .sort({ created_at: -1 }) // Newest first
            .skip(skip)
            .limit(limit)
            .lean();

        logger.info(`✅ Guest media query results:`, {
            eventId: event._id,
            totalCount,
            returnedCount: mediaItems.length,
            page,
            limit,
            approvedOnly: true
        });

        // Transform for guest consumption
        const transformedMedia = mediaItems.map(item => {
            // Get optimized URL based on quality
            const optimizedUrl = getOptimizedUrlForGuest(item, options.quality);

            return {
                _id: item._id,
                url: optimizedUrl, // Use optimized URL
                original_url: item.url, // Keep original for download
                type: item.type,
                original_filename: item.original_filename,
                metadata: {
                    width: item.metadata?.width,
                    height: item.metadata?.height,
                    aspect_ratio: item.metadata?.aspect_ratio
                },
                approval: {
                    status: item.approval?.status,
                    approved_at: item.approval?.approved_at
                },
                created_at: item.created_at,
                updated_at: item.updated_at
            };
        });

        // Pagination info
        const hasNext = (page * limit) < totalCount;
        const pagination = {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNext,
            hasPrev: page > 1,
            totalCount // Add for frontend
        };

        logger.info(`📊 Pagination info:`, pagination);

        return {
            status: true,
            code: 200,
            message: 'Guest media retrieved successfully',
            data: transformedMedia,
            error: null,
            other: {
                eventId: event._id,
                eventTitle: event.title,
                pagination,
                guest_access: true,
                share_settings: {
                    can_view: true,
                    can_download: event.permissions?.can_download || false
                }
            }
        };

    } catch (error: any) {
        logger.error('❌ Error in getGuestMediaService:', error);
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

// Helper function to get optimized URL for guests
const getOptimizedUrlForGuest = (media: any, quality: string = 'thumbnail'): string => {
    // If no variants, return original
    if (!media.image_variants) {
        return media.url;
    }

    const variants = media.image_variants;

    try {
        switch (quality) {
            case 'thumbnail':
                return variants.small?.jpeg?.url ||
                    variants.small?.webp?.url ||
                    variants.medium?.jpeg?.url ||
                    media.url;
            case 'display':
                return variants.medium?.jpeg?.url ||
                    variants.medium?.webp?.url ||
                    variants.large?.jpeg?.url ||
                    media.url;
            case 'full':
                return variants.large?.jpeg?.url ||
                    variants.large?.webp?.url ||
                    media.url;
            default:
                return variants.small?.jpeg?.url || media.url;
        }
    } catch (error) {
        console.warn('Error getting optimized URL, falling back to original:', error);
        return media.url;
    }
};
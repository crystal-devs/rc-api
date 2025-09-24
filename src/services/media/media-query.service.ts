// services/media/media-query.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { transformMediaForResponse } from '@utils/file.util';
import type { ServiceResponse, MediaQueryOptions, MediaItem } from './media.types';

export const buildMediaQuery = (
    baseId: string,
    field: 'event_id' | 'album_id',
    options: MediaQueryOptions
): any => {
    const query: any = {
        [field]: new mongoose.Types.ObjectId(baseId)
    };

    // Handle status filtering
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

    // Apply date filter
    if (options.since) {
        try {
            const sinceDate = new Date(options.since);
            if (!isNaN(sinceDate.getTime())) {
                query.created_at = { $gte: sinceDate };
            }
        } catch (dateError) {
            logger.warn('Invalid since date provided:', options.since);
        }
    }

    return query;
};

export const getMediaByEventService = async (
    eventId: string,
    options: MediaQueryOptions,
    userAgent?: string
): Promise<ServiceResponse<MediaItem[]>> => {
    try {
        // Validate event_id
        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'Invalid ObjectId format' }
            };
        }

        // Build query
        const query = buildMediaQuery(eventId, 'event_id', options);

        // Debug info
        const totalCount = await Media.countDocuments({
            event_id: new mongoose.Types.ObjectId(eventId)
        });
        const filteredCount = await Media.countDocuments(query);

        logger.info('Media query debug:', {
            eventId,
            totalCount,
            filteredCount,
            hasFilters: Object.keys(query).length > 1
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
                    appliedFilters: options
                }
            };
        }

        // Set pagination
        const limit = Math.min(options.limit || 20, 100);
        const page = options.page || 1;
        const skip = (page - 1) * limit;

        // Execute query
        const mediaItems = await Media.find(query)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

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
                    context: options.context || 'desktop'
                },
                appliedFilters: options
            }
        };

    } catch (error: any) {
        logger.error('[getMediaByEventService] Error:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to retrieve media',
            data: null,
            error: { message: error.message }
        };
    }
};

export const getMediaByAlbumService = async (
    albumId: string,
    options: MediaQueryOptions,
    userAgent?: string
): Promise<ServiceResponse<MediaItem[]>> => {
    try {
        // Validate albumId
        if (!albumId || !mongoose.Types.ObjectId.isValid(albumId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid album ID',
                data: null,
                error: { message: 'A valid album ID is required' }
            };
        }

        // Build query
        const query = buildMediaQuery(albumId, 'album_id', options);

        // Set pagination
        const limit = Math.min(options.limit || 20, 100);
        const page = options.page || 1;
        const skip = (page - 1) * limit;

        // Get media with pagination
        const mediaItems = await Media.find(query)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const totalCount = await Media.countDocuments(query);

        // Optimize images for response
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
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                },
                optimization_settings: {
                    quality: options.quality || 'medium',
                    format: options.format || 'auto',
                    context: options.context || 'desktop'
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
            error: { message: error.message }
        };
    }
};

export const getGuestMediaService = async (
    shareToken: string,
    userEmail?: string,
    authToken?: string,
    options: any = {}
): Promise<ServiceResponse<MediaItem[]>> => {
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
                error: { message: 'Event not found' }
            };
        }

        // Check permissions
        if (!event.permissions?.can_view) {
            return {
                status: false,
                code: 403,
                message: 'Viewing not allowed',
                data: null,
                error: { message: 'This event does not allow viewing photos' }
            };
        }

        if (!event.share_settings?.is_active) {
            return {
                status: false,
                code: 403,
                message: 'Sharing disabled',
                data: null,
                error: { message: 'Photo sharing is currently disabled for this event' }
            };
        }

        // Query only approved photos for guests
        const query = {
            event_id: event._id,
            'approval.status': { $in: ['approved', 'auto_approved'] },
            type: 'image'
        };

        // Get total count
        const totalCount = await Media.countDocuments(query);

        // Calculate pagination
        const page = parseInt(options.page as string) || 1;
        const limit = Math.min(parseInt(options.limit as string) || 20, 30);
        const skip = (page - 1) * limit;

        // Get media items (same fields as admin service)
        const mediaItems = await Media.find(query)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // 🚀 Use the SAME transformation function as admin service
        const transformedMedia = transformMediaForResponse(mediaItems, {
            quality: options.quality || 'medium',
            format: options.format || 'auto',
            context: options.context || 'mobile', // Default to mobile for guests
            includeVariants: true // Enable progressive URLs for guests
        }, options.userAgent);

        // Add guest-specific metadata to each item
        const guestEnhancedMedia = transformedMedia.map(item => ({
            ...item,
            // Hide uploader info for privacy
            uploaded_by: "Guest",
            // Ensure guest access context
            guest_access: true
        }));

        // Pagination info
        const hasNext = (page * limit) < totalCount;
        const pagination = {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNext,
            hasPrev: page > 1,
            totalCount
        };

        return {
            status: true,
            code: 200,
            message: 'Guest media retrieved successfully',
            data: guestEnhancedMedia,
            error: null,
            other: {
                eventId: event._id.toString(),
                eventTitle: event.title,
                pagination,
                guest_access: true,
                share_settings: {
                    can_view: true,
                    can_download: event.permissions?.can_download || false
                },
                // Same optimization info as admin service
                optimization_settings: {
                    quality: options.quality || 'medium',
                    format: options.format || 'auto',
                    context: options.context || 'mobile'
                },
                progressive_loading_enabled: true,
                supported_qualities: ['small', 'medium', 'large', 'original']
            }
        };

    } catch (error: any) {
        logger.error('❌ Error in getGuestMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to get guest media',
            data: null,
            error: { message: error.message }
        };
    }
};

// 🎯 Simplified batch service using existing transformation
export const getGuestMediaBatchService = async (
    shareToken: string,
    mediaIds: string[],
    quality: string = 'medium'
): Promise<ServiceResponse<any[]>> => {
    try {
        // Validate input
        if (!shareToken || !mediaIds || !Array.isArray(mediaIds) || mediaIds.length === 0) {
            return {
                status: false,
                code: 400,
                message: 'Invalid parameters',
                data: null,
                error: { message: 'Share token and media IDs are required' }
            };
        }

        // Validate all media IDs
        const validMediaIds = mediaIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validMediaIds.length === 0) {
            return {
                status: false,
                code: 400,
                message: 'No valid media IDs provided',
                data: null,
                error: { message: 'All media IDs must be valid ObjectIds' }
            };
        }

        // Find event by share token
        const event = await Event.findOne({
            share_token: shareToken
        }).select('_id permissions share_settings').lean();

        if (!event || !event.permissions?.can_view || !event.share_settings?.is_active) {
            return {
                status: false,
                code: 403,
                message: 'Access denied',
                data: null,
                error: { message: 'Cannot access this event' }
            };
        }

        // Get specific media items
        const mediaItems = await Media.find({
            _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
            event_id: event._id,
            'approval.status': { $in: ['approved', 'auto_approved'] }
        }).lean();

        // 🚀 Use the SAME transformation function
        const optimizedBatch = transformMediaForResponse(mediaItems, {
            quality: quality,
            format: 'auto',
            context: 'mobile',
            includeVariants: true
        });

        return {
            status: true,
            code: 200,
            message: 'Batch media URLs retrieved',
            data: optimizedBatch,
            error: null,
            other: {
                quality_used: quality,
                progressive_loading: true,
                requested_count: mediaIds.length,
                valid_count: validMediaIds.length,
                returned_count: optimizedBatch.length
            }
        };

    } catch (error: any) {
        logger.error('❌ Error in getGuestMediaBatchService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to get batch media',
            data: null,
            error: { message: error.message }
        };
    }
};
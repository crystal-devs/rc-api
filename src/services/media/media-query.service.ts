// 2. services/media/media-query.service.ts
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
        const page = parseInt(options.page) || 1;
        const limit = Math.min(parseInt(options.limit) || 20, 30);
        const skip = (page - 1) * limit;

        // Get media
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
                'image_variants': 1,
                created_at: 1,
                updated_at: 1
            })
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Transform for guest consumption
        const transformedMedia = mediaItems.map(item => ({
            _id: item._id.toString(),
            url: getOptimizedUrlForGuest(item, options.quality),
            original_url: item.url,
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
            error: { message: error.message }
        };
    }
};

// Helper function to get optimized URL for guests
const getOptimizedUrlForGuest = (media: any, quality: string = 'thumbnail'): string => {
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
        logger.warn('Error getting optimized URL, falling back to original:', error);
        return media.url;
    }
};
// services/media/media-query-enhanced.service.ts
// Enhanced media query service with Redis caching integration

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { transformMediaForResponse } from '@utils/file.util';
import { responseCacheService } from '@services/cache/response-cache.service';
import { photoCacheService } from '@services/cache/photo-cache.service';
import { cachedFetch } from '@services/cache/cached-fetch.service';
import type { ServiceResponse, MediaQueryOptions } from './media.types';
import type { MediaMetadata } from '@utils/file.util';

/**
 * Build MongoDB query for media filtering
 */
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

/**
 * Fetch a page of event media directly from MongoDB — the expensive "source of truth".
 * This is the producer wrapped by cachedFetch() below; it runs at most once per cache
 * miss/refresh. Do NOT add response caching in here (cachedFetch owns storage) — the only
 * caching this does is the non-blocking, best-effort warming of photo metadata.
 */
async function fetchMediaByEventFromDb(
    eventId: string,
    options: MediaQueryOptions
): Promise<ServiceResponse<MediaMetadata[]>> {
    logger.info(`❌ Cache MISS: Fetching from database for event ${eventId}`);

    // ✅ STEP 2: Query database
    const query = buildMediaQuery(eventId, 'event_id', options);

    // Get counts with optimized queries
    const totalCount = await Media.countDocuments({
        event_id: new mongoose.Types.ObjectId(eventId)
    }, { hint: { event_id: 1 } });

    const filteredCount = await Media.countDocuments(query, {
        hint: query['approval.status'] ? { event_id: 1, 'approval.status': 1 } : { event_id: 1 }
    });

    logger.info('Media query debug:', {
        eventId,
        totalCount,
        filteredCount,
        hasFilters: Object.keys(query).length > 1
    });

    if (filteredCount === 0) {
        // Negative result: still returned (and cached with a shorter TTL by cachedFetch) so a
        // spike of requests for an empty/quiet event can't repeatedly hit the DB (penetration).
        return {
            status: true,
            code: 200,
            message: 'No media found for this event with the given filters',
            data: [],
            error: null,
            other: {
                totalCount,
                filteredCount: 0,
                appliedFilters: options,
                cache_status: 'miss'
            }
        };
    }

    // Set pagination
    const limit = Math.min(options.limit || 20, 100);
    const page = options.page || 1;
    const skip = (page - 1) * limit;

    // Execute query with optimized projection
    const mediaItems = await Media.find(query, {
        // Only select fields we need for the response
        _id: 1,
        'original.filename': 1,
        'original.public_id': 1,
        'original.size_mb': 1,
        'original.format': 1,
        'original.width': 1,
        'original.height': 1,
        'original.duration': 1,
        'variants.images.small.public_id': 1,
        'variants.images.medium.public_id': 1,
        'variants.images.large.public_id': 1,
        'variants.videos.p360.public_id': 1,
        'variants.videos.p720.public_id': 1,
        'variants.videos.p1080.public_id': 1,
        'variants.thumbnails.poster.public_id': 1,
        'variants.thumbnails.preview.public_id': 1,
        'approval.status': 1,
        'processing.status': 1,
        type: 1,
        created_at: 1,
        'owner.user_id': 1,
        'owner.guest_id': 1,
        event_id: 1
    })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    // ✅ STEP 3: Cache individual photo metadata in Redis
    const photoMetadataList = mediaItems.map(item => ({
        id: item._id.toString(),
        filename: item.original?.filename || item.upload_id || '', // Use filename or upload_id
        url: item.original?.public_id || '',
        thumbnailUrl: item.type === 'image'
            ? (item.variants?.images?.small?.public_id || item.original?.public_id)
            : (item.variants?.thumbnails?.poster?.public_id || item.original?.public_id),
        size: item.original?.size_mb || 0,
        format: item.original?.format || '',
        width: item.original?.width,
        height: item.original?.height,
        duration: item.original?.duration,
        uploadedBy: item.owner?.user_id?.toString() || item.owner?.guest_id || '',
        uploadedAt: item.created_at,
        eventId: eventId,
        processingStatus: item.processing?.status || 'unknown',
        mediaType: item.type,
        variants: item.type === 'image' && item.variants?.images ? {
            thumbnail: item.variants.images.small?.public_id,
            medium: item.variants.images.medium?.public_id,
            large: item.variants.images.large?.public_id
        } : item.type === 'video' && item.variants ? {
            p360: item.variants.videos?.p360?.public_id,
            p720: item.variants.videos?.p720?.public_id,
            p1080: item.variants.videos?.p1080?.public_id,
            poster: item.variants.thumbnails?.poster?.public_id,
            preview: item.variants.thumbnails?.preview?.public_id
        } : undefined
    }));

    // Batch cache photo metadata (non-blocking)
    photoCacheService.setMultiplePhotoMetadata(photoMetadataList).catch(err => {
        logger.error('Error caching photo metadata:', err);
    });

    // ✅ STEP 4: Transform media with batch signed URL generation
    const optimizedMedia = await transformMediaForResponse(mediaItems);

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
            optimization_settings: {
                quality: options.quality || 'medium',
                format: options.format || 'auto',
                context: options.context || 'desktop'
            },
            appliedFilters: options,
            cache_status: 'miss'
        }
    };
}

/**
 * Get media by event with Redis caching.
 * OPTIMIZED: response cache -> photo metadata cache -> database, with stampede protection.
 *
 * The read is wrapped by cachedFetch(), which guarantees that a spike of concurrent misses
 * for the same page collapses into a single DB query (single-flight lock), spreads TTLs with
 * jitter so keys don't all expire together, and serves slightly-stale data while one background
 * worker refreshes it — so a traffic spike on a cold/expired key can't stampede MongoDB.
 */
export const getMediaByEventServiceCached = async (
    eventId: string,
    options: MediaQueryOptions,
    userAgent?: string
): Promise<ServiceResponse<MediaMetadata[]>> => {
    try {
        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'Invalid ObjectId format' }
            };
        }

        // Same key scheme as responseCacheService so existing pattern-based invalidation
        // (invalidateEventCache -> responseCacheService.invalidateEvent) keeps matching.
        const cacheKey = `media/event/${eventId}`;
        const cacheParams = {
            page: options.page || 1,
            limit: options.limit || 20,
            status: options.status,
            quality: options.quality,
            includeProcessing: options.includeProcessing,
            includePending: options.includePending
        };

        return await cachedFetch<ServiceResponse<MediaMetadata[]>>(
            cacheKey,
            cacheParams,
            () => fetchMediaByEventFromDb(eventId, options),
            {
                // Full TTL for real results; shorter TTL for empty/negative results (10min / 5min),
                // matching the previous behaviour. cachedFetch adds jitter + a stale window on top.
                ttl: (resp) => (resp.data && resp.data.length > 0 ? 600 : 300)
            }
        );

    } catch (error: any) {
        logger.error('[getMediaByEventServiceCached] Error:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to retrieve media',
            data: null,
            error: { message: error.message }
        };
    }
};

/**
 * Invalidate cache for an event
 * Call this when media is added, updated, or deleted
 */
export async function invalidateEventCache(eventId: string): Promise<void> {
    try {
        await Promise.all([
            responseCacheService.invalidateEvent(eventId),
            photoCacheService.invalidateEventPhotoList(eventId)
        ]);

        logger.info(`✅ Invalidated all caches for event ${eventId}`);
    } catch (error) {
        logger.error('Error invalidating event cache:', error);
    }
}

/**
 * Invalidate cache for specific media item
 */
export async function invalidateMediaCache(mediaId: string, eventId?: string): Promise<void> {
    try {
        await Promise.all([
            photoCacheService.invalidatePhotoMetadata(mediaId),
            eventId ? responseCacheService.invalidateEvent(eventId) : Promise.resolve()
        ]);

        logger.info(`✅ Invalidated cache for media ${mediaId}`);
    } catch (error) {
        logger.error('Error invalidating media cache:', error);
    }
}

// Export the cached version as the default
export const getMediaByEventService = getMediaByEventServiceCached;

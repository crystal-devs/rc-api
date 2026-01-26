// services/cache/cache-invalidation.service.ts
// Centralized cache invalidation service for media operations

import { responseCacheService } from './response-cache.service';
import { photoCacheService } from './photo-cache.service';
import { signedUrlCache } from './signed-url-cache.service';
import { logger } from '@utils/logger';

export class CacheInvalidationService {
    private static instance: CacheInvalidationService;

    private constructor() { }

    public static getInstance(): CacheInvalidationService {
        if (!CacheInvalidationService.instance) {
            CacheInvalidationService.instance = new CacheInvalidationService();
        }
        return CacheInvalidationService.instance;
    }

    /**
     * Invalidate all caches for a specific event
     * Call when: media added, deleted, or status changed
     */
    async invalidateEvent(eventId: string): Promise<void> {
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
     * Invalidate cache for a specific media item
     * Call when: media updated or deleted
     */
    async invalidateMedia(mediaId: string, eventId?: string, s3Key?: string): Promise<void> {
        try {
            const promises: Promise<any>[] = [
                photoCacheService.invalidatePhotoMetadata(mediaId)
            ];

            if (eventId) {
                promises.push(responseCacheService.invalidateEvent(eventId));
            }

            if (s3Key) {
                promises.push(signedUrlCache.invalidate(s3Key));
            }

            await Promise.all(promises);

            logger.info(`✅ Invalidated cache for media ${mediaId}`);
        } catch (error) {
            logger.error('Error invalidating media cache:', error);
        }
    }

    /**
     * Invalidate cache for multiple media items (bulk operations)
     */
    async invalidateMediaBatch(mediaIds: string[], eventId: string): Promise<void> {
        try {
            const promises = mediaIds.map(id =>
                photoCacheService.invalidatePhotoMetadata(id)
            );

            promises.push(responseCacheService.invalidateEvent(eventId));

            await Promise.all(promises);

            logger.info(`✅ Invalidated cache for ${mediaIds.length} media items in event ${eventId}`);
        } catch (error) {
            logger.error('Error invalidating media batch cache:', error);
        }
    }

    /**
     * Invalidate cache for an album
     */
    async invalidateAlbum(albumId: string): Promise<void> {
        try {
            await responseCacheService.invalidateAlbum(albumId);
            logger.info(`✅ Invalidated cache for album ${albumId}`);
        } catch (error) {
            logger.error('Error invalidating album cache:', error);
        }
    }

    /**
     * Warm cache for a specific event
     * Pre-load frequently accessed events into cache
     */
    async warmEventCache(eventId: string): Promise<void> {
        try {
            // This would trigger a cache population
            // Implementation depends on your specific needs
            logger.info(`🔥 Warming cache for event ${eventId}`);
        } catch (error) {
            logger.error('Error warming event cache:', error);
        }
    }

    /**
     * Clear all media-related caches
     * Use with caution - only for maintenance or debugging
     */
    async clearAllCaches(): Promise<void> {
        try {
            await Promise.all([
                responseCacheService.clearAll(),
                photoCacheService.clearAllPhotoCaches(),
                signedUrlCache.clearAll()
            ]);

            logger.warn('⚠️ Cleared ALL media caches');
        } catch (error) {
            logger.error('Error clearing all caches:', error);
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{
        responses: any;
        photos: any;
        signedUrls: any;
    }> {
        try {
            const [responses, photos, signedUrls] = await Promise.all([
                responseCacheService.getStats(),
                photoCacheService.getPhotosCacheStats(),
                signedUrlCache.getStats()
            ]);

            return { responses, photos, signedUrls };
        } catch (error) {
            logger.error('Error getting cache stats:', error);
            return {
                responses: null,
                photos: null,
                signedUrls: null
            };
        }
    }
}

// Export singleton instance
export const cacheInvalidation = CacheInvalidationService.getInstance();

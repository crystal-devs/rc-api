// services/cache/photo-cache.service.ts
// Optimized Redis caching for photo metadata using memory-efficient data structures

import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';
import { MediaDocument } from '@models/media.model';

interface PhotoMetadata {
    id: string;
    filename: string;
    url: string;
    thumbnailUrl?: string;
    size: number;
    format: string;
    dimensions?: {
        width: number;
        height: number;
    };
    uploadedBy: string;
    uploadedAt: Date;
    eventId: string;
    albumId?: string;
    processingStatus: string;
    variants?: {
        thumbnail?: string;
        medium?: string;
        large?: string;
    };
}

interface CompressedPhotoMetadata {
    filename: string;
    url: string;
    thumbnailUrl?: string;
    size: number;
    format: string;
    width?: number;
    height?: number;
    uploadedBy: string;
    uploadedAt: string; // ISO string for compression
    eventId?: string; // ✅ Added eventId
    albumId?: string; // ✅ Added albumId
    processingStatus: string;
    variants?: string; // JSON string for variants
}

export class PhotoCacheService {
    private static instance: PhotoCacheService;
    private readonly PREFIX = 'photo_cache:';
    private readonly PHOTO_TTL = 1800; // 30 minutes for photo metadata
    private readonly EVENT_PHOTOS_TTL = 900; // 15 minutes for photo lists
    private readonly STATS_TTL = 300; // 5 minutes for stats

    private constructor() {}

    public static getInstance(): PhotoCacheService {
        if (!PhotoCacheService.instance) {
            PhotoCacheService.instance = new PhotoCacheService();
        }
        return PhotoCacheService.instance;
    }

    private getRedis() {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            logger.warn('Redis client not available for photo caching');
            return null;
        }
        return redis;
    }

    // ============= PHOTO METADATA CACHING (Using Redis Hashes) =============

    /**
     * Cache photo metadata using Redis Hash for memory efficiency
     */
    async setPhotoMetadata(photoId: string, metadata: PhotoMetadata): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}photo:${photoId}`;
            
            // Compress metadata for storage efficiency
            const compressed: CompressedPhotoMetadata = {
                filename: metadata.filename,
                url: metadata.url,
                thumbnailUrl: metadata.thumbnailUrl,
                size: metadata.size,
                format: metadata.format,
                width: metadata.dimensions?.width,
                height: metadata.dimensions?.height,
                uploadedBy: metadata.uploadedBy,
                uploadedAt: metadata.uploadedAt.toISOString(),
                eventId: metadata.eventId, // ✅ Fixed: Add eventId to compressed data
                albumId: metadata.albumId,
                processingStatus: metadata.processingStatus,
                variants: metadata.variants ? JSON.stringify(metadata.variants) : undefined
            };

            // Use Redis Hash for memory efficiency
            const pipeline = redis.multi();
            
            // Store each field separately in hash
            Object.entries(compressed).forEach(([field, value]) => {
                if (value !== undefined) {
                    pipeline.hSet(key, field, value.toString());
                }
            });
            
            // Set TTL
            pipeline.expire(key, this.PHOTO_TTL);
            
            await pipeline.exec();
            
            logger.debug(`Cached photo metadata for ${photoId} using Redis Hash`);
        } catch (error) {
            logger.error('Error caching photo metadata:', error);
        }
    }

    /**
     * Get photo metadata from Redis Hash
     */
    async getPhotoMetadata(photoId: string): Promise<PhotoMetadata | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const key = `${this.PREFIX}photo:${photoId}`;
            const compressed = await redis.hGetAll(key);
            
            if (!compressed || Object.keys(compressed).length === 0) {
                logger.debug(`Cache MISS: Photo metadata ${photoId}`);
                return null;
            }

            logger.debug(`Cache HIT: Photo metadata ${photoId}`);
            
            // Decompress metadata
            const metadata: PhotoMetadata = {
                id: photoId,
                filename: compressed.filename,
                url: compressed.url,
                thumbnailUrl: compressed.thumbnailUrl,
                size: parseInt(compressed.size),
                format: compressed.format,
                dimensions: compressed.width && compressed.height ? {
                    width: parseInt(compressed.width),
                    height: parseInt(compressed.height)
                } : undefined,
                uploadedBy: compressed.uploadedBy,
                uploadedAt: new Date(compressed.uploadedAt),
                eventId: compressed.eventId || '',
                albumId: compressed.albumId,
                processingStatus: compressed.processingStatus,
                variants: compressed.variants ? JSON.parse(compressed.variants) : undefined
            };

            return metadata;
        } catch (error) {
            logger.error('Error getting cached photo metadata:', error);
            return null;
        }
    }

    // ============= EVENT PHOTO LISTS (Using Redis Sorted Sets) =============

    /**
     * Add photo to event's photo list using sorted set with timestamp score
     */
    async addPhotoToEventList(eventId: string, photoId: string, uploadedAt: Date): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}event:${eventId}:photos`;
            const score = uploadedAt.getTime(); // Use timestamp as score for ordering
            
            await redis.zAdd(key, { score, value: photoId });
            await redis.expire(key, this.EVENT_PHOTOS_TTL);
            
            logger.debug(`Added photo ${photoId} to event ${eventId} photo list`);
        } catch (error) {
            logger.error('Error adding photo to event list:', error);
        }
    }

    /**
     * Get recent photos for an event using sorted set (most recent first)
     */
    async getEventPhotos(eventId: string, limit: number = 50, offset: number = 0): Promise<string[]> {
        const redis = this.getRedis();
        if (!redis) return [];

        try {
            const key = `${this.PREFIX}event:${eventId}:photos`;
            
            // Get photos in reverse chronological order (most recent first)
            const photoIds = await redis.zRange(key, offset, offset + limit - 1, { REV: true });
            
            if (photoIds.length > 0) {
                logger.debug(`Cache HIT: Event ${eventId} photos (${photoIds.length} items)`);
            }
            
            return photoIds;
        } catch (error) {
            logger.error('Error getting cached event photos:', error);
            return [];
        }
    }

    /**
     * Remove photo from event list
     */
    async removePhotoFromEventList(eventId: string, photoId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}event:${eventId}:photos`;
            await redis.zRem(key, photoId);
            
            logger.debug(`Removed photo ${photoId} from event ${eventId} photo list`);
        } catch (error) {
            logger.error('Error removing photo from event list:', error);
        }
    }

    // ============= BATCH OPERATIONS =============

    /**
     * Cache multiple photos efficiently using pipeline
     */
    async setMultiplePhotoMetadata(photos: PhotoMetadata[]): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();
            
            for (const photo of photos) {
                const key = `${this.PREFIX}photo:${photo.id}`;
                
                const compressed: CompressedPhotoMetadata = {
                    filename: photo.filename,
                    url: photo.url,
                    thumbnailUrl: photo.thumbnailUrl,
                    size: photo.size,
                    format: photo.format,
                    width: photo.dimensions?.width,
                    height: photo.dimensions?.height,
                    uploadedBy: photo.uploadedBy,
                    uploadedAt: photo.uploadedAt.toISOString(),
                    eventId: photo.eventId, // ✅ Fixed: Add eventId
                    albumId: photo.albumId,
                    processingStatus: photo.processingStatus,
                    variants: photo.variants ? JSON.stringify(photo.variants) : undefined
                };

                Object.entries(compressed).forEach(([field, value]) => {
                    if (value !== undefined) {
                        pipeline.hSet(key, field, value.toString());
                    }
                });
                
                pipeline.expire(key, this.PHOTO_TTL);
                
                // Also add to event photo list
                if (photo.eventId) {
                    const eventKey = `${this.PREFIX}event:${photo.eventId}:photos`;
                    pipeline.zAdd(eventKey, { score: photo.uploadedAt.getTime(), value: photo.id });
                    pipeline.expire(eventKey, this.EVENT_PHOTOS_TTL);
                }
            }
            
            await pipeline.exec();
            logger.debug(`Batch cached ${photos.length} photo metadata entries`);
        } catch (error) {
            logger.error('Error batch caching photo metadata:', error);
        }
    }

    /**
     * Get multiple photo metadata efficiently using pipeline
     */
    async getMultiplePhotoMetadata(photoIds: string[]): Promise<Map<string, PhotoMetadata>> {
        const redis = this.getRedis();
        const result = new Map<string, PhotoMetadata>();
        
        if (!redis) return result;

        try {
            const pipeline = redis.multi();
            
            // Queue all hash gets
            photoIds.forEach(photoId => {
                const key = `${this.PREFIX}photo:${photoId}`;
                pipeline.hGetAll(key);
            });
            
            const results = await pipeline.exec();
            
            if (!results) return result;
            
            // Process results
            results.forEach((res, index) => {
                if (res && Array.isArray(res) && res[1] && typeof res[1] === 'object') {
                    const compressed = res[1] as Record<string, string>;
                    const photoId = photoIds[index];
                    
                    if (Object.keys(compressed).length > 0) {
                        const metadata: PhotoMetadata = {
                            id: photoId,
                            filename: compressed.filename,
                            url: compressed.url,
                            thumbnailUrl: compressed.thumbnailUrl,
                            size: parseInt(compressed.size),
                            format: compressed.format,
                            dimensions: compressed.width && compressed.height ? {
                                width: parseInt(compressed.width),
                                height: parseInt(compressed.height)
                            } : undefined,
                            uploadedBy: compressed.uploadedBy,
                            uploadedAt: new Date(compressed.uploadedAt),
                            eventId: compressed.eventId || '',
                            albumId: compressed.albumId,
                            processingStatus: compressed.processingStatus,
                            variants: compressed.variants ? JSON.parse(compressed.variants) : undefined
                        };
                        
                        result.set(photoId, metadata);
                    }
                }
            });
            
            logger.debug(`Batch retrieved ${result.size}/${photoIds.length} photo metadata entries`);
            return result;
        } catch (error) {
            logger.error('Error batch getting photo metadata:', error);
            return result;
        }
    }

    // ============= CACHE INVALIDATION =============

    /**
     * Invalidate photo metadata cache
     */
    async invalidatePhotoMetadata(photoId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}photo:${photoId}`;
            await redis.del(key);
            
            logger.debug(`Invalidated photo metadata cache for ${photoId}`);
        } catch (error) {
            logger.error('Error invalidating photo metadata:', error);
        }
    }

    /**
     * Invalidate event photo list cache
     */
    async invalidateEventPhotoList(eventId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}event:${eventId}:photos`;
            await redis.del(key);
            
            logger.debug(`Invalidated event photo list cache for ${eventId}`);
        } catch (error) {
            logger.error('Error invalidating event photo list:', error);
        }
    }

    /**
     * Remove photo from all caches (metadata + event lists)
     */
    async removePhotoFromAllCaches(photoId: string, eventId?: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();
            
            // Remove metadata
            pipeline.del(`${this.PREFIX}photo:${photoId}`);
            
            // Remove from event photo list if eventId provided
            if (eventId) {
                pipeline.zRem(`${this.PREFIX}event:${eventId}:photos`, photoId);
            }
            
            await pipeline.exec();
            
            logger.debug(`Removed photo ${photoId} from all caches`);
        } catch (error) {
            logger.error('Error removing photo from all caches:', error);
        }
    }

    // ============= BACKGROUND CLEANUP =============

    /**
     * Clean up expired photo metadata and stale processing entries
     * Fixed logic: Check age directly, not TTL + age combination
     */
    async cleanupExpiredPhotos(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            let cleanedCount = 0;
            
            // Get all photo metadata keys
            const photoKeys = await redis.keys(`${this.PREFIX}photo:*`);
            
            for (const key of photoKeys) {
                const metadata = await redis.hGetAll(key);
                if (metadata && metadata.uploadedAt) {
                    const uploadedAt = new Date(metadata.uploadedAt);
                    const ageHours = (Date.now() - uploadedAt.getTime()) / (1000 * 60 * 60);
                    
                    // Clean up photos older than 24 hours if they're still in processing status
                    // This handles stuck/failed processing jobs
                    if (ageHours > 24 && metadata.processingStatus === 'processing') {
                        await redis.del(key);
                        cleanedCount++;
                        
                        // Also remove from event photo list if eventId exists
                        if (metadata.eventId) {
                            const photoId = key.split(':').pop();
                            await this.removePhotoFromEventList(metadata.eventId, photoId || '');
                        }
                        
                        logger.debug(`Cleaned up stale processing photo: ${key} (age: ${ageHours.toFixed(1)}h)`);
                    }
                    
                    // Also clean up very old completed photos (older than 7 days) to prevent cache bloat
                    else if (ageHours > 168) { // 7 days
                        await redis.del(key);
                        cleanedCount++;
                        
                        if (metadata.eventId) {
                            const photoId = key.split(':').pop();
                            await this.removePhotoFromEventList(metadata.eventId, photoId || '');
                        }
                        
                        logger.debug(`Cleaned up old photo cache: ${key} (age: ${ageHours.toFixed(1)}h)`);
                    }
                }
            }
            
            if (cleanedCount > 0) {
                logger.info(`Cleaned up ${cleanedCount} expired/stale photo cache entries`);
            }
        } catch (error) {
            logger.error('Error during photo cache cleanup:', error);
        }
    }

    /**
     * Clean up orphaned event photo lists (events that no longer exist)
     */
    async cleanupOrphanedEventPhotoLists(validEventIds: string[]): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const eventPhotoKeys = await redis.keys(`${this.PREFIX}event:*:photos`);
            let cleanedCount = 0;
            
            for (const key of eventPhotoKeys) {
                // Extract eventId from key: "photo_cache:event:123:photos" -> "123"
                const eventId = key.split(':')[2];
                
                if (!validEventIds.includes(eventId)) {
                    await redis.del(key);
                    cleanedCount++;
                }
            }
            
            if (cleanedCount > 0) {
                logger.info(`Cleaned up ${cleanedCount} orphaned event photo lists`);
            }
        } catch (error) {
            logger.error('Error cleaning up orphaned event photo lists:', error);
        }
    }

    /**
     * Remove photos from event lists that no longer exist in metadata cache
     */
    async cleanupEventPhotoListsIntegrity(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const eventPhotoKeys = await redis.keys(`${this.PREFIX}event:*:photos`);
            let totalCleaned = 0;
            
            for (const listKey of eventPhotoKeys) {
                // Get all photo IDs in this event's list
                const photoIds = await redis.zRange(listKey, 0, -1);
                let cleanedFromList = 0;
                
                for (const photoId of photoIds) {
                    // Check if photo metadata still exists
                    const metadataKey = `${this.PREFIX}photo:${photoId}`;
                    const exists = await redis.exists(metadataKey);
                    
                    if (!exists) {
                        // Remove from event photo list
                        await redis.zRem(listKey, photoId);
                        cleanedFromList++;
                        totalCleaned++;
                    }
                }
                
                if (cleanedFromList > 0) {
                    const eventId = listKey.split(':')[2];
                    logger.debug(`Cleaned ${cleanedFromList} orphaned photos from event ${eventId} list`);
                }
            }
            
            if (totalCleaned > 0) {
                logger.info(`Cleaned up ${totalCleaned} orphaned photo references from event lists`);
            }
        } catch (error) {
            logger.error('Error cleaning up event photo list integrity:', error);
        }
    }

    /**
     * Comprehensive cleanup - run all cleanup operations
     */
    async runComprehensiveCleanup(validEventIds?: string[]): Promise<void> {
        logger.info('Starting comprehensive photo cache cleanup...');
        
        try {
            // Run all cleanup operations
            await Promise.all([
                this.cleanupExpiredPhotos(),
                this.cleanupEventPhotoListsIntegrity(),
                validEventIds ? this.cleanupOrphanedEventPhotoLists(validEventIds) : Promise.resolve()
            ]);
            
            logger.info('Comprehensive photo cache cleanup completed');
        } catch (error) {
            logger.error('Error during comprehensive cleanup:', error);
        }
    }

    // ============= CACHE STATISTICS =============

    /**
     * Get photo cache statistics
     */
    async getPhotosCacheStats(): Promise<any> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const photoKeys = await redis.keys(`${this.PREFIX}photo:*`);
            const eventPhotoKeys = await redis.keys(`${this.PREFIX}event:*:photos`);
            
            const stats = {
                total_photo_metadata: photoKeys.length,
                total_event_photo_lists: eventPhotoKeys.length,
                memory_usage: {
                    estimated_photo_metadata_kb: photoKeys.length * 2, // Rough estimate
                    estimated_event_lists_kb: eventPhotoKeys.length * 1
                }
            };

            return stats;
        } catch (error) {
            logger.error('Error getting photo cache stats:', error);
            return null;
        }
    }

    /**
     * Clear all photo caches
     */
    async clearAllPhotoCaches(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            if (keys.length > 0) {
                await Promise.all(keys.map(k => redis.del(k)));
                logger.info(`Cleared ${keys.length} photo cache keys`);
            }
        } catch (error) {
            logger.error('Error clearing all photo caches:', error);
        }
    }
}

// Export singleton instance
export const photoCacheService = PhotoCacheService.getInstance();

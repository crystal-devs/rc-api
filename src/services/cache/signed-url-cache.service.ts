// services/cache/signed-url-cache.service.ts
// Redis-backed signed URL cache for S3 and CloudFront URLs

import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';

export class SignedUrlCacheService {
    private static instance: SignedUrlCacheService;
    private readonly PREFIX = 'signed_url:';
    private readonly DEFAULT_TTL = 3000; // 50 minutes (for 1-hour S3 URLs with buffer)

    private constructor() { }

    public static getInstance(): SignedUrlCacheService {
        if (!SignedUrlCacheService.instance) {
            SignedUrlCacheService.instance = new SignedUrlCacheService();
        }
        return SignedUrlCacheService.instance;
    }

    private getRedis() {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            logger.warn('Redis client not available for signed URL caching');
            return null;
        }
        return redis;
    }

    /**
     * Get cached signed URL
     */
    async get(key: string, expiresIn: number = 3600): Promise<string | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const cacheKey = `${this.PREFIX}${key}:${expiresIn}`;
            const cachedUrl = await redis.get(cacheKey) as string | null;

            if (cachedUrl) {
                logger.debug(`Cache HIT: Signed URL for ${key.substring(0, 30)}...`);
                return cachedUrl;
            }

            logger.debug(`Cache MISS: Signed URL for ${key.substring(0, 30)}...`);
            return null;
        } catch (error) {
            logger.error('Error getting cached signed URL:', error);
            return null;
        }
    }

    /**
     * Cache signed URL
     */
    async set(key: string, url: string, expiresIn: number = 3600): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const cacheKey = `${this.PREFIX}${key}:${expiresIn}`;
            // Cache for slightly less than the URL expiration (10 min buffer)
            const cacheTTL = Math.max(expiresIn - 600, 300); // Minimum 5 minutes

            await redis.setEx(cacheKey, cacheTTL, url);
            logger.debug(`Cached signed URL for ${key.substring(0, 30)}... (TTL: ${cacheTTL}s)`);
        } catch (error) {
            logger.error('Error caching signed URL:', error);
        }
    }

    /**
     * Get multiple signed URLs efficiently using pipeline
     */
    async getMultiple(keys: Array<{ key: string; expiresIn: number }>): Promise<Map<string, string>> {
        const redis = this.getRedis();
        const result = new Map<string, string>();

        if (!redis || keys.length === 0) return result;

        try {
            const pipeline = redis.multi();

            keys.forEach(({ key, expiresIn }) => {
                const cacheKey = `${this.PREFIX}${key}:${expiresIn}`;
                pipeline.get(cacheKey);
            });

            const results = await pipeline.exec();

            if (!results) return result;

            results.forEach((res, index) => {
                if (res && Array.isArray(res) && res[1]) {
                    const originalKey = keys[index].key;
                    result.set(originalKey, res[1] as string);
                }
            });

            logger.debug(`Batch retrieved ${result.size}/${keys.length} signed URLs from cache`);
            return result;
        } catch (error) {
            logger.error('Error batch getting signed URLs:', error);
            return result;
        }
    }

    /**
     * Cache multiple signed URLs efficiently using pipeline
     */
    async setMultiple(entries: Array<{ key: string; url: string; expiresIn: number }>): Promise<void> {
        const redis = this.getRedis();
        if (!redis || entries.length === 0) return;

        try {
            const pipeline = redis.multi();

            entries.forEach(({ key, url, expiresIn }) => {
                const cacheKey = `${this.PREFIX}${key}:${expiresIn}`;
                const cacheTTL = Math.max(expiresIn - 600, 300);
                pipeline.setEx(cacheKey, cacheTTL, url);
            });

            await pipeline.exec();
            logger.debug(`Batch cached ${entries.length} signed URLs`);
        } catch (error) {
            logger.error('Error batch caching signed URLs:', error);
        }
    }

    /**
     * Invalidate cached URL
     */
    async invalidate(key: string, expiresIn?: number): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            if (expiresIn) {
                // Invalidate specific expiration
                const cacheKey = `${this.PREFIX}${key}:${expiresIn}`;
                await redis.del(cacheKey);
            } else {
                // Invalidate all expirations for this key
                const pattern = `${this.PREFIX}${key}:*`;
                const keys = await redis.keys(pattern);
                if (keys.length > 0) {
                    await redis.del(keys);
                }
            }

            logger.debug(`Invalidated signed URL cache for ${key.substring(0, 30)}...`);
        } catch (error) {
            logger.error('Error invalidating signed URL cache:', error);
        }
    }

    /**
     * Clear all signed URL caches
     */
    async clearAll(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            if (keys.length > 0) {
                await redis.del(keys);
                logger.info(`Cleared ${keys.length} signed URL cache entries`);
            }
        } catch (error) {
            logger.error('Error clearing signed URL cache:', error);
        }
    }

    /**
     * Get cache statistics
     */
    async getStats(): Promise<{ totalKeys: number; estimatedMemoryKB: number }> {
        const redis = this.getRedis();
        if (!redis) return { totalKeys: 0, estimatedMemoryKB: 0 };

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            return {
                totalKeys: keys.length,
                estimatedMemoryKB: keys.length * 0.5 // Rough estimate: 500 bytes per URL
            };
        } catch (error) {
            logger.error('Error getting signed URL cache stats:', error);
            return { totalKeys: 0, estimatedMemoryKB: 0 };
        }
    }

    /**
     * Cleanup expired entries (run periodically)
     */
    async cleanup(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            // Redis automatically removes expired keys, but we can check for orphaned entries
            const keys = await redis.keys(`${this.PREFIX}*`);
            let cleanedCount = 0;

            for (const key of keys) {
                const ttl = await redis.ttl(key);
                // Remove keys with no TTL (shouldn't happen, but safety check)
                if (ttl === -1) {
                    await redis.del(key);
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                logger.info(`Cleaned up ${cleanedCount} orphaned signed URL cache entries`);
            }
        } catch (error) {
            logger.error('Error during signed URL cache cleanup:', error);
        }
    }
}

// Export singleton instance
export const signedUrlCache = SignedUrlCacheService.getInstance();

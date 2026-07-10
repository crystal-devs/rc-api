// services/cache/response-cache.service.ts
// Response-level caching for media API endpoints

import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';
import crypto from 'crypto';

interface CacheOptions {
    ttl?: number;
    compress?: boolean;
}

export class ResponseCacheService {
    private static instance: ResponseCacheService;
    private readonly PREFIX = 'response_cache:';
    private readonly DEFAULT_TTL = 600; // 10 minutes

    private constructor() { }

    public static getInstance(): ResponseCacheService {
        if (!ResponseCacheService.instance) {
            ResponseCacheService.instance = new ResponseCacheService();
        }
        return ResponseCacheService.instance;
    }

    private getRedis() {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            logger.warn('Redis client not available for response caching');
            return null;
        }
        return redis;
    }

    /**
     * Generate cache key from request parameters.
     * Public so the stampede-protection helper (cached-fetch.service) can build
     * the exact same key, keeping existing pattern-based invalidation working.
     */
    public buildKey(endpoint: string, params: Record<string, any>): string {
        // Sort params for consistent hashing
        const sortedParams = Object.keys(params)
            .sort()
            .reduce((acc, key) => {
                acc[key] = params[key];
                return acc;
            }, {} as Record<string, any>);

        const paramsString = JSON.stringify(sortedParams);
        const hash = crypto.createHash('md5').update(paramsString).digest('hex');

        return `${this.PREFIX}${endpoint}:${hash}`;
    }

    private generateCacheKey(endpoint: string, params: Record<string, any>): string {
        return this.buildKey(endpoint, params);
    }

    /**
     * Get cached response
     */
    async get<T = any>(endpoint: string, params: Record<string, any> = {}): Promise<T | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const cacheKey = this.generateCacheKey(endpoint, params);
            const cached = await redis.get(cacheKey);

            if (cached) {
                logger.debug(`Cache HIT: Response for ${endpoint}`);
                return JSON.parse(cached as string) as T;
            }

            logger.debug(`Cache MISS: Response for ${endpoint}`);
            return null;
        } catch (error) {
            logger.error('Error getting cached response:', error);
            return null;
        }
    }

    /**
     * Cache response
     */
    async set(
        endpoint: string,
        params: Record<string, any>,
        data: any,
        options: CacheOptions = {}
    ): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const cacheKey = this.generateCacheKey(endpoint, params);
            const ttl = options.ttl || this.DEFAULT_TTL;
            const serialized = JSON.stringify(data);

            await redis.setEx(cacheKey, ttl, serialized);

            logger.debug(`Cached response for ${endpoint} (TTL: ${ttl}s, Size: ${serialized.length} bytes)`);
        } catch (error) {
            logger.error('Error caching response:', error);
        }
    }

    /**
     * Invalidate cache by endpoint pattern
     */
    async invalidateByPattern(pattern: string): Promise<number> {
        const redis = this.getRedis();
        if (!redis) return 0;

        try {
            const searchPattern = `${this.PREFIX}${pattern}*`;
            const keys = await redis.keys(searchPattern);

            if (keys.length > 0) {
                await redis.del(keys);
                logger.info(`Invalidated ${keys.length} cached responses matching pattern: ${pattern}`);
                return keys.length;
            }

            return 0;
        } catch (error) {
            logger.error('Error invalidating response cache by pattern:', error);
            return 0;
        }
    }

    /**
     * Invalidate cache for specific event
     */
    async invalidateEvent(eventId: string): Promise<void> {
        await this.invalidateByPattern(`media/event/${eventId}`);
        await this.invalidateByPattern(`guest/media/${eventId}`);
    }

    /**
     * Invalidate cache for specific album
     */
    async invalidateAlbum(albumId: string): Promise<void> {
        await this.invalidateByPattern(`media/album/${albumId}`);
    }

    /**
     * Clear all response caches
     */
    async clearAll(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            if (keys.length > 0) {
                await redis.del(keys);
                logger.info(`Cleared ${keys.length} response cache entries`);
            }
        } catch (error) {
            logger.error('Error clearing response cache:', error);
        }
    }

    /**
     * Get cache statistics
     */
    async getStats(): Promise<{
        totalKeys: number;
        estimatedMemoryKB: number;
        keysByEndpoint: Record<string, number>;
    }> {
        const redis = this.getRedis();
        if (!redis) {
            return { totalKeys: 0, estimatedMemoryKB: 0, keysByEndpoint: {} };
        }

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            const keysByEndpoint: Record<string, number> = {};

            keys.forEach(key => {
                const endpoint = key.split(':')[1] || 'unknown';
                keysByEndpoint[endpoint] = (keysByEndpoint[endpoint] || 0) + 1;
            });

            return {
                totalKeys: keys.length,
                estimatedMemoryKB: keys.length * 5, // Rough estimate: 5KB per response
                keysByEndpoint
            };
        } catch (error) {
            logger.error('Error getting response cache stats:', error);
            return { totalKeys: 0, estimatedMemoryKB: 0, keysByEndpoint: {} };
        }
    }
}

// Export singleton instance
export const responseCacheService = ResponseCacheService.getInstance();

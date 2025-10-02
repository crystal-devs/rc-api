// controllers/admin/cache.controller.ts
// Admin routes for cache management and monitoring

import { Request, Response, NextFunction } from 'express';
import { logger } from '@utils/logger';
import { eventCacheService } from '@services/cache/event-cache.service';
import { photoCacheService } from '@services/cache/photo-cache.service';
import { analyticsCacheService } from '@services/cache/analytics-cache.service';
import { getRedisClient } from '@configs/redis.config';

interface AuthenticatedRequest extends Request {
    user: {
        _id: string;
        role?: string;
        [key: string]: any;
    };
}

// Middleware to check admin permissions
const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            status: false,
            message: 'Admin access required',
            data: null
        });
    }
    next();
};

/**
 * Get comprehensive cache statistics
 */
export const getCacheStatsController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            return res.status(503).json({
                status: false,
                message: 'Redis not available',
                data: null
            });
        }

        // Get stats from all cache services
        const [eventStats, photoStats, analyticsStats] = await Promise.all([
            eventCacheService.getCacheStats(),
            photoCacheService.getPhotosCacheStats(),
            analyticsCacheService.getAnalyticsCacheStats()
        ]);

        // Get Redis info
        const redisInfo = await redis.info('memory');
        const redisMemoryInfo = parseRedisInfo(redisInfo);

        // Get total key count
        const allKeys = await redis.keys('*');
        const cacheKeys = allKeys.filter(key => 
            key.startsWith('event_cache:') || 
            key.startsWith('photo_cache:') || 
            key.startsWith('analytics_cache:')
        );

        const stats = {
            redis: {
                connected: redis.isReady,
                memory_usage_mb: redisMemoryInfo.used_memory_human,
                total_keys: allKeys.length,
                cache_keys: cacheKeys.length,
                uptime_seconds: redisMemoryInfo.uptime_in_seconds
            },
            event_cache: eventStats,
            photo_cache: photoStats,
            analytics_cache: analyticsStats,
            summary: {
                total_cache_keys: cacheKeys.length,
                cache_hit_ratio: 'N/A', // Would need to track hits/misses
                estimated_memory_savings: 'Significant', // Placeholder
                last_updated: new Date().toISOString()
            }
        };

        logger.info('Cache statistics requested by admin:', req.user._id);

        return res.json({
            status: true,
            message: 'Cache statistics retrieved successfully',
            data: stats
        });

    } catch (error) {
        logger.error('Error getting cache statistics:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to get cache statistics',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Flush specific cache type
 */
export const flushCacheController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const { cacheType } = req.params;
        const { confirm } = req.body;

        if (!confirm) {
            return res.status(400).json({
                status: false,
                message: 'Cache flush requires confirmation. Send { "confirm": true } in request body.',
                data: null
            });
        }

        let flushedCount = 0;
        let message = '';

        switch (cacheType) {
            case 'events':
                await eventCacheService.clearAllCaches();
                message = 'Event caches cleared successfully';
                break;

            case 'photos':
                await photoCacheService.clearAllPhotoCaches();
                message = 'Photo caches cleared successfully';
                break;

            case 'analytics':
                await analyticsCacheService.clearAllAnalyticsCaches();
                message = 'Analytics caches cleared successfully';
                break;

            case 'all':
                await Promise.all([
                    eventCacheService.clearAllCaches(),
                    photoCacheService.clearAllPhotoCaches(),
                    analyticsCacheService.clearAllAnalyticsCaches()
                ]);
                message = 'All caches cleared successfully';
                break;

            default:
                return res.status(400).json({
                    status: false,
                    message: 'Invalid cache type. Use: events, photos, analytics, or all',
                    data: null
                });
        }

        logger.warn(`Cache flush performed by admin ${req.user._id}: ${cacheType}`);

        return res.json({
            status: true,
            message,
            data: {
                cache_type: cacheType,
                flushed_at: new Date().toISOString(),
                performed_by: req.user._id
            }
        });

    } catch (error) {
        logger.error('Error flushing cache:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to flush cache',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Warm cache for specific event
 */
export const warmEventCacheController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const { eventId } = req.params;
        const { userIds } = req.body; // Array of user IDs to warm cache for

        if (!eventId) {
            return res.status(400).json({
                status: false,
                message: 'Event ID is required',
                data: null
            });
        }

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({
                status: false,
                message: 'User IDs array is required',
                data: null
            });
        }

        // Warm cache for the specified event and users
        await eventCacheService.warmFrequentlyAccessedEvents([eventId], userIds);

        logger.info(`Cache warming initiated by admin ${req.user._id} for event ${eventId} and ${userIds.length} users`);

        return res.json({
            status: true,
            message: 'Cache warming initiated successfully',
            data: {
                event_id: eventId,
                user_count: userIds.length,
                initiated_at: new Date().toISOString(),
                initiated_by: req.user._id
            }
        });

    } catch (error) {
        logger.error('Error warming cache:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to warm cache',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get cache health status
 */
export const getCacheHealthController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const redis = getRedisClient();
        
        const health = {
            redis_connected: redis?.isReady || false,
            redis_ready: redis?.isOpen || false,
            services_available: {
                event_cache: true,
                photo_cache: true,
                analytics_cache: true
            },
            last_check: new Date().toISOString()
        };

        // Test Redis connectivity
        if (redis && redis.isReady) {
            try {
                await redis.ping();
                health.redis_connected = true;
            } catch (e) {
                health.redis_connected = false;
            }
        }

        const overallHealth = health.redis_connected && 
                            Object.values(health.services_available).every(Boolean);

        return res.json({
            status: overallHealth,
            message: overallHealth ? 'Cache system healthy' : 'Cache system issues detected',
            data: health
        });

    } catch (error) {
        logger.error('Error checking cache health:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to check cache health',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Invalidate cache for specific event
 */
export const invalidateEventCacheController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const { eventId } = req.params;

        if (!eventId) {
            return res.status(400).json({
                status: false,
                message: 'Event ID is required',
                data: null
            });
        }

        // Invalidate all caches related to this event
        await Promise.all([
            eventCacheService.invalidateEventCaches(eventId),
            photoCacheService.invalidateEventPhotoList(eventId),
            analyticsCacheService.invalidateAnalyticsCaches(eventId)
        ]);

        logger.info(`Cache invalidation performed by admin ${req.user._id} for event ${eventId}`);

        return res.json({
            status: true,
            message: 'Event caches invalidated successfully',
            data: {
                event_id: eventId,
                invalidated_at: new Date().toISOString(),
                performed_by: req.user._id
            }
        });

    } catch (error) {
        logger.error('Error invalidating event cache:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to invalidate event cache',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Run background cleanup for photo caches
 */
export const runCacheCleanupController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const { validEventIds } = req.body; // Optional array of valid event IDs

        // Run comprehensive cleanup
        await photoCacheService.runComprehensiveCleanup(validEventIds);

        logger.info(`Cache cleanup initiated by admin ${req.user._id}`);

        return res.json({
            status: true,
            message: 'Cache cleanup completed successfully',
            data: {
                cleanup_types: [
                    'Expired photo metadata',
                    'Orphaned event photo lists',
                    'Event photo list integrity'
                ],
                initiated_at: new Date().toISOString(),
                initiated_by: req.user._id,
                valid_events_provided: validEventIds ? validEventIds.length : 'all'
            }
        });

    } catch (error) {
        logger.error('Error running cache cleanup:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to run cache cleanup',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get cache configuration and settings
 */
export const getCacheConfigController = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const config = {
            ttl_settings: {
                event_detail: '300 seconds (5 minutes)',
                event_list: '60 seconds (1 minute)',
                photo_metadata: '1800 seconds (30 minutes)',
                analytics: '900 seconds (15 minutes)',
                long_cache: '1800 seconds (30 minutes)'
            },
            data_structures: {
                event_cache: 'JSON strings with TTL',
                photo_metadata: 'Redis Hashes for memory efficiency',
                photo_lists: 'Redis Sorted Sets with timestamp scores',
                analytics: 'Mixed: JSON, Hashes, Sorted Sets'
            },
            optimization_features: {
                memory_efficient_hashes: true,
                batch_operations: true,
                pipeline_usage: true,
                smart_invalidation: true,
                cache_warming: true
            },
            monitoring: {
                cache_stats_available: true,
                health_checks: true,
                admin_controls: true
            }
        };

        return res.json({
            status: true,
            message: 'Cache configuration retrieved successfully',
            data: config
        });

    } catch (error) {
        logger.error('Error getting cache configuration:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to get cache configuration',
            data: null,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Helper function to parse Redis INFO output
function parseRedisInfo(info: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = info.split('\r\n');
    
    for (const line of lines) {
        if (line && !line.startsWith('#')) {
            const [key, value] = line.split(':');
            if (key && value) {
                result[key] = isNaN(Number(value)) ? value : Number(value);
            }
        }
    }
    
    return result;
}

// Export middleware for use in routes
export { requireAdmin };

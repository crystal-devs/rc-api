// services/cache/analytics-cache.service.ts
// Redis caching for analytics endpoints with optimized data structures

import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';

interface AnalyticsData {
    eventId: string;
    period: string; // '24h', '7d', '30d', '90d', 'all'
    metrics: {
        views: number;
        uploads: number;
        downloads: number;
        participants: number;
        engagement_rate: number;
        peak_activity_hour?: number;
        top_uploaders?: Array<{ userId: string; count: number }>;
        media_breakdown?: {
            images: number;
            videos: number;
            total_size_mb: number;
        };
    };
    generatedAt: Date;
}

interface EventActivity {
    eventId: string;
    userId: string;
    action: 'view' | 'upload' | 'download' | 'join' | 'comment';
    timestamp: Date;
    metadata?: Record<string, any>;
}

export class AnalyticsCacheService {
    private static instance: AnalyticsCacheService;
    private readonly PREFIX = 'analytics_cache:';
    private readonly ANALYTICS_TTL = 900; // 15 minutes for analytics data
    private readonly ACTIVITY_TTL = 3600; // 1 hour for activity logs
    private readonly STATS_TTL = 300; // 5 minutes for quick stats

    private constructor() {}

    public static getInstance(): AnalyticsCacheService {
        if (!AnalyticsCacheService.instance) {
            AnalyticsCacheService.instance = new AnalyticsCacheService();
        }
        return AnalyticsCacheService.instance;
    }

    private getRedis() {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            logger.warn('Redis client not available for analytics caching');
            return null;
        }
        return redis;
    }

    // ============= ANALYTICS DATA CACHING =============

    /**
     * Cache analytics data for an event and period
     */
    async setAnalyticsData(eventId: string, period: string, metrics: string, data: AnalyticsData): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}analytics:${eventId}:${period}:${metrics}`;
            await redis.setEx(key, this.ANALYTICS_TTL, JSON.stringify(data));
            
            logger.debug(`Cached analytics data for event ${eventId}, period ${period}, metrics ${metrics}`);
        } catch (error) {
            logger.error('Error caching analytics data:', error);
        }
    }

    /**
     * Get cached analytics data
     */
    async getAnalyticsData(eventId: string, period: string, metrics: string): Promise<AnalyticsData | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const key = `${this.PREFIX}analytics:${eventId}:${period}:${metrics}`;
            const cached = await redis.get(key);
            
            if (cached) {
                logger.debug(`Cache HIT: Analytics data for event ${eventId}, period ${period}`);
                return JSON.parse(cached as string);
            }
            
            logger.debug(`Cache MISS: Analytics data for event ${eventId}, period ${period}`);
            return null;
        } catch (error) {
            logger.error('Error getting cached analytics data:', error);
            return null;
        }
    }

    // ============= ACTIVITY TRACKING =============

    /**
     * Record activity in Redis sorted set for real-time analytics
     */
    async recordActivity(activity: EventActivity): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();
            
            // Store in sorted set with timestamp as score for time-based queries
            const activityKey = `${this.PREFIX}activity:${activity.eventId}`;
            const activityData = JSON.stringify({
                userId: activity.userId,
                action: activity.action,
                metadata: activity.metadata
            });
            
            pipeline.zAdd(activityKey, {
                score: activity.timestamp.getTime(),
                value: activityData
            });
            
            // Set TTL
            pipeline.expire(activityKey, this.ACTIVITY_TTL);
            
            // Also increment counters for quick stats
            const statsKey = `${this.PREFIX}stats:${activity.eventId}:${activity.action}`;
            pipeline.incr(statsKey);
            pipeline.expire(statsKey, this.STATS_TTL);
            
            await pipeline.exec();
            
            logger.debug(`Recorded activity: ${activity.action} for event ${activity.eventId} by user ${activity.userId}`);
        } catch (error) {
            logger.error('Error recording activity:', error);
        }
    }

    /**
     * Get recent activities for an event
     */
    async getRecentActivities(eventId: string, limit: number = 50, since?: Date): Promise<EventActivity[]> {
        const redis = this.getRedis();
        if (!redis) return [];

        try {
            const key = `${this.PREFIX}activity:${eventId}`;
            const minScore = since ? since.getTime() : '-inf';
            
            // Get activities from sorted set
            const activities = await redis.zRangeByScore(key, minScore, '+inf', {
                LIMIT: { offset: 0, count: limit }
            });
            
            const result: EventActivity[] = activities.map(activityStr => {
                const parsed = JSON.parse(activityStr);
                return {
                    eventId,
                    userId: parsed.userId,
                    action: parsed.action,
                    timestamp: new Date(parsed.timestamp),
                    metadata: parsed.metadata
                };
            });
            
            if (result.length > 0) {
                logger.debug(`Cache HIT: Recent activities for event ${eventId} (${result.length} items)`);
            }
            
            return result;
        } catch (error) {
            logger.error('Error getting recent activities:', error);
            return [];
        }
    }

    // ============= QUICK STATS CACHING =============

    /**
     * Get quick stats counters for an event
     */
    async getQuickStats(eventId: string): Promise<Record<string, number>> {
        const redis = this.getRedis();
        if (!redis) return {};

        try {
            const pattern = `${this.PREFIX}stats:${eventId}:*`;
            const keys = await redis.keys(pattern);
            
            if (keys.length === 0) return {};
            
            const pipeline = redis.multi();
            keys.forEach(key => pipeline.get(key));
            
            const results = await pipeline.exec();
            const stats: Record<string, number> = {};
            
            if (results) {
                results.forEach((res, index) => {
                    if (res && Array.isArray(res) && res[1]) {
                        const action = keys[index].split(':').pop() || 'unknown';
                        stats[action] = parseInt(res[1] as string) || 0;
                    }
                });
            }
            
            logger.debug(`Retrieved quick stats for event ${eventId}:`, stats);
            return stats;
        } catch (error) {
            logger.error('Error getting quick stats:', error);
            return {};
        }
    }

    /**
     * Increment a specific stat counter
     */
    async incrementStat(eventId: string, statName: string, increment: number = 1): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}stats:${eventId}:${statName}`;
            await redis.incrBy(key, increment);
            await redis.expire(key, this.STATS_TTL);
            
            logger.debug(`Incremented ${statName} for event ${eventId} by ${increment}`);
        } catch (error) {
            logger.error('Error incrementing stat:', error);
        }
    }

    // ============= ENGAGEMENT METRICS =============

    /**
     * Cache engagement metrics using Redis Hash
     */
    async setEngagementMetrics(eventId: string, metrics: Record<string, number>): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}engagement:${eventId}`;
            const pipeline = redis.multi();
            
            Object.entries(metrics).forEach(([metric, value]) => {
                pipeline.hSet(key, metric, value.toString());
            });
            
            pipeline.expire(key, this.ANALYTICS_TTL);
            await pipeline.exec();
            
            logger.debug(`Cached engagement metrics for event ${eventId}`);
        } catch (error) {
            logger.error('Error caching engagement metrics:', error);
        }
    }

    /**
     * Get engagement metrics from Redis Hash
     */
    async getEngagementMetrics(eventId: string): Promise<Record<string, number>> {
        const redis = this.getRedis();
        if (!redis) return {};

        try {
            const key = `${this.PREFIX}engagement:${eventId}`;
            const metrics = await redis.hGetAll(key);
            
            const result: Record<string, number> = {};
            Object.entries(metrics).forEach(([metric, value]) => {
                result[metric] = parseFloat(value) || 0;
            });
            
            if (Object.keys(result).length > 0) {
                logger.debug(`Cache HIT: Engagement metrics for event ${eventId}`);
            }
            
            return result;
        } catch (error) {
            logger.error('Error getting engagement metrics:', error);
            return {};
        }
    }

    // ============= CACHE INVALIDATION =============

    /**
     * Invalidate analytics caches for an event
     */
    async invalidateAnalyticsCaches(eventId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const patterns = [
                `${this.PREFIX}analytics:${eventId}:*`,
                `${this.PREFIX}stats:${eventId}:*`,
                `${this.PREFIX}engagement:${eventId}`
            ];

            for (const pattern of patterns) {
                const keys = await redis.keys(pattern);
                if (keys.length > 0) {
                    await Promise.all(keys.map(k => redis.del(k)));
                    logger.debug(`Invalidated ${keys.length} analytics cache keys for pattern: ${pattern}`);
                }
            }

            logger.info(`Invalidated analytics caches for event ${eventId}`);
        } catch (error) {
            logger.error('Error invalidating analytics caches:', error);
        }
    }

    /**
     * Clean up old activity data (keep only recent activities)
     */
    async cleanupOldActivities(eventId: string, keepDays: number = 30): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}activity:${eventId}`;
            const cutoffTime = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
            
            const removedCount = await redis.zRemRangeByScore(key, '-inf', cutoffTime);
            
            if (removedCount > 0) {
                logger.debug(`Cleaned up ${removedCount} old activities for event ${eventId}`);
            }
        } catch (error) {
            logger.error('Error cleaning up old activities:', error);
        }
    }

    // ============= CACHE STATISTICS =============

    /**
     * Get analytics cache statistics
     */
    async getAnalyticsCacheStats(): Promise<any> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const analyticsKeys = await redis.keys(`${this.PREFIX}analytics:*`);
            const activityKeys = await redis.keys(`${this.PREFIX}activity:*`);
            const statsKeys = await redis.keys(`${this.PREFIX}stats:*`);
            const engagementKeys = await redis.keys(`${this.PREFIX}engagement:*`);
            
            return {
                total_analytics_cache: analyticsKeys.length,
                total_activity_logs: activityKeys.length,
                total_stat_counters: statsKeys.length,
                total_engagement_metrics: engagementKeys.length,
                total_keys: analyticsKeys.length + activityKeys.length + statsKeys.length + engagementKeys.length
            };
        } catch (error) {
            logger.error('Error getting analytics cache stats:', error);
            return null;
        }
    }

    /**
     * Clear all analytics caches
     */
    async clearAllAnalyticsCaches(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            if (keys.length > 0) {
                await Promise.all(keys.map(k => redis.del(k)));
                logger.info(`Cleared ${keys.length} analytics cache keys`);
            }
        } catch (error) {
            logger.error('Error clearing all analytics caches:', error);
        }
    }
}

// Export singleton instance
export const analyticsCacheService = AnalyticsCacheService.getInstance();

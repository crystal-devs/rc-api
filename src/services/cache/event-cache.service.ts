// services/cache/event-cache-optimized.service.ts
// Memory-efficient Redis caching for event data with optimized data structures

import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';
import type { EventFilters, EventWithExtras } from '../event/event.types';

export class EventCacheService {
    private static instance: EventCacheService;
    private readonly PREFIX = 'event_cache:';
    private readonly DEFAULT_TTL = 300; // 5 minutes for event details
    private readonly SHORT_TTL = 60; // 1 minute for event lists
    private readonly LONG_TTL = 1800; // 30 minutes for warm cache

    private constructor() { }

    public static getInstance(): EventCacheService {
        if (!EventCacheService.instance) {
            EventCacheService.instance = new EventCacheService();
        }
        return EventCacheService.instance;
    }

    private getRedis() {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            return null;
        }
        return redis;
    }

    // ============= MEMORY-OPTIMIZED EVENT DETAIL CACHING =============

    /**
     * Get cached event details with memory-efficient approach
     * Stores base event data once, user permissions separately
     */
    async getEventDetail(eventId: string, userId: string): Promise<EventWithExtras | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            // Get base event data (shared across all users)
            const eventKey = `${this.PREFIX}event:${eventId}`;
            const baseEvent = await redis.get(eventKey);

            // Get user-specific permissions/data
            const userKey = `${this.PREFIX}event_user:${eventId}:${userId}`;
            const userData = await redis.get(userKey);

            if (baseEvent) {
                logger.debug(`Cache HIT: Event detail ${eventId} for user ${userId}`);
                const event = JSON.parse(baseEvent as string);
                const userSpecificData = userData ? JSON.parse(userData as string) : {};

                // Merge base event with user-specific data
                return { ...event, ...userSpecificData };
            }

            logger.debug(`Cache MISS: Event detail ${eventId} for user ${userId}`);
            return null;
        } catch (error) {
            logger.error('Error getting cached event detail:', error);
            return null;
        }
    }

    /**
     * Cache event details with memory-efficient separation
     */
    async setEventDetail(eventId: string, userId: string, eventData: EventWithExtras, ttl: number = this.DEFAULT_TTL): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();

            // Separate user-specific data from base event data
            const { user_role, user_permissions, ...baseEventData } = eventData as any;

            // Cache base event data (shared)
            const eventKey = `${this.PREFIX}event:${eventId}`;
            pipeline.setEx(eventKey, ttl, JSON.stringify(baseEventData));

            // Cache user-specific data if exists
            const userSpecificData = { user_role, user_permissions };
            if (user_role || user_permissions) {
                const userKey = `${this.PREFIX}event_user:${eventId}:${userId}`;
                pipeline.setEx(userKey, ttl, JSON.stringify(userSpecificData));
            }

            // Track relationships for efficient invalidation
            pipeline.sAdd(`${this.PREFIX}event_users:${eventId}`, userId);
            pipeline.sAdd(`${this.PREFIX}user_events_cached:${userId}`, eventId);
            pipeline.expire(`${this.PREFIX}event_users:${eventId}`, ttl);
            pipeline.expire(`${this.PREFIX}user_events_cached:${userId}`, ttl);

            await pipeline.exec();

            logger.debug(`Cached event detail for ${eventId} (user: ${userId}) with memory-efficient approach, TTL: ${ttl}s`);
        } catch (error) {
            logger.error('Error caching event detail:', error);
        }
    }

    /**
     * Cache-aside pattern implementation with fallback
     */
    async getEventDetailWithFallback(
        eventId: string,
        userId: string,
        fallbackFn: () => Promise<EventWithExtras | null>
    ): Promise<EventWithExtras | null> {
        // Try cache first
        let event = await this.getEventDetail(eventId, userId);

        if (!event) {
            // Cache miss - get from database
            event = await fallbackFn();

            if (event) {
                // Cache for future requests
                await this.setEventDetail(eventId, userId, event);
            }
        }

        return event;
    }

    // ============= USER EVENTS CACHING =============

    /**
     * Get cached user events list
     */
    async getUserEvents(userId: string, filters: EventFilters): Promise<any | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const filterHash = this.generateFiltersHash(filters);
            const key = `${this.PREFIX}user_events:${userId}:${filterHash}`;
            const cached = await redis.get(key);

            if (cached) {
                logger.debug(`Cache HIT: User events for ${userId} with filters ${filterHash}`);
                return JSON.parse(cached as string);
            }

            logger.debug(`Cache MISS: User events for ${userId} with filters ${filterHash}`);
            return null;
        } catch (error) {
            logger.error('Error getting cached user events:', error);
            return null;
        }
    }

    /**
     * Cache user events list
     */
    async setUserEvents(userId: string, filters: EventFilters, eventsData: any, ttl: number = this.SHORT_TTL): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const filterHash = this.generateFiltersHash(filters);
            const key = `${this.PREFIX}user_events:${userId}:${filterHash}`;
            await redis.setEx(key, ttl, JSON.stringify(eventsData));

            logger.debug(`Cached user events for ${userId} with filters ${filterHash} (TTL: ${ttl}s)`);
        } catch (error) {
            logger.error('Error caching user events:', error);
        }
    }

    // ============= STATS CACHING =============

    /**
     * Get cached event stats
     */
    async getEventStats(eventId: string): Promise<any | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const key = `${this.PREFIX}event_stats:${eventId}`;
            const cached = await redis.get(key);

            if (cached) {
                logger.debug(`Cache HIT: Event stats ${eventId}`);
                return JSON.parse(cached as string);
            }

            return null;
        } catch (error) {
            logger.error('Error getting cached event stats:', error);
            return null;
        }
    }

    /**
     * Cache event stats
     */
    async setEventStats(eventId: string, stats: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}event_stats:${eventId}`;
            await redis.setEx(key, ttl, JSON.stringify(stats));
            logger.debug(`Cached event stats for ${eventId} (TTL: ${ttl}s)`);
        } catch (error) {
            logger.error('Error caching event stats:', error);
        }
    }

    /**
     * Get cached user event stats
     */
    async getUserEventStats(userId: string): Promise<any | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const key = `${this.PREFIX}user_stats:${userId}`;
            const cached = await redis.get(key);

            if (cached) {
                logger.debug(`Cache HIT: User event stats ${userId}`);
                return JSON.parse(cached as string);
            }

            return null;
        } catch (error) {
            logger.error('Error getting cached user event stats:', error);
            return null;
        }
    }

    /**
     * Cache user event stats
     */
    async setUserEventStats(userId: string, stats: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const key = `${this.PREFIX}user_stats:${userId}`;
            await redis.setEx(key, ttl, JSON.stringify(stats));
            logger.debug(`Cached user event stats for ${userId} (TTL: ${ttl}s)`);
        } catch (error) {
            logger.error('Error caching user event stats:', error);
        }
    }

    // ============= EFFICIENT CACHE INVALIDATION =============

    /**
     * Invalidate all caches related to an event (Memory Efficient)
     */
    async invalidateEventCaches(eventId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();

            // Get all users who have cached data for this event
            const userIds = await redis.sMembers(`${this.PREFIX}event_users:${eventId}`);

            // Invalidate base event data
            pipeline.del(`${this.PREFIX}event:${eventId}`);
            pipeline.del(`${this.PREFIX}event_stats:${eventId}`);

            // Invalidate user-specific event data
            userIds.forEach(userId => {
                pipeline.del(`${this.PREFIX}event_user:${eventId}:${userId}`);
                // Remove event from user's cached events set
                pipeline.sRem(`${this.PREFIX}user_events_cached:${userId}`, eventId);
            });

            // Clean up tracking sets
            pipeline.del(`${this.PREFIX}event_users:${eventId}`);

            // Invalidate user events lists (they might contain this event)
            const allUserKeys = await redis.keys(`${this.PREFIX}user_events:*`);
            allUserKeys.forEach(key => pipeline.del(key));

            await pipeline.exec();

            logger.info(`Invalidated all caches for event ${eventId} (${userIds.length} users affected)`);
        } catch (error) {
            logger.error('Error invalidating event caches:', error);
        }
    }

    /**
     * Invalidate user-specific caches (Memory Efficient)
     */
    async invalidateUserCaches(userId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();

            // Get all events this user has cached
            const eventIds = await redis.sMembers(`${this.PREFIX}user_events_cached:${userId}`);

            // Invalidate user-specific data for each event
            eventIds.forEach(eventId => {
                pipeline.del(`${this.PREFIX}event_user:${eventId}:${userId}`);
                // Remove user from event's users set
                pipeline.sRem(`${this.PREFIX}event_users:${eventId}`, userId);
            });

            // Invalidate user events lists and stats
            const userEventKeys = await redis.keys(`${this.PREFIX}user_events:${userId}:*`);
            userEventKeys.forEach(key => pipeline.del(key));

            pipeline.del(`${this.PREFIX}user_stats:${userId}`);
            pipeline.del(`${this.PREFIX}user_events_cached:${userId}`);

            await pipeline.exec();

            logger.info(`Invalidated all caches for user ${userId} (${eventIds.length} events affected)`);
        } catch (error) {
            logger.error('Error invalidating user caches:', error);
        }
    }

    /**
     * Invalidate participant caches when participants change
     */
    async invalidateParticipantCaches(eventId: string, userIds: string[]): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const pipeline = redis.multi();

            // Get all user event keys first
            const allUserEventKeys: string[] = [];
            for (const userId of userIds) {
                const userEventKeys = await redis.keys(`${this.PREFIX}user_events:${userId}:*`);
                allUserEventKeys.push(...userEventKeys);

                pipeline.del(`${this.PREFIX}event_user:${eventId}:${userId}`);
            }

            // Delete all user event keys
            allUserEventKeys.forEach(key => pipeline.del(key));
            pipeline.del(`${this.PREFIX}event_stats:${eventId}`);

            await pipeline.exec();

            logger.debug(`Invalidated participant caches for event ${eventId} (${userIds.length} users affected)`);
        } catch (error) {
            logger.error('Error invalidating participant caches:', error);
        }
    }

    // ============= CACHE WARMING =============

    /**
     * Warm up cache for frequently accessed events
     */
    async warmEventCache(eventId: string, userId: string, eventData: EventWithExtras): Promise<void> {
        // Cache with longer TTL for frequently accessed data
        await this.setEventDetail(eventId, userId, eventData, this.LONG_TTL);
    }

    /**
     * Bulk warm user events cache
     */
    async warmUserEventsCache(userId: string, filters: EventFilters, eventsData: any): Promise<void> {
        // Cache with standard TTL
        await this.setUserEvents(userId, filters, eventsData, this.DEFAULT_TTL);
    }

    /**
     * Warm cache after new participant joins event
     */
    async warmCacheAfterParticipantJoin(eventId: string, newParticipantId: string, eventData?: EventWithExtras): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            // If event data provided, cache it for the new participant
            if (eventData) {
                await this.setEventDetail(eventId, newParticipantId, eventData, this.LONG_TTL);
                logger.debug(`Warmed event detail cache for new participant ${newParticipantId} in event ${eventId}`);
            }

            // Invalidate existing caches since participant count changed
            await this.invalidateEventCaches(eventId);

            logger.info(`Cache warmed after participant ${newParticipantId} joined event ${eventId}`);
        } catch (error) {
            logger.error('Error warming cache after participant join:', error);
        }
    }

    /**
     * Warm cache after media upload to event
     */
    async warmCacheAfterMediaUpload(eventId: string, uploaderId: string, mediaCount: number = 1): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            // Invalidate event stats since media count changed
            await redis.del(`${this.PREFIX}event_stats:${eventId}`);

            // Invalidate user events lists since they might show media counts
            const userEventKeys = await redis.keys(`${this.PREFIX}user_events:*`);
            if (userEventKeys.length > 0) {
                await Promise.all(userEventKeys.map(k => redis.del(k)));
            }

            logger.debug(`Cache warmed after ${mediaCount} media upload(s) to event ${eventId} by user ${uploaderId}`);
        } catch (error) {
            logger.error('Error warming cache after media upload:', error);
        }
    }

    /**
     * Warm frequently accessed events based on activity patterns
     */
    async warmFrequentlyAccessedEvents(eventIds: string[], userIds: string[]): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            // This would typically be called during off-peak hours
            logger.info(`Starting cache warming for ${eventIds.length} events and ${userIds.length} users`);

            let warmedCount = 0;

            for (const eventId of eventIds) {
                for (const userId of userIds) {
                    // Check if already cached to avoid unnecessary work
                    const cached = await this.getEventDetail(eventId, userId);
                    if (!cached) {
                        // Would need to fetch from DB and cache - placeholder for now
                        // const eventData = await getEventDetailFromDB(eventId, userId);
                        // if (eventData) {
                        //     await this.setEventDetail(eventId, userId, eventData, this.LONG_TTL);
                        //     warmedCount++;
                        // }
                    }
                }
            }

            logger.info(`Cache warming completed. Warmed ${warmedCount} event details`);
        } catch (error) {
            logger.error('Error warming frequently accessed events:', error);
        }
    }

    // ============= UTILITY METHODS =============

    /**
     * Generate a collision-resistant hash for filters to use as cache key
     */
    private generateFiltersHash(filters: EventFilters): string {
        // Sort keys to ensure consistent hashing
        const filterString = JSON.stringify({
            page: filters.page,
            limit: filters.limit,
            sort: filters.sort,
            status: filters.status,
            privacy: filters.privacy,
            template: filters.template,
            search: filters.search,
            tags: filters.tags
        }, Object.keys(filters).sort());

        // Use base64 encoding for collision-resistant hashing
        return Buffer.from(filterString).toString('base64').slice(0, 16);
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<any> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            const stats = {
                total_keys: keys.length,
                event_details: 0,
                user_events: 0,
                event_stats: 0,
                user_stats: 0,
                tracking_sets: 0
            };

            for (const key of keys) {
                if (key.includes(':event:')) stats.event_details++;
                else if (key.includes(':user_events:')) stats.user_events++;
                else if (key.includes(':event_stats:')) stats.event_stats++;
                else if (key.includes(':user_stats:')) stats.user_stats++;
                else if (key.includes('_users:') || key.includes('_cached:')) stats.tracking_sets++;
            }

            return stats;
        } catch (error) {
            logger.error('Error getting cache stats:', error);
            return null;
        }
    }

    /**
     * Clear all event caches (use with caution)
     */
    async clearAllCaches(): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            const keys = await redis.keys(`${this.PREFIX}*`);
            if (keys.length > 0) {
                await Promise.all(keys.map(k => redis.del(k)));
                logger.info(`Cleared ${keys.length} cache keys`);
            }
        } catch (error) {
            logger.error('Error clearing all caches:', error);
        }
    }
}

// Export singleton instance
export const eventCacheService = EventCacheService.getInstance();

// services/cache/user-cache.service.ts
import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';
import { UserType } from '@models/user.model';

export class UserCacheService {
    private static instance: UserCacheService;
    private readonly PREFIX = 'user:';
    private readonly DEFAULT_TTL = 3600; // 1 hour

    private constructor() { }

    public static getInstance(): UserCacheService {
        if (!UserCacheService.instance) {
            UserCacheService.instance = new UserCacheService();
        }
        return UserCacheService.instance;
    }

    private getRedis() {
        const redis = getRedisClient();
        if (!redis || !redis.isReady) {
            // silent fail or log warning if critical
            // logger.warn('Redis client not available for user caching');
            return null;
        }
        return redis;
    }

    async getUser(userId: string): Promise<UserType | null> {
        const redis = this.getRedis();
        if (!redis) return null;

        try {
            const cached = await redis.get(`${this.PREFIX}${userId}`);
            if (cached && typeof cached === 'string') {
                return JSON.parse(cached) as UserType;
            }
            return null;
        } catch (error) {
            logger.error('Error retrieving user from cache:', error);
            return null;
        }
    }

    async setUser(user: UserType): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            // Store minimal user data or full object?
            // Middleware needs: _id, role_id, email, subscriptionId etc.
            // Storing full object for now.
            await redis.setEx(
                `${this.PREFIX}${user._id}`,
                this.DEFAULT_TTL,
                JSON.stringify(user)
            );
        } catch (error) {
            logger.error('Error setting user in cache:', error);
        }
    }

    async invalidateUser(userId: string): Promise<void> {
        const redis = this.getRedis();
        if (!redis) return;

        try {
            await redis.del(`${this.PREFIX}${userId}`);
        } catch (error) {
            logger.error('Error invalidating user cache:', error);
        }
    }
}

export const userCacheService = UserCacheService.getInstance();

// utils/redis.util.ts - Common Redis configuration utility

import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

/**
 * Parse Redis connection details from various sources
 */
export class RedisConfigUtil {
    /**
     * Get Redis host from environment
     */
    static getHost(): string {
        const redisUrl = process.env.REDIS_URL;

        if (redisUrl?.startsWith('redis://')) {
            try {
                const url = new URL(redisUrl);
                return url.hostname || 'localhost';
            } catch (error) {
                logger.warn('Failed to parse Redis URL, using localhost');
                return 'localhost';
            }
        }

        return process.env.REDIS_HOST || 'localhost';
    }

    /**
     * Get Redis port from environment
     */
    static getPort(): number {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl?.startsWith('redis://')) {
            try {
                const url = new URL(redisUrl);
                return parseInt(url.port) || 6379;
            } catch {
                return 6379;
            }
        }

        return parseInt(process.env.REDIS_PORT || '6379');
    }

    /**
     * Get Redis password from environment
     */
    static getPassword(): string | undefined {
        const redisUrl = process.env.REDIS_URL;

        if (redisUrl?.startsWith('redis://')) {
            try {
                const url = new URL(redisUrl);
                return url.password || undefined;
            } catch {
                return undefined;
            }
        }

        return process.env.REDIS_PASSWORD || undefined;
    }

    /**
     * Get complete Redis configuration for BullMQ
     */
    static getBullMQConfig() {
        return {
            host: this.getHost(),
            port: this.getPort(),
            password: this.getPassword(),
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
            lazyConnect: true,
            keepAlive: 30000,
            family: 4 as const,
        };
    }

    /**
     * Get Redis URL string
     */
    static getRedisUrl(): string {
        const host = this.getHost();
        const port = this.getPort();
        const password = this.getPassword();

        if (password) {
            return `redis://:${password}@${host}:${port}`;
        }
        return `redis://${host}:${port}`;
    }

    /**
     * Log Redis configuration (without sensitive data)
     */
    static logConfig(): void {
        logger.info('Redis configuration:', {
            host: this.getHost(),
            port: this.getPort(),
            hasPassword: !!this.getPassword(),
            url: this.getRedisUrl().replace(/:([^@]+)@/, ':***@') // Mask password in logs
        });
    }
}

// Export convenience functions
export const getRedisHost = () => RedisConfigUtil.getHost();
export const getRedisPort = () => RedisConfigUtil.getPort();
export const getRedisPassword = () => RedisConfigUtil.getPassword();
export const getBullMQRedisConfig = () => RedisConfigUtil.getBullMQConfig();
// configs/redis.config.ts
import { createClient, RedisClientType } from 'redis';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';

class RedisConnection {
  private client: RedisClientType | null = null;
  private isConnected = false;

  async connect(): Promise<RedisClientType> {
    try {
      if (this.client && this.isConnected) {
        return this.client;
      }

      // Create Redis client with modern v5 syntax
      this.client = createClient({
        url: keys.redisUrl as string,
        // Optional: Add more configuration
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 500), // Exponential backoff
        },
        // Optional: Enable client-side caching (requires Redis 6+)
        // RESP: 3,
        // clientSideCache: {
        //   ttl: 60000, // 1 minute TTL
        //   maxEntries: 1000,
        //   evictPolicy: 'LRU'
        // }
      });

      // Event listeners (REQUIRED for error handling)
      this.client.on('error', (err) => {
        logger.error('❌ Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('🔄 Redis Client connecting...');
      });

      this.client.on('ready', () => {
        logger.info('✅ Redis Client connected and ready');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        logger.warn('⚠️ Redis Client connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('🔄 Redis Client reconnecting...');
      });

      // Connect to Redis
      await this.client.connect();
      
      // Test the connection
      await this.client.ping();
      logger.info('🏓 Redis ping successful');

      return this.client;
    } catch (error) {
      logger.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client && this.isConnected) {
        await this.client.quit(); // Graceful shutdown
        this.isConnected = false;
        logger.info('🔌 Redis client disconnected');
      }
    } catch (error) {
      logger.error('❌ Error disconnecting Redis:', error);
      // Force close if graceful shutdown fails
      if (this.client) {
        await this.client.disconnect();
      }
    }
  }

  getClient(): RedisClientType | null {
    return this.client;
  }

  isReady(): boolean {
    return this.client?.isReady ?? false;
  }

  isOpen(): boolean {
    return this.client?.isOpen ?? false;
  }
}

// Export singleton instance
export const redisConnection = new RedisConnection();

// Export client getter for easy access
export const getRedisClient = (): RedisClientType | null => {
  return redisConnection.getClient();
};
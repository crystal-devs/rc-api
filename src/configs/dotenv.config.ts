import dotenv from 'dotenv';
import { logger } from '@utils/logger';

dotenv.config();

// Helper function to build Redis URL from separate credentials
const buildRedisUrl = (): string => {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;
  
  // Build Redis URL based on available credentials
  if (password) {
    // Format: redis://:password@host:port
    return `redis://:${password}@${host}:${port}`;
  } else {
    // Format: redis://host:port (no password)
    return `redis://${host}:${port}`;
  }
};

export const keys: Record<string, string | number | string[]> = {
  port: process.env.PORT ? Number(process.env.PORT) : 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoURI: process.env.MONGO_URI,
  mongoDBName: process.env.MONGO_DB_NAME,
  APILiveVersion: process.env.VERSION,
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [],
  jwtSecret: process.env.JWT_SECRET,
  
  // Redis configuration - Use URL if provided, otherwise build from separate credentials
  redisUrl: process.env.REDIS_URL || buildRedisUrl(),
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  redisPassword: process.env.REDIS_PASSWORD || undefined,
};

// Validate environment variables
const requiredKeys = ['port', 'mongoURI', 'mongoDBName', 'APILiveVersion'];
const missingKeys = requiredKeys.filter((key) => !keys[key]);

// Check if Redis configuration is available (either URL or host/port)
const hasRedisConfig = keys.redisUrl || (keys.redisHost && keys.redisPort);
if (!hasRedisConfig) {
  logger.error('❌ Redis configuration missing: Provide either REDIS_URL or REDIS_HOST/REDIS_PORT');
  process.exit(1);
}

if (missingKeys.length) {
  logger.error(`❌ Missing required environment variables: ${missingKeys.join(', ')}`);
  process.exit(1);
}

// Secure Logging
logger.info('✅ Environment Variables Loaded:');
requiredKeys.forEach((key) => {
  const value = key.includes('mongo') || key === 'redisUrl' ? '***HIDDEN***' : keys[key];
  logger.info(`   - ${key}: ${value}`);
});

// Log Redis connection info (without sensitive data)
const redisInfo = keys.redisPassword 
  ? `${keys.redisHost}:${keys.redisPort} (with auth)`
  : `${keys.redisHost}:${keys.redisPort} (no auth)`;
logger.info(`🔴 Redis Connection: ${redisInfo}`);
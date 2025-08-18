// configs/dotenv.config.ts
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
  
  // 🚀 Server Configuration
  port: process.env.PORT ? Number(process.env.PORT) : 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  APILiveVersion: process.env.VERSION || 'v1',
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [],
  
  // 🔐 Security
  jwtSecret: process.env.JWT_SECRET || '',
  
  // 📊 MongoDB Configuration
  mongoURI: process.env.MONGO_URI || '',
  mongoDBName: process.env.MONGO_DB_NAME || '',
  
  // 📈 MongoDB Connection Pool Settings (with defaults)
  mongoMaxPoolSize: process.env.MONGO_MAX_POOL_SIZE 
    ? Number(process.env.MONGO_MAX_POOL_SIZE) 
    : (process.env.NODE_ENV === 'production' ? 50 : 10),
  mongoMinPoolSize: process.env.MONGO_MIN_POOL_SIZE 
    ? Number(process.env.MONGO_MIN_POOL_SIZE) 
    : (process.env.NODE_ENV === 'production' ? 5 : 2),
  mongoMaxIdleTimeMS: process.env.MONGO_MAX_IDLE_TIME_MS 
    ? Number(process.env.MONGO_MAX_IDLE_TIME_MS) 
    : 30000,
  mongoServerSelectionTimeoutMS: process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS 
    ? Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) 
    : 10000,
  mongoSocketTimeoutMS: process.env.MONGO_SOCKET_TIMEOUT_MS 
    ? Number(process.env.MONGO_SOCKET_TIMEOUT_MS) 
    : 45000,
  mongoConnectTimeoutMS: process.env.MONGO_CONNECT_TIMEOUT_MS 
    ? Number(process.env.MONGO_CONNECT_TIMEOUT_MS) 
    : 10000,
  
  // 🔴 Redis Configuration
  redisUrl: process.env.REDIS_URL || buildRedisUrl(),
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  redisPassword: process.env.REDIS_PASSWORD || undefined,
};

// Validate environment variables
const requiredKeys = ['mongoURI', 'mongoDBName', 'jwtSecret'];
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

// 🔒 Secure Logging (hide sensitive information)
logger.info('✅ Environment Variables Loaded:');
logger.info(`   - NODE_ENV: ${keys.nodeEnv}`);
logger.info(`   - PORT: ${keys.port}`);
logger.info(`   - API_VERSION: ${keys.APILiveVersion}`);
logger.info(`   - MONGO_URI: ***HIDDEN***`);
logger.info(`   - MONGO_DB_NAME: ${keys.mongoDBName}`);
logger.info(`   - JWT_SECRET: ***HIDDEN***`);

// 📊 Log MongoDB Pool Configuration
logger.info('📊 MongoDB Pool Configuration:');
logger.info(`   - Max Pool Size: ${keys.mongoMaxPoolSize}`);
logger.info(`   - Min Pool Size: ${keys.mongoMinPoolSize}`);
logger.info(`   - Max Idle Time: ${keys.mongoMaxIdleTimeMS}ms`);
logger.info(`   - Socket Timeout: ${keys.mongoSocketTimeoutMS}ms`);

// Log Redis connection info (without sensitive data)
const redisInfo = keys.redisPassword 
  ? `${keys.redisHost}:${keys.redisPort} (with auth)`
  : `${keys.redisHost}:${keys.redisPort} (no auth)`;
logger.info(`🔴 Redis Connection: ${redisInfo}`);
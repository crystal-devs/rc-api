// configs/database.config.ts
import mongoose from "mongoose";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";

/**
 * 🏗️ MongoDB Connection Pool Configuration
 * Industry-standard connection pooling with performance optimizations
 */
interface DatabaseConfig {
  uri: string;
  options: mongoose.ConnectOptions;
}

/**
 * 📊 Connection Pool Settings
 * Optimized for high-performance real-time applications
 */
const getDatabaseConfig = (): DatabaseConfig => {
  const mongoURI = `${keys.mongoURI}${keys.mongoDBName}`;

  const options: mongoose.ConnectOptions = {
    // 🏊‍♂️ Connection Pool Configuration
    maxPoolSize: keys.nodeEnv === 'production' ? 50 : 10, // Max connections in pool
    minPoolSize: keys.nodeEnv === 'production' ? 5 : 2,   // Min connections maintained
    maxIdleTimeMS: 30000,     // Close connection after 30s idle
    serverSelectionTimeoutMS: 10000, // Wait 10s for server selection
    socketTimeoutMS: 45000,   // Close socket after 45s inactivity
    
    // 🔄 Connection Management
    connectTimeoutMS: 10000,  // Time to wait for initial connection
    heartbeatFrequencyMS: 10000, // Heartbeat frequency
    
    // 📈 Performance Optimizations
    // Note: bufferMaxEntries and bufferCommands are Mongoose schema options, not connection options
    
    // 🛡️ Reliability & Error Handling
    retryWrites: true,        // Auto-retry failed writes
    retryReads: true,         // Auto-retry failed reads
    
    // 📝 Additional Options for Real-time Applications
    compressors: 'snappy,zlib', // Enable compression
    readPreference: 'primary', // Ensure consistency for real-time updates
    writeConcern: {
      w: 'majority',          // Wait for majority acknowledgment
      j: true,                // Wait for journal acknowledgment
      wtimeout: 10000         // Timeout after 10s
    },
    readConcern: {
      level: 'majority'       // Read from majority of replica set
    }
  };

  return { uri: mongoURI, options };
};

/**
 * 🔌 Enhanced MongoDB Connection Manager
 * Handles connection lifecycle with comprehensive error handling
 */
class DatabaseConnection {
  private static instance: DatabaseConnection;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /**
   * 🚀 Initialize database connection with connection pooling
   */
  async connect(): Promise<void> {
    try {
      if (this.isConnected) {
        logger.info('📊 MongoDB already connected');
        return;
      }

      const config = getDatabaseConfig();
      
      // 📈 Set up connection event listeners
      this.setupEventListeners();
      
      logger.info('🔄 Connecting to MongoDB with connection pooling...');
      logger.info(`📊 Pool Config: Max=${config.options.maxPoolSize}, Min=${config.options.minPoolSize}`);
      
      await mongoose.connect(config.uri, config.options);
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // 📊 Log connection success with pool info
      const dbName = mongoose.connection.db?.databaseName;
      const host = mongoose.connection.host;
      const port = mongoose.connection.port;
      
      logger.info('✅ MongoDB Connected Successfully:');
      logger.info(`   - Database: ${dbName}`);
      logger.info(`   - Host: ${host}:${port}`);
      logger.info(`   - Pool Size: ${config.options.maxPoolSize} max, ${config.options.minPoolSize} min`);
      logger.info(`   - Environment: ${keys.nodeEnv}`);
      
    } catch (error) {
      logger.error('❌ MongoDB connection failed:', error);
      await this.handleConnectionError();
      throw error;
    }
  }

  /**
   * 🎯 Set up comprehensive event listeners
   */
  private setupEventListeners(): void {
    const connection = mongoose.connection;

    // ✅ Connection established
    connection.on('connected', () => {
      logger.info('🔗 MongoDB connected to database');
    });

    // 🔌 Connection opened (ready to use)
    connection.on('open', () => {
      logger.info('📂 MongoDB connection opened');
      this.isConnected = true;
    });

    // ⚠️ Connection disconnected
    connection.on('disconnected', () => {
      logger.warn('🔌 MongoDB disconnected');
      this.isConnected = false;
    });

    // 🔄 Attempting to reconnect
    connection.on('reconnected', () => {
      logger.info('🔄 MongoDB reconnected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    // ❌ Connection error
    connection.on('error', (error) => {
      logger.error('❌ MongoDB connection error:', error);
      this.isConnected = false;
      this.handleConnectionError();
    });

    // 🔒 Connection closed
    connection.on('close', () => {
      logger.info('🔒 MongoDB connection closed');
      this.isConnected = false;
    });

    // 📊 Monitor connection pool events (if available)
    connection.on('serverHeartbeatSucceeded', (event) => {
      logger.debug(`💓 Server heartbeat succeeded: ${event.connectionId}`);
    });

    connection.on('serverHeartbeatFailed', (event) => {
      logger.warn(`💔 Server heartbeat failed: ${event.connectionId}`, event.failure);
    });
  }

  /**
   * 🛠️ Handle connection errors with retry logic
   */
  private async handleConnectionError(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping retry.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
    
    logger.warn(`🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('❌ Reconnection attempt failed:', error);
      }
    }, delay);
  }

  /**
   * 🔌 Graceful disconnect
   */
  async disconnect(): Promise<void> {
    try {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      if (this.isConnected) {
        logger.info('🔌 Closing MongoDB connection...');
        await mongoose.connection.close();
        this.isConnected = false;
        logger.info('✅ MongoDB connection closed gracefully');
      }
    } catch (error) {
      logger.error('❌ Error during MongoDB disconnect:', error);
      throw error;
    }
  }

  /**
   * 📊 Get connection status and statistics
   */
  getConnectionInfo() {
    const connection = mongoose.connection;
    return {
      isConnected: this.isConnected,
      readyState: connection.readyState,
      host: connection.host,
      port: connection.port,
      name: connection.name,
      // Connection states: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
      readyStateText: this.getReadyStateText(connection.readyState),
      reconnectAttempts: this.reconnectAttempts,
      uptime: process.uptime()
    };
  }

  /**
   * 🔤 Get readable connection state
   */
  private getReadyStateText(state: number): string {
    const states = {
      0: 'disconnected',
      1: 'connected', 
      2: 'connecting',
      3: 'disconnecting'
    };
    return states[state as keyof typeof states] || 'unknown';
  }

  /**
   * 🏥 Health check for monitoring systems
   */
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      if (!this.isConnected) {
        return { status: 'unhealthy', details: { error: 'Not connected' } };
      }

      // Simple ping to verify connection
      await mongoose.connection.db?.admin().ping();
      
      return {
        status: 'healthy',
        details: this.getConnectionInfo()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }
}

// 🏭 Factory function for easy usage
export const connectToMongoDB = async (): Promise<void> => {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
};

// 🔌 Graceful disconnect function
export const disconnectFromMongoDB = async (): Promise<void> => {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.disconnect();
};

// 📊 Export connection info getter
export const getDBConnectionInfo = () => {
  const dbConnection = DatabaseConnection.getInstance();
  return dbConnection.getConnectionInfo();
};

// 🏥 Export health check
export const checkDBHealth = async () => {
  const dbConnection = DatabaseConnection.getInstance();
  return await dbConnection.healthCheck();
};

/**
 * 📈 Connection Pool Monitoring (Optional)
 * Add this to your monitoring/health check endpoints
 */
export const logConnectionPoolStats = (): void => {
  const info = getDBConnectionInfo();
  logger.info('📊 MongoDB Connection Status:', {
    connected: info.isConnected,
    readyState: `${info.readyState} (${info.readyStateText})`,
    host: `${info.host}:${info.port}`,
    database: info.name,
    reconnectAttempts: info.reconnectAttempts,
    uptime: `${Math.floor(info.uptime / 60)}m ${Math.floor(info.uptime % 60)}s`
  });
};

// Export singleton instance for direct access if needed
export const dbConnection = DatabaseConnection.getInstance();
// Updated index.ts with image queue integration

import { connectToMongoDB } from "@configs/database.config";
import { keys } from "@configs/dotenv.config";
import { corsOptions, rateLimiter, securityHeaders } from "@configs/security.config";
import { gracefulShutdown } from "@configs/shutdown.config";
import { globalErrorHandler } from "@middlewares/error-handler.middleware";
import { logGojo } from "@utils/gojo-satoru";
import { logger, morganMiddleware } from "@utils/logger";
import { createDefaultPlans } from "@models/subscription-plan.model";

// WebSocket imports
import { initializeWebSocketService } from "@services/websocket.service";

// Image processing imports

import { redisConnection } from "@configs/redis.config";

// Route imports
import authRouter from "@routes/auth-router";
import systemRouter from "@routes/system.route";
import eventRouter from "@routes/event.router";
import mediaRouter from "@routes/media.router";
import userRouter from "@routes/user.router";
import albumRouter from "@routes/album.router";
import shareTokenRouter from "@routes/share-token.router";

// Packages
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import http from "http";
import mongoose from "mongoose";
import { getImageQueue, initializeImageQueue } from "queues/imageQueue";
import { getImageWorker, initializeImageWorker } from "workers/imageWorker";

const app = express();
const PORT = keys.port;
const VERSION = keys.APILiveVersion;

// Middlewares
app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(securityHeaders);
app.use(rateLimiter);
app.use(cors(corsOptions));
app.use(morganMiddleware);

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket service IMMEDIATELY after server creation
let webSocketService: any = null;
try {
  webSocketService = initializeWebSocketService(server);
  logger.info("🔌 WebSocket service initialized successfully");
} catch (wsError) {
  logger.error("❌ WebSocket initialization failed:", wsError);
  logger.warn("⚠️ Continuing without WebSocket real-time features");
}

// Express routes
app.use("/system", systemRouter);
app.use(`/api/${VERSION}/auth`, authRouter);
app.use(`/api/${VERSION}/event`, eventRouter);
app.use(`/api/${VERSION}/album`, albumRouter);
app.use(`/api/${VERSION}/media`, mediaRouter);
app.use(`/api/${VERSION}/user`, userRouter);
app.use(`/api/${VERSION}/token`, shareTokenRouter);

connectToMongoDB().then(async () => {
  await createDefaultPlans();
  
  // Initialize image processing system
  try {
    logger.info('🖼️ Initializing image processing system...');
    
    // Initialize Redis connection first
    await redisConnection.connect();
    logger.info('✅ Redis connected for image processing');
    
    // Initialize queue and worker
    await initializeImageQueue();
    await initializeImageWorker();
    
    logger.info('✅ Image processing system fully initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize image processing:', error);
    logger.warn('⚠️ Continuing without image processing queue - uploads will fail');
  }
  
  // WebSocket is already initialized above, just log the status
  if (webSocketService) {
    // Test WebSocket service is working
    const stats = webSocketService.getConnectionStats();
    logger.info('📊 WebSocket service ready:', {
      totalConnections: stats.totalConnections,
      serverId: process.env.SERVER_ID || 'server-1'
    });
  }
  
  startServer();
}).catch((err) => {
  logger.error("mongodb connection failed: ", err);
  process.exit(1);
});

function startServer() {
  try {
    server.listen(PORT, () => {
      logger.info(`🚀 Server running at http://localhost:${PORT}/`);
      logger.info(`🔌 WebSocket server ready for connections`);
      logger.info(`🖼️ Image processing queue ready`);
      logger.info(`📊 Server ID: ${process.env.SERVER_ID || 'server-1'}`);
      if (keys.nodeEnv === "development") logGojo();
    });
  } catch (error) {
    logger.error("❌ Failed to start Server", error);
    process.exit(1);
  }
}

// Error middleware
app.use(globalErrorHandler);

// Enhanced graceful shutdown
const handleGracefulShutdown = async () => {
  logger.info('🛑 Received shutdown signal, starting graceful shutdown...');
  
  try {
    // Cleanup image processing system
    logger.info('🖼️ Shutting down image processing system...');
    
    const imageWorker = getImageWorker();
    const imageQueue = getImageQueue();
    
    if (imageWorker) {
      await imageWorker.close();
      logger.info('✅ Image worker closed');
    }
    
    if (imageQueue) {
      await imageQueue.close();
      logger.info('✅ Image queue closed');
    }
    
    // Redis cleanup
    await redisConnection.disconnect();
    logger.info('✅ Redis disconnected');
    
    // Get WebSocket service and cleanup
    if (webSocketService) {
      await webSocketService.cleanup();
      logger.info('✅ WebSocket cleanup completed');
    }
    
  } catch (error) {
    logger.error('❌ Error during cleanup:', error);
  }
  
  // Close HTTP server
  server.close(async (err) => {
    if (err) {
      logger.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }
    
    logger.info('✅ HTTP server closed');
    
    // Close database connection
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        logger.info('✅ MongoDB connection closed');
      }
      process.exit(0);
    } catch (dbError) {
      logger.error('❌ Error closing database connections:', dbError);
      process.exit(1);
    }
  });
  
  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('⚠️ Force shutdown - timeout exceeded');
    process.exit(1);
  }, 30000);
};

// Enhanced graceful shutdown
gracefulShutdown(server);

// Add custom signal handlers
process.on('SIGTERM', handleGracefulShutdown);
process.on('SIGINT', handleGracefulShutdown);

// Process error handling
process.on("uncaughtException", (err) => {
  logger.error("⚠️ Uncaught Exception!", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.warn("⚠️ Unhandled Promise Rejection", reason);
  logger.info("Promise : ", promise);
});

// Periodic connection stats logging (for monitoring)
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    try {
      if (webSocketService) {
        const stats = webSocketService.getConnectionStats();
        logger.info('📊 WebSocket Stats:', {
          ...stats,
          serverId: process.env.SERVER_ID || 'server-1',
          timestamp: new Date().toISOString()
        });
      }
      
      // Add image processing stats
      const imageQueue = getImageQueue();
      if (imageQueue) {
        const waiting = await imageQueue.getWaiting();
        const active = await imageQueue.getActive();
        const completed = await imageQueue.getCompleted();
        const failed = await imageQueue.getFailed();
        
        logger.info('🖼️ Image Queue Stats:', {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      logger.error('❌ Error getting service stats:', error);
    }
  }, 60000); // Every minute
}

export { server, app };
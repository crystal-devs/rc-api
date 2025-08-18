// Updated index.ts with enhanced database connection pooling

import { connectToMongoDB, disconnectFromMongoDB, logConnectionPoolStats, checkDBHealth } from "@configs/database.config";
import { keys } from "@configs/dotenv.config";
import { corsOptions, rateLimiter, securityHeaders } from "@configs/security.config";
import { gracefulShutdown } from "@configs/shutdown.config";
import { globalErrorHandler } from "@middlewares/error-handler.middleware";
import { logGojo } from "@utils/gojo-satoru";
import { logger, morganMiddleware } from "@utils/logger";
import { createDefaultPlans } from "@models/subscription-plan.model";

// WebSocket imports
import { initializeWebSocketService } from "@services/websocket/websocket.service";

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
import photoWallRouter from "@routes/photo-wall.router";

// Packages
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import http from "http";
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

// 🏥 Health check endpoint (add before other routes)
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await checkDBHealth();
    const redisHealth = redisConnection.isReady();

    const healthStatus = {
      status: dbHealth.status === 'healthy' && redisHealth ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: { status: redisHealth ? 'healthy' : 'unhealthy' },
        webSocket: { status: webSocketService ? 'healthy' : 'unhealthy' },
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };

    res.status(healthStatus.status === 'healthy' ? 200 : 503).json(healthStatus);
  } catch (error) {
    logger.error('❌ Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Express routes
app.use("/system", systemRouter);
app.use(`/api/${VERSION}/auth`, authRouter);
app.use(`/api/${VERSION}/event`, eventRouter);
app.use(`/api/${VERSION}/album`, albumRouter);
app.use(`/api/${VERSION}/media`, mediaRouter);
app.use(`/api/${VERSION}/user`, userRouter);
app.use(`/api/${VERSION}/token`, shareTokenRouter);
app.use(`/api/${VERSION}/photo-wall`, photoWallRouter);

// 🚀 Enhanced Application Startup
async function initializeApplication() {
  try {
    // 📊 Connect to MongoDB with enhanced connection pooling
    logger.info('📊 Initializing MongoDB with connection pooling...');
    await connectToMongoDB();

    // 🔧 Create default data
    await createDefaultPlans();
    logger.info('✅ Default subscription plans created/verified');

    // 📈 Log initial connection pool stats
    logConnectionPoolStats();

    // 🖼️ Initialize image processing system
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
  } catch (error) {
    logger.error("❌ Application initialization failed:", error);
    process.exit(1);
  }
}

function startServer() {
  try {
    server.listen(PORT, () => {
      logger.info(`🚀 Server running at http://localhost:${PORT}/`);
      logger.info(`🏥 Health check available at http://localhost:${PORT}/health`);
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

// 🛑 Enhanced graceful shutdown
const handleGracefulShutdown = async () => {
  logger.info('🛑 Received shutdown signal, starting graceful shutdown...');

  try {
    // Stop accepting new connections
    server.close(async (err) => {
      if (err) {
        logger.error('❌ Error during server shutdown:', err);
      } else {
        logger.info('✅ HTTP server closed');
      }

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

        // WebSocket cleanup
        if (webSocketService) {
          await webSocketService.cleanup();
          logger.info('✅ WebSocket cleanup completed');
        }

        // 📊 Enhanced MongoDB disconnect with connection pool cleanup
        await disconnectFromMongoDB();
        logger.info('✅ MongoDB disconnected gracefully');

        logger.info('🎉 Graceful shutdown completed successfully');
        process.exit(0);

      } catch (cleanupError) {
        logger.error('❌ Error during cleanup:', cleanupError);
        process.exit(1);
      }
    });

  } catch (error) {
    logger.error('❌ Error during shutdown initiation:', error);
    process.exit(1);
  }

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

// 📊 Periodic monitoring and stats logging (for production)
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    try {
      // WebSocket stats
      if (webSocketService) {
        const stats = webSocketService.getConnectionStats();
        logger.info('📊 WebSocket Stats:', {
          ...stats,
          serverId: process.env.SERVER_ID || 'server-1',
          timestamp: new Date().toISOString()
        });
      }

      // Image processing stats
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

      // 📊 Database connection pool stats
      logConnectionPoolStats();

      // Memory usage monitoring
      const memUsage = process.memoryUsage();
      logger.info('💾 Memory Usage:', {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)} MB`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('❌ Error getting service stats:', error);
    }
  }, 60000); // Every minute
}

// Initialize the application
initializeApplication();

export { server, app };
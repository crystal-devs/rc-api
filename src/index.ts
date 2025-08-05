import { connectToMongoDB } from "@configs/database.config";
import { keys } from "@configs/dotenv.config";
import { corsOptions, rateLimiter, securityHeaders } from "@configs/security.config";
import { gracefulShutdown } from "@configs/shutdown.config";
import { globalErrorHandler } from "@middlewares/error-handler.middleware";
import { logGojo } from "@utils/gojo-satoru";
import { logger, morganMiddleware } from "@utils/logger";
import { createDefaultPlans } from "@models/subscription-plan.model";

// WebSocket imports
import { initializeWebSocketService, getWebSocketService } from "@services/websocket.service";
import { websocketAuthMiddleware, websocketRateLimit, websocketLogger } from "@middlewares/websocket-auth.middleware";

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

// Express routes
app.use("/system", systemRouter);
app.use(`/api/${VERSION}/auth`, authRouter);
app.use(`/api/${VERSION}/event`, eventRouter);
app.use(`/api/${VERSION}/album`, albumRouter);
app.use(`/api/${VERSION}/media`, mediaRouter);
app.use(`/api/${VERSION}/user`, userRouter);
app.use(`/api/${VERSION}/token`, shareTokenRouter);

// Health check endpoint for load balancer
app.get('/health', async (req, res) => {
  try {
    const webSocketService = getWebSocketService();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      serverId: process.env.SERVER_ID || 'server-1',
      websocket: {
        localConnections: webSocketService.getTotalConnections(),
      },
      uptime: process.uptime()
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

connectToMongoDB().then(async () => {
  await createDefaultPlans();
  
  // Initialize WebSocket service
  try {
    const webSocketService = initializeWebSocketService(server);
    logger.info("🔌 WebSocket service initialized successfully");
    
    // Add WebSocket middleware
    webSocketService.io.use(websocketLogger());
    webSocketService.io.use(websocketRateLimit());
    webSocketService.io.use(websocketAuthMiddleware());
    
    // Log initial connection stats
    setTimeout(() => {
      try {
        logger.info('📊 Initial WebSocket Stats:', {
          connections: webSocketService.getTotalConnections()
        });
      } catch (statsError) {
        logger.error('❌ Error getting initial WebSocket stats:', statsError);
      }
    }, 5000);
    
  } catch (wsError) {
    logger.error("❌ WebSocket initialization failed:", wsError);
    logger.warn("⚠️ Continuing without WebSocket real-time features");
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

// Graceful shutdown
const handleGracefulShutdown = async () => {
  logger.info('🛑 Received shutdown signal, starting graceful shutdown...');
  
  try {
    // Get WebSocket service and cleanup
    const webSocketService = getWebSocketService();
    
    logger.info('🔌 Disconnecting all WebSocket clients...');
    
    // Notify all clients about shutdown
    webSocketService.io.emit('server_shutdown', {
      message: 'Server is shutting down for maintenance',
      serverId: process.env.SERVER_ID || 'server-1',
      timestamp: new Date()
    });
    
    // Give clients time to receive the message
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Disconnect all sockets
    webSocketService.io.disconnectSockets();
    
    logger.info('✅ WebSocket cleanup completed');
    
  } catch (error) {
    logger.error('❌ Error during WebSocket cleanup:', error);
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
      const webSocketService = getWebSocketService();
      
      logger.info('📊 WebSocket Stats:', {
        serverId: process.env.SERVER_ID || 'server-1',
        localConnections: webSocketService.getTotalConnections(),
        timestamp: new Date().toISOString()
      });
      
      // Alert if connections are getting high
      if (webSocketService.getTotalConnections() > 500) {
        logger.warn(`⚠️ High connection count: ${webSocketService.getTotalConnections()}`);
      }
      
    } catch (error) {
      logger.error('❌ Error getting WebSocket stats:', error);
    }
  }, 60000); // Every minute
}

export { server, app };
// index.ts - Clean and modular application entry point
import { keys } from "@configs/dotenv.config";
import { corsOptions, rateLimiter, securityHeaders } from "@configs/security.config";
import { gracefulShutdown } from "@configs/shutdown.config";
import { globalErrorHandler } from "@middlewares/error-handler.middleware";
import { logGojo } from "@utils/gojo-satoru";
import { logger, morganMiddleware } from "@utils/logger";

// WebSocket imports
import { initializeWebSocketService } from "@services/websocket/websocket.service";

// Service imports


// Route imports
import authRouter from "@routes/auth-router";
import systemRouter from "@routes/system.route";
import eventRouter from "@routes/event.router";
import mediaRouter from "@routes/media.router";
import userRouter from "@routes/user.router";
import albumRouter from "@routes/album.router";
import shareTokenRouter from "@routes/share-token.router";
import photoWallRouter from "@routes/photo-wall.router";
import bulkDownloadRouter from "@routes/bulk-download.routes";

// Packages
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import http from "http";
import { HealthService } from "@services/health.service";
import { InitializationService } from "@services/initialization.service";
import { CleanupService } from "@services/cleanup.service";
import { ShutdownService } from "@services/shutdown.service";
import { ProductionMonitoringService } from "@services/monitoring.service";

const app = express();
const PORT = keys.port;
const VERSION = keys.APILiveVersion;

// Middlewares
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(securityHeaders);
app.use(rateLimiter);
app.use(cors(corsOptions));
app.use(morganMiddleware);

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket service
let webSocketService: any = null;
try {
  webSocketService = initializeWebSocketService(server);
  logger.info("WebSocket service initialized successfully");
} catch (wsError) {
  logger.error("WebSocket initialization failed:", wsError);
  logger.warn("Continuing without WebSocket real-time features");
}

// Enhanced Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const healthStatus = await HealthService.getHealthStatus(webSocketService);
    res.status(healthStatus.status === 'healthy' ? 200 : 503).json(healthStatus);
  } catch (error) {
    logger.error('Health check failed:', error);
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
app.use(`/api/${VERSION}/download`, bulkDownloadRouter);

// Enhanced Application Initialization
async function initializeApplication() {
  try {
    // Initialize database
    await InitializationService.initializeDatabase();

    // Initialize Redis
    const redisConnected = await InitializationService.initializeRedis();

    // Initialize image processing (requires Redis)
    if (redisConnected) {
      await InitializationService.initializeImageProcessing();
      await InitializationService.initializeBulkDownload();
      
      // Initialize cleanup jobs
      CleanupService.initializeBulkDownloadCleanupJobs();
    }

    // WebSocket status logging
    if (webSocketService) {
      const stats = webSocketService.getConnectionStats();
      logger.info('WebSocket service ready:', {
        totalConnections: stats.totalConnections,
        serverId: process.env.SERVER_ID || 'server-1'
      });
    }

    startServer();
  } catch (error) {
    logger.error("Application initialization failed:", error);
    process.exit(1);
  }
}

function startServer() {
  try {
    server.listen(PORT, () => {
      logger.info(`Server running at http://localhost:${PORT}/`);
      logger.info(`Health check available at http://localhost:${PORT}/health`);
      logger.info(`WebSocket server ready for connections`);
      logger.info(`Server ID: ${process.env.SERVER_ID || 'server-1'}`);
      if (keys.nodeEnv === "development") logGojo();
    });
  } catch (error) {
    logger.error("Failed to start Server", error);
    process.exit(1);
  }
}

// Error handling middleware
app.use(globalErrorHandler);

// Signal handlers for graceful shutdown
const handleShutdown = () => ShutdownService.handleGracefulShutdown(server, webSocketService);

// Enhanced graceful shutdown
gracefulShutdown(server);
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// Process error handling
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception!", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.warn("Unhandled Promise Rejection", reason);
  logger.info("Promise : ", promise);
});

// Start production monitoring
ProductionMonitoringService.startMonitoring(webSocketService);

// Initialize the application
initializeApplication();

export { server, app };
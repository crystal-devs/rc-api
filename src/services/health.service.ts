// services/health.service.ts

import { checkDBHealth } from "@configs/database.config";
import { redisConnection } from "@configs/redis.config";
import { MonitoringService } from "@utils/monitoring";

interface BulkDownloadHealth {
  status: string;
  error?: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  healthy?: boolean;
}

export class HealthService {
  static async getHealthStatus(webSocketService: any) {
    try {
      const dbHealth = await checkDBHealth();
      const redisHealth = redisConnection.isReady();

      // ✅ Properly typed bulkDownloadHealth
      let bulkDownloadHealth: BulkDownloadHealth = {
        status: "unknown",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      };

      try {
        const queueHealth = await MonitoringService.getQueueHealth();
        bulkDownloadHealth = {
          status: queueHealth.healthy ? "healthy" : "unhealthy",
          ...queueHealth,
        };
      } catch (error: any) {
        bulkDownloadHealth = {
          status: "unhealthy",
          error: error.message || "Unknown error",
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
        };
      }

      const allHealthy =
        dbHealth.status === "healthy" &&
        redisHealth &&
        bulkDownloadHealth.status === "healthy";

      return {
        status: allHealthy ? "healthy" : "unhealthy",
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth,
          redis: { status: redisHealth ? "healthy" : "unhealthy" },
          webSocket: { status: webSocketService ? "healthy" : "unhealthy" },
          bulkDownload: bulkDownloadHealth,
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };
    } catch (error: any) {
      return {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// services/auth/audit.service.ts
// ====================================
// Centralized audit logging for authentication events

import { logger } from '@utils/logger';
import mongoose from 'mongoose';
import { redisConnection } from '@configs/redis.config';

export interface AuditEvent {
  eventType: 'login' | 'logout' | 'token_refresh' | 'token_revoke' | 'password_change' | 'suspicious_activity' | 'guest_access';
  userId?: string;
  sessionId?: string;
  ip: string;
  userAgent: string;
  deviceFingerprint?: string;
  location?: {
    country?: string;
    city?: string;
    timezone?: string;
  };
  metadata?: Record<string, any>;
  success: boolean;
  errorMessage?: string;
}

export class AuditService {
  private static redis = redisConnection;

  /**
   * Log authentication event to Redis (fast access) and MongoDB (persistent)
   */
  static async logEvent(event: AuditEvent): Promise<void> {
    try {
      const auditEntry = {
        ...event,
        timestamp: new Date().toISOString(),
        id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      // Store in Redis with TTL (7 days for recent events)
      const redis = await this.redis.connect();
      await redis.setEx(
        `audit:${auditEntry.id}`,
        7 * 24 * 60 * 60, // 7 days
        JSON.stringify(auditEntry)
      );

      // Store in MongoDB asynchronously (don't block auth flow)
      this.persistToMongoDB(auditEntry).catch(err =>
        logger.warn('Failed to persist audit log to MongoDB:', err)
      );

      // Log to console for immediate visibility
      const logLevel = event.success ? 'info' : 'warn';
      logger[logLevel](`Auth Audit: ${event.eventType}`, {
        userId: event.userId || 'anonymous',
        ip: event.ip,
        success: event.success,
        error: event.errorMessage
      });

    } catch (error) {
      logger.error('Audit logging failed:', error);
      // Don't throw - audit failure shouldn't break auth
    }
  }

  /**
   * Persist audit entry to MongoDB
   */
  private static async persistToMongoDB(entry: any): Promise<void> {
    try {
      // Check if model already exists to avoid OverwriteModelError
      let AuditLog: mongoose.Model<any>;
      try {
        AuditLog = mongoose.model('AuditLog');
      } catch (error) {
        // Model doesn't exist, create it
        const auditSchema = new mongoose.Schema({
          eventType: String,
          userId: String,
          sessionId: String,
          ip: String,
          userAgent: String,
          deviceFingerprint: String,
          location: Object,
          metadata: Object,
          success: Boolean,
          errorMessage: String,
          timestamp: Date
        }, { timestamps: true });

        AuditLog = mongoose.model('AuditLog', auditSchema);
      }

      await AuditLog.create({
        ...entry,
        timestamp: new Date(entry.timestamp)
      });
    } catch (error: any) {
      // If it's still a model overwrite error, just log and continue
      if (error.message && error.message.includes('Cannot overwrite')) {
        logger.debug('AuditLog model already exists, skipping MongoDB persistence');
      } else {
        throw error;
      }
    }
  }

  /**
   * Get recent audit events for a user
   */
  static async getUserAuditEvents(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const redis = await this.redis.connect();
      const keys = await redis.keys(`audit:*`);

      const events = [];
      for (const key of keys.slice(0, limit)) {
        const data = await redis.get(key);
        if (data && typeof data === 'string') {
          try {
            const entry = JSON.parse(data);
            if (entry.userId === userId) {
              events.push(entry);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      logger.error('Failed to get user audit events:', error);
      return [];
    }
  }

  /**
   * Detect suspicious activity patterns
   */
  static async detectSuspiciousActivity(userId: string): Promise<{
    isSuspicious: boolean;
    reasons: string[];
    recentEvents: any[];
  }> {
    const recentEvents = await this.getUserAuditEvents(userId, 20);

    const reasons: string[] = [];
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // Check for rapid login attempts
    const recentLogins = recentEvents.filter(e =>
      e.eventType === 'login' &&
      (now - new Date(e.timestamp).getTime()) < oneHour
    );

    if (recentLogins.length > 5) {
      reasons.push('Multiple login attempts in short time');
    }

    // Check for logins from different IPs
    const ips = [...new Set(recentEvents.map(e => e.ip))];
    if (ips.length > 3) {
      reasons.push('Logins from multiple IP addresses');
    }

    // Check for failed authentications
    const failedAttempts = recentEvents.filter(e => !e.success).length;
    if (failedAttempts > 3) {
      reasons.push('Multiple failed authentication attempts');
    }

    return {
      isSuspicious: reasons.length > 0,
      reasons,
      recentEvents: recentEvents.slice(0, 10)
    };
  }
}

export const auditService = AuditService;
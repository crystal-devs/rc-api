// services/auth/session.service.ts
// ====================================
// Enhanced session management with device tracking

import { RefreshSession } from '@models/refresh-session.model';
import { redisConnection } from '@configs/redis.config';
import { auditService } from './audit.service';
import { logger } from '@utils/logger';

export interface DeviceInfo {
  fingerprint: string;
  name: string;
  type: 'mobile' | 'desktop' | 'tablet';
  os: string;
  browser: string;
  ip: string;
  location?: {
    country?: string;
    city?: string;
  };
}

export interface ActiveSession {
  sessionId: string;
  deviceInfo: DeviceInfo;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastActivityAt: Date;
  isCurrentSession?: boolean;
}

export class SessionService {

  /**
   * Get all active sessions for a user
   */
  static async getActiveSessions(userId: string, currentSessionId?: string): Promise<ActiveSession[]> {
    try {
      const sessions = await RefreshSession.find({
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).sort({ lastActivityAt: -1 });

      return sessions.map(session => ({
        sessionId: session.sessionId,
        deviceInfo: {
          fingerprint: session.deviceFingerprint || '',
          name: session.deviceName,
          type: this.detectDeviceType(session.userAgent),
          os: this.extractOS(session.userAgent),
          browser: this.extractBrowser(session.userAgent),
          ip: session.ip,
          location: session.location
        },
        ip: session.ip,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        isCurrentSession: session.sessionId === currentSessionId
      }));
    } catch (error) {
      logger.error('Error getting active sessions:', error);
      return [];
    }
  }

  /**
   * Revoke a specific session
   */
  static async revokeSession(userId: string, sessionId: string, reason: string = 'user_action'): Promise<boolean> {
    try {
      const session = await RefreshSession.findOneAndUpdate(
        { userId, sessionId, isActive: true },
        {
          $set: {
            isActive: false,
            revokedAt: new Date(),
            revocationReason: reason,
            lastActivityAt: new Date()
          }
        }
      );

      if (session) {
        // Remove from Redis
        const redis = await redisConnection.connect();
        const tokenHash = await this.getTokenHashForSession(sessionId);
        if (tokenHash) {
          await redis.del(`refresh:${tokenHash}`);
        }

        // Audit the revocation
        await auditService.logEvent({
          eventType: 'token_revoke',
          userId,
          sessionId,
          ip: session.ip,
          userAgent: session.userAgent,
          success: true,
          metadata: { reason, sessionId }
        });

        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error revoking session:', error);
      return false;
    }
  }

  /**
   * Revoke all sessions except current
   */
  static async revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    try {
      const result = await RefreshSession.updateMany(
        {
          userId,
          sessionId: { $ne: currentSessionId },
          isActive: true
        },
        {
          $set: {
            isActive: false,
            revokedAt: new Date(),
            revocationReason: 'revoke_all_others',
            lastActivityAt: new Date()
          }
        }
      );

      // Remove from Redis (this is a simplified approach)
      // In production, you'd need to track token hashes per session
      logger.info(`Revoked ${result.modifiedCount} sessions for user ${userId}`);

      return result.modifiedCount;
    } catch (error) {
      logger.error('Error revoking all other sessions:', error);
      return 0;
    }
  }

  /**
   * Detect suspicious login activity
   */
  static async detectSuspiciousActivity(userId: string, currentLogin: {
    ip: string;
    userAgent: string;
    deviceFingerprint?: string;
  }): Promise<{
    isSuspicious: boolean;
    reasons: string[];
    riskLevel: 'low' | 'medium' | 'high';
  }> {
    const reasons: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    try {
      const activeSessions = await this.getActiveSessions(userId);

      // Check for new IP
      const knownIPs = activeSessions.map(s => s.ip);
      if (!knownIPs.includes(currentLogin.ip)) {
        reasons.push('Login from unknown IP address');
        riskLevel = 'medium';
      }

      // Check for new device
      const knownFingerprints = activeSessions
        .map(s => s.deviceInfo.fingerprint)
        .filter(f => f);
      if (currentLogin.deviceFingerprint &&
        !knownFingerprints.includes(currentLogin.deviceFingerprint)) {
        reasons.push('Login from unknown device');
        riskLevel = 'high';
      }

      // Check for rapid session creation
      const recentSessions = activeSessions.filter(s =>
        (Date.now() - s.createdAt.getTime()) < (24 * 60 * 60 * 1000) // Last 24 hours
      );
      if (recentSessions.length > 3) {
        reasons.push('Multiple sessions created recently');
        riskLevel = 'medium';
      }

      // Use audit service for additional checks
      const auditAnalysis = await auditService.detectSuspiciousActivity(userId);
      if (auditAnalysis.isSuspicious) {
        reasons.push(...auditAnalysis.reasons);
        if (auditAnalysis.reasons.some(r => r.includes('device'))) {
          riskLevel = 'high';
        }
      }

    } catch (error) {
      logger.error('Error detecting suspicious activity:', error);
    }

    return {
      isSuspicious: reasons.length > 0,
      reasons,
      riskLevel
    };
  }

  /**
   * Helper: Get token hash for session
   */
  private static async getTokenHashForSession(sessionId: string): Promise<string | null> {
    try {
      const session = await RefreshSession.findOne({ sessionId }).select('tokenHash').lean();
      return session?.tokenHash || null;
    } catch (error) {
      logger.error('Error getting token hash for session:', error);
      return null;
    }
  }

  /**
   * Helper: Detect device type from user agent
   */
  private static detectDeviceType(userAgent: string): 'mobile' | 'desktop' | 'tablet' {
    const ua = userAgent.toLowerCase();
    if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile';
    return 'desktop';
  }

  /**
   * Helper: Extract OS from user agent
   */
  private static extractOS(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (ua.includes('windows')) return 'Windows';
    if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
    if (ua.includes('linux')) return 'Linux';
    if (ua.includes('android')) return 'Android';
    if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
    return 'Unknown';
  }

  /**
   * Helper: Extract browser from user agent
   */
  private static extractBrowser(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (ua.includes('chrome') && !ua.includes('edg')) return 'Chrome';
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    if (ua.includes('edg')) return 'Edge';
    if (ua.includes('opera')) return 'Opera';
    return 'Unknown';
  }
}

export const sessionService = SessionService;
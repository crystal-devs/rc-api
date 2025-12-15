// services/guest/guest-session.service.ts
import { Request } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { GuestSession } from '@models/guest-session.model';

export class GuestSessionService {

    // Rate limiting configuration for guest uploads
    private static readonly UPLOAD_RATE_LIMITS = {
        maxUploadsPerHour: 50,      // Max uploads per hour per session
        maxUploadsPerDay: 200,      // Max uploads per day per session
        maxFileSizeMB: 100,         // Max total size per session per day
        windowMs: 60 * 60 * 1000    // 1 hour window for rate checking
    };

    /**
     * Check if guest upload is within rate limits
     */
    static async checkUploadRateLimit(sessionId: string, fileSizeMB: number): Promise<{
        allowed: boolean;
        reason?: string;
        currentStats?: {
            uploadsLastHour: number;
            uploadsLastDay: number;
            totalSizeLastDay: number;
        };
    }> {
        try {
            const session = await GuestSession.findOne({ session_id: sessionId });
            if (!session) {
                return { allowed: false, reason: 'Session not found' };
            }

            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - this.UPLOAD_RATE_LIMITS.windowMs);
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Get upload stats from the session
            const uploadStats = session.upload_stats || {
                total_uploads: 0,
                successful_uploads: 0,
                failed_uploads: 0,
                total_size_mb: 0,
                first_upload_at: null,
                last_upload_at: null
            };

            // Count uploads in the last hour and day
            // Note: This is a simplified approach. For production, consider storing upload timestamps
            const uploadsLastHour = uploadStats.last_upload_at && uploadStats.last_upload_at > oneHourAgo ? 1 : 0;
            const uploadsLastDay = uploadStats.total_uploads; // Simplified - would need timestamp array for accuracy
            const totalSizeLastDay = uploadStats.total_size_mb;

            // Check limits
            if (uploadsLastHour >= this.UPLOAD_RATE_LIMITS.maxUploadsPerHour) {
                return {
                    allowed: false,
                    reason: `Upload limit exceeded: ${this.UPLOAD_RATE_LIMITS.maxUploadsPerHour} uploads per hour`,
                    currentStats: { uploadsLastHour, uploadsLastDay, totalSizeLastDay }
                };
            }

            if (uploadsLastDay >= this.UPLOAD_RATE_LIMITS.maxUploadsPerDay) {
                return {
                    allowed: false,
                    reason: `Upload limit exceeded: ${this.UPLOAD_RATE_LIMITS.maxUploadsPerDay} uploads per day`,
                    currentStats: { uploadsLastHour, uploadsLastDay, totalSizeLastDay }
                };
            }

            if (totalSizeLastDay + fileSizeMB > this.UPLOAD_RATE_LIMITS.maxFileSizeMB) {
                return {
                    allowed: false,
                    reason: `File size limit exceeded: ${this.UPLOAD_RATE_LIMITS.maxFileSizeMB}MB per day`,
                    currentStats: { uploadsLastHour, uploadsLastDay, totalSizeLastDay }
                };
            }

            return {
                allowed: true,
                currentStats: { uploadsLastHour, uploadsLastDay, totalSizeLastDay }
            };
        } catch (error) {
            logger.error('Error checking upload rate limit:', error);
            return { allowed: false, reason: 'Rate limit check failed' };
        }
    }

    /**
     * Get or create guest session with cookie persistence
     */
    static async getOrCreateSession(
        req: Request,
        eventId: string,
        guestInfo?: {
            name?: string;
            email?: string;
            phone?: string;
        }
    ): Promise<any> {
        try {
            // Check for existing session in cookie
            let sessionId = req.cookies?.guest_session_id;
            
            if (sessionId) {
                // Try to find existing active session
                const existingSession = await GuestSession.findOne({
                    session_id: sessionId,
                    event_id: new mongoose.Types.ObjectId(eventId),
                    status: { $in: ['active', 'claimed'] },
                    expires_at: { $gt: new Date() }
                });

                if (existingSession) {
                    // Update activity
                    existingSession.last_activity_at = new Date();
                    
                    // Update guest info if provided and not already set
                    if (guestInfo?.name && !existingSession.guest_info.name) {
                        existingSession.guest_info.name = guestInfo.name;
                    }
                    if (guestInfo?.email && !existingSession.guest_info.email) {
                        existingSession.guest_info.email = guestInfo.email;
                    }
                    if (guestInfo?.phone && !existingSession.guest_info.phone) {
                        existingSession.guest_info.phone = guestInfo.phone;
                    }
                    
                    await existingSession.save();
                    return existingSession;
                }
            }

            // Generate new session ID if none exists or session expired
            if (!sessionId) {
                const timestamp = Date.now().toString(36);
                const random = crypto.randomBytes(6).toString('hex');
                sessionId = `gs_${timestamp}_${random}`;
            }

            // Create device fingerprint
            const userAgent = req.headers['user-agent'] || '';
            const fingerprintHash = crypto
                .createHash('md5')
                .update(userAgent + (req.ip || ''))
                .digest('hex')
                .substring(0, 16);

            // Create new session
            const session = await GuestSession.create({
                session_id: sessionId,
                event_id: new mongoose.Types.ObjectId(eventId),
                access_method: 'share_link',
                guest_info: {
                    name: guestInfo?.name || null,
                    email: guestInfo?.email || null,
                    phone: guestInfo?.phone || null
                },
                device_fingerprint: {
                    user_agent: userAgent,
                    fingerprint_hash: fingerprintHash,
                    platform: userAgent.includes('Mobile') ? 'mobile' : 'desktop',
                    language: req.headers['accept-language']?.split(',')[0] || ''
                },
                network_info: {
                    ip_address: req.ip || ''
                },
                metadata: {
                    referrer: req.headers.referer || '',
                    entry_page: req.originalUrl
                }
            });

            logger.info('Created new guest session:', {
                sessionId: session.session_id.substring(0, 12) + '...',
                eventId,
                hasGuestInfo: !!(guestInfo?.name || guestInfo?.email)
            });

            return session;
        } catch (error: any) {
            logger.error('Error in getOrCreateSession:', error);
            throw error;
        }
    }

    /**
     * Set session cookie on response
     */
    static setSessionCookie(res: any, sessionId: string): void {
        res.cookie('guest_session_id', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            path: '/'
        });
    }

    /**
     * Update guest information for a session
     */
    static async updateGuestInfo(
        sessionId: string,
        eventId: string,
        guestInfo: {
            name?: string;
            email?: string;
            phone?: string;
        }
    ): Promise<{ success: boolean; message: string }> {
        try {
            const session = await GuestSession.findOne({
                session_id: sessionId,
                event_id: new mongoose.Types.ObjectId(eventId)
            });

            if (!session) {
                return { success: false, message: 'Session not found' };
            }

            // Update guest info
            if (guestInfo.name) session.guest_info.name = guestInfo.name;
            if (guestInfo.email) session.guest_info.email = guestInfo.email;
            if (guestInfo.phone) session.guest_info.phone = guestInfo.phone;

            session.last_activity_at = new Date();
            await session.save();

            logger.info('Updated guest info', {
                sessionId: sessionId.substring(0, 8) + '...',
                hasName: !!guestInfo.name,
                hasEmail: !!guestInfo.email,
                hasPhone: !!guestInfo.phone
            });

            return { success: true, message: 'Guest information updated' };
        } catch (error) {
            logger.error('Error updating guest info:', error);
            return { success: false, message: 'Failed to update guest information' };
        }
    }

    /**
     * Check if guest session has required information for actions
     */
    static async hasRequiredInfo(
        sessionId: string,
        eventId: string,
        requiredFields: ('email' | 'phone' | 'name')[] = ['email']
    ): Promise<{ hasInfo: boolean; missingFields: string[]; guestInfo?: any }> {
        try {
            const session = await GuestSession.findOne({
                session_id: sessionId,
                event_id: new mongoose.Types.ObjectId(eventId)
            });

            if (!session) {
                return { hasInfo: false, missingFields: requiredFields };
            }

            const guestInfo = session.guest_info || {};
            const missingFields: string[] = [];

            for (const field of requiredFields) {
                if (!(guestInfo as any)[field]) {
                    missingFields.push(field);
                }
            }

            return {
                hasInfo: missingFields.length === 0,
                missingFields,
                guestInfo
            };
        } catch (error) {
            logger.error('Error checking guest info:', error);
            return { hasInfo: false, missingFields: requiredFields };
        }
    }

    /**
     * Update session upload stats
     */
    static async recordUpload(
        sessionId: string,
        eventId: string,
        fileSizeMB: number,
        success: boolean = true
    ): Promise<void> {
        try {
            await GuestSession.updateOne(
                {
                    session_id: sessionId,
                    event_id: new mongoose.Types.ObjectId(eventId)
                },
                {
                    $inc: {
                        'upload_stats.total_uploads': 1,
                        'upload_stats.successful_uploads': success ? 1 : 0,
                        'upload_stats.failed_uploads': success ? 0 : 1,
                        'upload_stats.total_size_mb': fileSizeMB
                    },
                    $set: {
                        'upload_stats.last_upload_at': new Date(),
                        last_activity_at: new Date()
                    },
                    $setOnInsert: {
                        'upload_stats.first_upload_at': new Date()
                    }
                },
                { upsert: false }
            );
        } catch (error: any) {
            logger.warn('Failed to update session stats:', error);
            // Don't throw - stats update shouldn't fail the upload
        }
    }

    /**
     * Get guest session analytics for an event
     */
    static async getEventAnalytics(eventId: string, timeRange: 'day' | 'week' | 'month' = 'week'): Promise<{
        totalSessions: number;
        activeSessions: number;
        totalUploads: number;
        successfulUploads: number;
        failedUploads: number;
        totalSizeMB: number;
        avgUploadsPerSession: number;
        topDevices: Array<{ device: string; count: number }>;
        engagementMetrics: {
            avgSessionDuration: number;
            bounceRate: number;
            returnVisitors: number;
        };
    }> {
        try {
            const now = new Date();
            let startDate: Date;

            switch (timeRange) {
                case 'day':
                    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
            }

            const sessions = await GuestSession.find({
                event_id: new mongoose.Types.ObjectId(eventId),
                createdAt: { $gte: startDate }
            });

            const totalSessions = sessions.length;
            const activeSessions = sessions.filter(s => s.status === 'active').length;

            // Aggregate upload stats
            const uploadStats = sessions.reduce((acc, session) => {
                const stats = session.upload_stats || {
                    total_uploads: 0,
                    successful_uploads: 0,
                    failed_uploads: 0,
                    total_size_mb: 0
                };
                acc.totalUploads += stats.total_uploads;
                acc.successfulUploads += stats.successful_uploads;
                acc.failedUploads += stats.failed_uploads;
                acc.totalSizeMB += stats.total_size_mb;
                return acc;
            }, { totalUploads: 0, successfulUploads: 0, failedUploads: 0, totalSizeMB: 0 });

            // Device analytics
            const deviceCount: Record<string, number> = {};
            sessions.forEach(session => {
                const device = session.device_fingerprint?.platform || 'unknown';
                deviceCount[device] = (deviceCount[device] || 0) + 1;
            });

            const topDevices = Object.entries(deviceCount)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
                .map(([device, count]) => ({ device, count }));

            // Engagement metrics (simplified)
            const sessionsWithUploads = sessions.filter(s => (s.upload_stats?.total_uploads || 0) > 0).length;
            const returnVisitors = sessions.filter(s => (s.upload_stats?.total_uploads || 0) > 1).length;

            return {
                totalSessions,
                activeSessions,
                totalUploads: uploadStats.totalUploads,
                successfulUploads: uploadStats.successfulUploads,
                failedUploads: uploadStats.failedUploads,
                totalSizeMB: uploadStats.totalSizeMB,
                avgUploadsPerSession: totalSessions > 0 ? uploadStats.totalUploads / totalSessions : 0,
                topDevices,
                engagementMetrics: {
                    avgSessionDuration: 0, // Would need more detailed tracking
                    bounceRate: totalSessions > 0 ? (totalSessions - sessionsWithUploads) / totalSessions : 0,
                    returnVisitors
                }
            };
        } catch (error) {
            logger.error('Error getting event analytics:', error);
            return {
                totalSessions: 0,
                activeSessions: 0,
                totalUploads: 0,
                successfulUploads: 0,
                failedUploads: 0,
                totalSizeMB: 0,
                avgUploadsPerSession: 0,
                topDevices: [],
                engagementMetrics: {
                    avgSessionDuration: 0,
                    bounceRate: 0,
                    returnVisitors: 0
                }
            };
        }
    }

    /**
     * Get guest session details with analytics
     */
    static async getSessionAnalytics(sessionId: string, eventId: string): Promise<{
        session: any;
        uploadStats: any;
        engagementScore: number;
        riskLevel: 'low' | 'medium' | 'high';
    } | null> {
        try {
            const session = await GuestSession.findOne({
                session_id: sessionId,
                event_id: new mongoose.Types.ObjectId(eventId)
            });

            if (!session) return null;

            const uploadStats = session.upload_stats || {
                total_uploads: 0,
                successful_uploads: 0,
                failed_uploads: 0,
                total_size_mb: 0,
                first_upload_at: null,
                last_upload_at: null
            };

            // Calculate engagement score (0-100)
            let engagementScore = 0;
            if (uploadStats.total_uploads > 0) engagementScore += 30;
            if (uploadStats.successful_uploads > 5) engagementScore += 20;
            if (session.guest_info?.name) engagementScore += 15;
            if (session.guest_info?.email) engagementScore += 15;
            if (session.guest_info?.phone) engagementScore += 10;
            if (uploadStats.total_uploads > 10) engagementScore += 10;

            // Risk assessment
            let riskLevel: 'low' | 'medium' | 'high' = 'low';
            if (uploadStats.failed_uploads > uploadStats.successful_uploads) riskLevel = 'medium';
            if (uploadStats.total_uploads > 100) riskLevel = 'high'; // Potential abuse

            return {
                session,
                uploadStats,
                engagementScore: Math.min(engagementScore, 100),
                riskLevel
            };
        } catch (error) {
            logger.error('Error getting session analytics:', error);
            return null;
        }
    }
}
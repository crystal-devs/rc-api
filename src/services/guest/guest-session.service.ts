// services/guest/guest-session.service.ts
import { Request } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { GuestSession } from '@models/guest-session.model';

export class GuestSessionService {
    
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
}
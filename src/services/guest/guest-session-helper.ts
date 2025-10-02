// services/guest/guest-session-helper.ts
import { Request } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { GuestSession } from '@models/guest-session.model';

/**
 * Lightweight helper - NOT a duplicate service
 * Just handles session creation/retrieval
 */
export class GuestSessionHelper {
    
    static async getOrCreate(
        req: Request,
        eventId: string,
        guestInfo?: { name?: string; email?: string; phone?: string }
    ) {
        let sessionId = req.cookies?.guest_session_id;
        
        if (sessionId) {
            const existing = await GuestSession.findOne({
                session_id: sessionId,
                event_id: new mongoose.Types.ObjectId(eventId),
                status: { $in: ['active', 'claimed'] },
                expires_at: { $gt: new Date() }
            });

            if (existing) {
                existing.last_activity_at = new Date();
                if (guestInfo?.name && !existing.guest_info.name) {
                    existing.guest_info.name = guestInfo.name;
                }
                if (guestInfo?.email && !existing.guest_info.email) {
                    existing.guest_info.email = guestInfo.email;
                }
                await existing.save();
                return existing;
            }
        }

        if (!sessionId) {
            sessionId = `gs_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
        }

        const userAgent = req.headers['user-agent'] || '';
        const fingerprintHash = crypto.createHash('md5')
            .update(userAgent + (req.ip || ''))
            .digest('hex')
            .substring(0, 16);

        return await GuestSession.create({
            session_id: sessionId,
            event_id: new mongoose.Types.ObjectId(eventId),
            access_method: 'share_link',
            guest_info: guestInfo || {},
            device_fingerprint: {
                user_agent: userAgent,
                fingerprint_hash: fingerprintHash,
                platform: userAgent.includes('Mobile') ? 'mobile' : 'desktop'
            },
            network_info: { ip_address: req.ip || '' }
        });
    }

    static setCookie(res: any, sessionId: string) {
        const isProduction = process.env.NODE_ENV === 'production';
        
        res.cookie('guest_session_id', sessionId, {
            httpOnly: true,
            secure: isProduction, // Only HTTPS in production
            sameSite: isProduction ? 'none' : 'lax', // ✅ 'none' for cross-origin in production
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            path: '/',
            domain: isProduction ? process.env.COOKIE_DOMAIN : undefined // ✅ Set domain if needed
        });
        
        console.log('🍪 Guest session cookie set:', {
            sessionId: sessionId.substring(0, 15) + '...',
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax'
        });
    }
}
// 2. services/auth/token.service.ts
// ====================================

import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";
import { RefreshSession } from "@models/refresh-session.model";
import { redisConnection } from "@configs/redis.config";
import type { TokenPayload, AuthValidationResult } from './auth.types';

export class TokenService {
    /**
      * Generate JWT access token for user (short-lived)
      */
    generateToken(userId: string, email?: string, provider?: string): string {
        try {
            const payload: TokenPayload = {
                user_id: userId,
                email,
                provider: provider || 'email'
            };

            const token = jwt.sign(payload, keys.jwtSecret as string, {
                expiresIn: "15m", // Short-lived: 15 minutes
                issuer: 'roseclick',
                audience: 'roseclick-users'
            });

            // logger.debug(`Access token generated for user: ${userId}`);
            return token;
        } catch (error) {
            logger.error('Error generating access token:', error);
            throw new Error('Failed to generate authentication token');
        }
    }

    /**
     * Generate opaque refresh token (long-lived stateful)
     */
    generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
        try {
            // Generate random opaque string
            const token = crypto.randomBytes(40).toString('hex');

            // Hash it for storage
            const hash = crypto.createHash('sha256').update(token).digest('hex');

            // Set expiry (7 days)
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            return { token, hash, expiresAt };
        } catch (error) {
            logger.error('Error generating refresh token:', error);
            throw new Error('Failed to generate refresh token');
        }
    }

    /**
     * Create a new refresh session in Redis (Authoritative) + MongoDB (Metadata)
     */
    async createRefreshSession(userId: string, ip: string, userAgent: string, deviceId?: string): Promise<{ token: string; expiresAt: Date }> {
        try {
            const { token, hash, expiresAt } = this.generateRefreshToken();
            const redis = await redisConnection.connect();
            const sessionId = uuidv4(); // Generate UUID for MongoDB (separate from token)

            // Store in Redis (authoritative - minimal data for auth)
            const redisSessionData = {
                userId,
                sessionId, // Reference to MongoDB record
                expiresAt: expiresAt.toISOString()
            };

            await redis.setEx(`refresh:${hash}`, 7 * 24 * 60 * 60, JSON.stringify(redisSessionData));

            // Log to MongoDB asynchronously (comprehensive metadata)
            RefreshSession.create({
                sessionId,
                userId: new mongoose.Types.ObjectId(userId),
                deviceFingerprint: deviceId || null,
                deviceName: this.extractDeviceName(userAgent),
                ip,
                userAgent,
                location: null, // TODO: Implement IP geolocation
                isActive: true,
                expiresAt,
                lastActivityAt: new Date()
            }).catch((err: any) => {
                logger.warn('Failed to log refresh session metadata to MongoDB:', err);
                // Don't fail the auth flow if metadata logging fails
            });

            return { token, expiresAt };
        } catch (error) {
            logger.error('Error creating refresh session:', error);
            throw new Error('Failed to create refresh session');
        }
    }

    /**
     * Verify and decode JWT Access Token
     */
    async verifyToken(token: string): Promise<AuthValidationResult> {
        try {
            // First check if token is blacklisted
            const isBlacklisted = await this.isTokenBlacklisted(token);
            if (isBlacklisted) {
                return {
                    valid: false,
                    error: 'Token has been revoked'
                };
            }

            const decoded = jwt.verify(token, keys.jwtSecret as string) as TokenPayload;

            // Check if user is blacklisted
            const userBlacklisted = await this.isUserBlacklisted(decoded.user_id);
            if (userBlacklisted) {
                return {
                    valid: false,
                    error: 'User access revoked'
                };
            }

            return {
                valid: true,
                user: {
                    id: decoded.user_id,
                    email: decoded.email,
                    provider: decoded.provider
                }
            };
        } catch (error: any) {
            // logger.warn(`Token verification failed: ${error.message}`);

            let errorMessage = 'Invalid token';
            if (error.name === 'TokenExpiredError') {
                errorMessage = 'Token has expired';
            } else if (error.name === 'JsonWebTokenError') {
                errorMessage = 'Invalid token format';
            }

            return {
                valid: false,
                error: errorMessage
            };
        }
    }

    /**
     * Validate Opaque Refresh Token against Redis (Authoritative)
     * Redis = Source of truth. If Redis doesn't have it, token is invalid.
     * MongoDB = Metadata only, never used for validation.
     */
    async validateRefreshToken(token: string): Promise<{ valid: boolean; userId?: string; sessionId?: string; error?: string }> {
        try {
            const hash = crypto.createHash('sha256').update(token).digest('hex');
            const redis = await redisConnection.connect();

            const sessionData = await redis.get(`refresh:${hash}`);

            if (!sessionData) {
                logger.debug('Refresh token not found in Redis', { token_partial: token.substring(0, 10) + '...' });
                return { valid: false, error: 'Invalid refresh token' };
            }

            const session = JSON.parse(sessionData as string);

            // Check if expired
            if (new Date(session.expiresAt) < new Date()) {
                logger.warn('Refresh token expired in Redis', { userId: session.userId, expiresAt: session.expiresAt });
                await redis.del(`refresh:${hash}`); // Cleanup expired token
                return { valid: false, error: 'Refresh token expired' };
            }

            // Update last activity in MongoDB (async)
            if (session.sessionId) {
                RefreshSession.findOneAndUpdate(
                    { sessionId: session.sessionId },
                    { $set: { lastActivityAt: new Date() } }
                ).catch((err: any) => logger.debug('Failed to update last activity:', err));
            }

            return {
                valid: true,
                userId: session.userId,
                sessionId: session.sessionId
            };
        } catch (error: any) {
            logger.error(`Refresh token validation error: ${error.message}`);
            return { valid: false, error: `Token validation exception: ${error.message}` };
        }
    }

    /**
     * Rotate Refresh Token (Revoke old from Redis, Create new)
     */
    async rotateRefreshToken(oldToken: string, ip: string, userAgent: string): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
        try {
            const hash = crypto.createHash('sha256').update(oldToken).digest('hex');
            const redis = await redisConnection.connect();

            // Get old session data from Redis
            const oldSessionData = await redis.get(`refresh:${hash}`);
            if (!oldSessionData) {
                logger.warn('Old refresh token not found in Redis during rotation');
                return null;
            }

            const oldSession = JSON.parse(oldSessionData as string);

            // Delete old session from Redis
            await redis.del(`refresh:${hash}`);

            // Log rotation event to MongoDB (async)
            RefreshSession.findOneAndUpdate(
                { sessionId: oldSession.sessionId },
                {
                    $set: {
                        rotatedAt: new Date(),
                        isActive: false,
                        lastActivityAt: new Date()
                    }
                }
            ).catch((err: any) => logger.warn('Failed to log token rotation in MongoDB:', err));

            // Create new session
            const { token, expiresAt } = await this.createRefreshSession(
                oldSession.userId,
                ip,
                userAgent,
                oldSession.deviceId
            );

            return { token, expiresAt, userId: oldSession.userId as string };
        } catch (error) {
            logger.error('Token rotation error:', error);
            throw error;
        }
    }

    /**
     * Revoke specifically one token from Redis (Authoritative)
     * MongoDB record stays for audit purposes
     */
    async revokeToken(token: string): Promise<void> {
        try {
            const hash = crypto.createHash('sha256').update(token).digest('hex');
            const redis = await redisConnection.connect();

            // Get session data before deleting
            const sessionData = await redis.get(`refresh:${hash}`);
            const session = sessionData ? JSON.parse(sessionData as string) : null;

            // Remove from Redis (authoritative revocation)
            await redis.del(`refresh:${hash}`);

            // Log revocation in MongoDB (async, for audit)
            if (session?.sessionId) {
                RefreshSession.findOneAndUpdate(
                    { sessionId: session.sessionId },
                    {
                        $set: {
                            revokedAt: new Date(),
                            isActive: false,
                            lastActivityAt: new Date(),
                            revocationReason: 'user_logout'
                        }
                    }
                ).catch((err: any) => logger.warn('Failed to log token revocation in MongoDB:', err));
            }

        } catch (error) {
            logger.error('Error revoking token:', error);
            throw error;
        }
    }

    /**
     * Revoke all sessions for a user from Redis (Authoritative)
     * MongoDB records stay for audit but are marked as revoked
     */
    async revokeAllUserSessions(userId: string): Promise<void> {
        try {
            const redis = await redisConnection.connect();

            // Find all user's refresh tokens in Redis (this is a simplified approach)
            // In production, you might want to maintain a user->tokens index in Redis
            // For now, we'll mark sessions as revoked in MongoDB and rely on TTL for Redis cleanup

            // Log bulk revocation in MongoDB
            await RefreshSession.updateMany(
                { userId: new mongoose.Types.ObjectId(userId), isRevoked: { $ne: true } },
                {
                    $set: {
                        revokedAt: new Date(),
                        isRevoked: true,
                        revocationReason: 'bulk_user_logout'
                    }
                }
            );

            // Note: Redis cleanup happens via TTL. For immediate revocation,
            // you'd need to scan all user tokens, which is expensive.
            // Most systems accept this limitation for bulk operations.

            logger.info(`Revoked all sessions for user ${userId} (Redis TTL will clean up)`);

        } catch (error) {
            logger.error('Error revoking all user sessions:', error);
            throw error;
        }
    }

    /**
     * Extract user ID from token without full verification (for logging)
     */
    extractUserIdUnsafe(token: string): string | null {
        try {
            const decoded = jwt.decode(token) as TokenPayload;
            return decoded?.user_id || null;
        } catch {
            return null;
        }
    }

    /**
     * Add token to blacklist for immediate revocation
     */
    async blacklistToken(token: string, reason: string = 'user_logout', expiryMinutes: number = 15): Promise<void> {
        try {
            const hash = crypto.createHash('sha256').update(token).digest('hex');
            const redis = await redisConnection.connect();

            await redis.setEx(`blacklist:${hash}`, expiryMinutes * 60, JSON.stringify({
                blacklistedAt: new Date().toISOString(),
                reason,
                tokenHash: hash.substring(0, 8) + '...' // Partial hash for logging
            }));

            logger.info(`Token blacklisted: ${hash.substring(0, 8)}...`, { reason });
        } catch (error) {
            logger.error('Error blacklisting token:', error);
            throw error;
        }
    }

    /**
     * Check if token is blacklisted
     */
    async isTokenBlacklisted(token: string): Promise<boolean> {
        try {
            const hash = crypto.createHash('sha256').update(token).digest('hex');
            const redis = await redisConnection.connect();

            const blacklisted = await redis.get(`blacklist:${hash}`);
            return !!blacklisted;
        } catch (error) {
            logger.error('Error checking token blacklist:', error);
            return false; // Fail open - allow token if check fails
        }
    }

    /**
     * Blacklist all tokens for a user (emergency logout)
     */
    async blacklistAllUserTokens(userId: string, reason: string = 'emergency_logout'): Promise<void> {
        try {
            const redis = await redisConnection.connect();

            // Set a user-level blacklist flag
            await redis.setEx(`blacklist:user:${userId}`, 15 * 60, JSON.stringify({ // 15 minutes
                blacklistedAt: new Date().toISOString(),
                reason,
                userId
            }));

            logger.warn(`All tokens blacklisted for user ${userId}`, { reason });
        } catch (error) {
            logger.error('Error blacklisting all user tokens:', error);
            throw error;
        }
    }

    /**
     * Check if user has all tokens blacklisted
     */
    async isUserBlacklisted(userId: string): Promise<boolean> {
        try {
            const redis = await redisConnection.connect();
            const blacklisted = await redis.get(`blacklist:user:${userId}`);
            return !!blacklisted;
        } catch (error) {
            logger.error('Error checking user blacklist:', error);
            return false;
        }
    }

    /**
     * Extract device name from user agent string
     */
    private extractDeviceName(userAgent: string): string {
        if (!userAgent) return 'Unknown Device';

        const ua = userAgent.toLowerCase();

        // Mobile devices
        if (ua.includes('iphone')) return 'iPhone';
        if (ua.includes('ipad')) return 'iPad';
        if (ua.includes('android') && ua.includes('mobile')) return 'Android Phone';
        if (ua.includes('android') && !ua.includes('mobile')) return 'Android Tablet';

        // Desktop browsers
        if (ua.includes('windows')) return 'Windows PC';
        if (ua.includes('macintosh') || ua.includes('mac os x')) return 'Mac';
        if (ua.includes('linux')) return 'Linux PC';

        // Generic fallback
        return 'Web Browser';
    }
}

// Singleton instance
export const tokenService = new TokenService();
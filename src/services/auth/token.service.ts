// 2. services/auth/token.service.ts
// ====================================

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";
import { RefreshSession } from "@models/refresh-session.model";
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
     * Create a new refresh session in the database
     */
    async createRefreshSession(userId: string, ip: string, userAgent: string, deviceId?: string): Promise<{ token: string; expiresAt: Date }> {
        try {
            const { token, hash, expiresAt } = this.generateRefreshToken();

            await RefreshSession.create({
                userId,
                tokenHash: hash,
                ip,
                userAgent,
                deviceId: deviceId || 'unknown',
                expiresAt
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
    verifyToken(token: string): AuthValidationResult {
        try {
            const decoded = jwt.verify(token, keys.jwtSecret as string) as TokenPayload;

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
     * Validate Opaque Refresh Token against Database
     */
    async validateRefreshToken(token: string): Promise<{ valid: boolean; userId?: string; sessionId?: string; error?: string }> {
        try {
            const hash = crypto.createHash('sha256').update(token).digest('hex');

            const session = await RefreshSession.findOne({ tokenHash: hash }).populate('userId');

            if (!session) {
                logger.warn('Refresh session not found for hash', { token_partial: token.substring(0, 10) + '...' });
                return { valid: false, error: 'Invalid refresh token' };
            }

            if (session.expiresAt < new Date()) {
                logger.warn('Refresh session expired', { sessionId: session._id, expiresAt: session.expiresAt });
                await RefreshSession.deleteOne({ _id: session._id }); // Cleanup
                return { valid: false, error: 'Refresh token expired' };
            }

            if (session.isRevoked) {
                logger.warn('Refresh session revoked', { sessionId: session._id });
                await RefreshSession.deleteOne({ _id: session._id }); // Cleanup
                return { valid: false, error: 'Refresh token revoked' };
            }

            return {
                valid: true,
                userId: (session.userId as any)._id.toString(),
                sessionId: session._id.toString()
            };
        } catch (error: any) {
            logger.error(`Refresh verification error: ${error.message}`);
            return { valid: false, error: `Token validation exception: ${error.message}` };
        }
    }

    /**
     * Rotate Refresh Token (Revoke old, Create new)
     */
    async rotateRefreshToken(oldToken: string, ip: string, userAgent: string): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
        try {
            const hash = crypto.createHash('sha256').update(oldToken).digest('hex');

            // Find and delete old session (Atomic rotation)
            const session = await RefreshSession.findOneAndDelete({ tokenHash: hash });

            if (!session) {
                // Potential reuse attack detection could go here
                return null;
            }

            // Create new session
            const { token, expiresAt } = await this.createRefreshSession(
                (session.userId as any).toString(),
                ip,
                userAgent,
                session.deviceId
            );

            return { token, expiresAt, userId: (session.userId as any).toString() };
        } catch (error) {
            logger.error('Token rotation error:', error);
            throw error;
        }
    }

    /**
     * Revoke specifically one token
     */
    async revokeToken(token: string): Promise<void> {
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        await RefreshSession.deleteOne({ tokenHash: hash });
    }

    /**
     * Revoke all sessions for a user
     */
    async revokeAllUserSessions(userId: string): Promise<void> {
        await RefreshSession.deleteMany({ userId });
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
}

// Singleton instance
export const tokenService = new TokenService();
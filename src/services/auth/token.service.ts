// 2. services/auth/token.service.ts
// ====================================

import jwt from "jsonwebtoken";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";
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
                expiresIn: "1h", // Reduced from 50 days to 1 hour for security
                issuer: 'roseclick',
                audience: 'roseclick-users'
            });

            logger.debug(`Access token generated for user: ${userId}`);
            return token;
        } catch (error) {
            logger.error('Error generating access token:', error);
            throw new Error('Failed to generate authentication token');
        }
    }

    /**
     * Generate refresh token (long-lived, used to get new access tokens)
     */
    generateRefreshToken(userId: string): string {
        try {
            const payload = {
                user_id: userId,
                type: 'refresh',
                tokenId: this.generateTokenId() // Unique identifier for token tracking
            };

            const refreshToken = jwt.sign(payload, (keys.jwtRefreshSecret as string) || (keys.jwtSecret as string), {
                expiresIn: "30d", // 30 days for refresh tokens
                issuer: 'roseclick',
                audience: 'roseclick-refresh'
            });

            logger.debug(`Refresh token generated for user: ${userId}`);
            return refreshToken;
        } catch (error) {
            logger.error('Error generating refresh token:', error);
            throw new Error('Failed to generate refresh token');
        }
    }

    /**
     * Generate unique token ID for tracking
     */
    private generateTokenId(): string {
        return require('crypto').randomBytes(16).toString('hex');
    }

    /**
     * Verify and decode JWT token
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
            logger.warn(`Token verification failed: ${error.message}`);
            
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
     * Refresh access token using refresh token
     */
    refreshToken(refreshToken: string): { accessToken: string; refreshToken?: string } {
        try {
            // Verify refresh token
            const decoded = jwt.verify(refreshToken, (keys.jwtRefreshSecret as string) || (keys.jwtSecret as string)) as any;

            if (!decoded || decoded.type !== 'refresh' || !decoded.user_id) {
                throw new Error('Invalid refresh token');
            }

            // Generate new access token
            const newAccessToken = this.generateToken(
                decoded.user_id,
                decoded.email,
                decoded.provider
            );

            // Optionally rotate refresh token for additional security
            const newRefreshToken = this.generateRefreshToken(decoded.user_id);

            logger.debug(`Tokens refreshed for user: ${decoded.user_id}`);

            return {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken // Send new refresh token to client
            };
        } catch (error) {
            logger.error('Token refresh error:', error);
            throw new Error('Failed to refresh token');
        }
    }

    /**
     * Verify refresh token specifically
     */
    verifyRefreshToken(token: string): { valid: boolean; userId?: string; error?: string } {
        try {
            const decoded = jwt.verify(token, (keys.jwtRefreshSecret as string) || (keys.jwtSecret as string)) as any;

            if (decoded.type !== 'refresh') {
                return { valid: false, error: 'Not a refresh token' };
            }

            return {
                valid: true,
                userId: decoded.user_id
            };
        } catch (error: any) {
            logger.warn(`Refresh token verification failed: ${error.message}`);

            let errorMessage = 'Invalid refresh token';
            if (error.name === 'TokenExpiredError') {
                errorMessage = 'Refresh token has expired';
            }

            return {
                valid: false,
                error: errorMessage
            };
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
}

// Singleton instance
export const tokenService = new TokenService();
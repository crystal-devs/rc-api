// 2. services/auth/token.service.ts
// ====================================

import jwt from "jsonwebtoken";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";
import type { TokenPayload, AuthValidationResult } from './auth.types';

export class TokenService {
    /**
     * Generate JWT token for user
     */
    generateToken(userId: string, email?: string, provider?: string): string {
        try {
            const payload: TokenPayload = {
                user_id: userId,
                email,
                provider: provider || 'email'
            };

            const token = jwt.sign(payload, keys.jwtSecret as string, {
                expiresIn: "1200h", // 50 days
                issuer: 'roseclick',
                audience: 'roseclick-users'
            });

            logger.debug(`Token generated for user: ${userId}`);
            return token;
        } catch (error) {
            logger.error('Error generating token:', error);
            throw new Error('Failed to generate authentication token');
        }
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
     * Refresh token (generate new token with same payload)
     */
    refreshToken(oldToken: string): string {
        const verification = this.verifyToken(oldToken);
        
        if (!verification.valid) {
            throw new Error('Cannot refresh invalid token');
        }

        return this.generateToken(
            verification.user.id,
            verification.user.email,
            verification.user.provider
        );
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
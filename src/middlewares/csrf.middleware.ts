/**
 * Industry-Standard CSRF Protection Middleware
 * 
 * Implements double-submit cookie pattern with HMAC-signed tokens:
 * 1. Server generates CSRF token with signature
 * 2. Token sent to client via JSON response
 * 3. Client sends token back in X-CSRF-Token header
 * 4. Server validates signature matches expected value
 * 
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";

// Secret for signing CSRF tokens (use different secret from JWT)
const CSRF_SECRET = keys.jwtSecret + '-csrf';
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export interface CSRFTokenData {
    token: string;
    signature: string;
    expiresAt: number;
}

/**
 * Generate a signed CSRF token
 * Token format: timestamp:randomBytes:signature
 */
export function generateCSRFToken(): { token: string; expiresAt: number } {
    const timestamp = Date.now();
    const randomPart = crypto.randomBytes(32).toString('hex');
    const expiresAt = timestamp + TOKEN_EXPIRY_MS;

    // Create payload to sign
    const payload = `${timestamp}:${randomPart}`;

    // Generate HMAC signature
    const signature = crypto
        .createHmac('sha256', CSRF_SECRET)
        .update(payload)
        .digest('hex');

    // Full token = payload:signature
    const token = `${payload}:${signature}`;

    return { token, expiresAt };
}

/**
 * Validate a CSRF token
 */
export function validateCSRFToken(token: string): { valid: boolean; error?: string } {
    if (!token || typeof token !== 'string') {
        return { valid: false, error: 'CSRF token missing' };
    }

    const parts = token.split(':');
    if (parts.length !== 3) {
        return { valid: false, error: 'Invalid CSRF token format' };
    }

    const [timestampStr, randomPart, providedSignature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    // Check if token is expired
    if (isNaN(timestamp) || Date.now() > timestamp + TOKEN_EXPIRY_MS) {
        return { valid: false, error: 'CSRF token expired' };
    }

    // Recreate expected signature
    const payload = `${timestamp}:${randomPart}`;
    const expectedSignature = crypto
        .createHmac('sha256', CSRF_SECRET)
        .update(payload)
        .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const signaturesMatch = crypto.timingSafeEqual(
        Buffer.from(providedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );

    if (!signaturesMatch) {
        return { valid: false, error: 'Invalid CSRF token signature' };
    }

    return { valid: true };
}

/**
 * CSRF Protection Middleware
 * 
 * Validates CSRF token on state-changing requests (POST, PUT, DELETE, PATCH)
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
    // Skip CSRF for safe HTTP methods
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method.toUpperCase())) {
        next();
        return;
    }

    // Skip CSRF for token refresh endpoint (uses HttpOnly cookie auth)
    if (req.path === '/refresh' || req.path.endsWith('/refresh')) {
        next();
        return;
    }

    // Development bypass (controlled by header)
    if (process.env.NODE_ENV === 'development' && req.headers['x-bypass-csrf'] === 'true') {
        logger.warn('⚠️ CSRF bypassed for development');
        next();
        return;
    }

    // Get CSRF token from header
    const csrfToken = req.headers['x-csrf-token'] as string;

    if (!csrfToken) {
        logger.warn('CSRF token missing in request', {
            path: req.path,
            method: req.method,
            ip: req.ip
        });
        res.status(403).json({
            status: false,
            message: 'CSRF token required',
            code: 'CSRF_TOKEN_MISSING'
        });
        return;
    }

    // Validate the token
    const validation = validateCSRFToken(csrfToken);

    if (!validation.valid) {
        logger.warn('CSRF token validation failed', {
            path: req.path,
            method: req.method,
            ip: req.ip,
            error: validation.error
        });
        res.status(403).json({
            status: false,
            message: validation.error || 'Invalid CSRF token',
            code: 'CSRF_TOKEN_INVALID'
        });
        return;
    }

    next();
};

/**
 * Generate CSRF Token Endpoint Handler
 * Returns a new signed CSRF token
 */
export const generateCSRFTokenHandler = (req: Request, res: Response): void => {
    const { token, expiresAt } = generateCSRFToken();

    res.json({
        status: true,
        csrfToken: token,
        expiresAt: new Date(expiresAt).toISOString()
    });
};

export default {
    csrfProtection,
    generateCSRFToken,
    validateCSRFToken,
    generateCSRFTokenHandler
};

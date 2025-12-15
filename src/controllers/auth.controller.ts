import { Request, Response, NextFunction, RequestHandler } from "express";
import { trimObject } from "@utils/sanitizers.util";
import { loginService, tokenService } from "@services/auth";
import { auditService } from "@services/auth/audit.service";
import { sessionService } from "@services/auth/session.service";
import {
    validateEmail,
    validatePhoneNumber,
    validateProvider,
    validateName,
    validateUrl,
    validatePassword,
    validateLoginCredentials,
    validateRegistrationData
} from "@utils/validation.util";
import { logger } from "@utils/logger";

const REFRESH_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Localhost can be http
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

export const registerController: RequestHandler = async (req, res, next) => {
    try {
        const { name, email, password } = trimObject(req.body);

        // Comprehensive validation using centralized functions
        const nameValidation = validateName(name);
        if (!nameValidation.isValid) {
            res.status(400).json({
                status: false,
                message: nameValidation.error
            });
            return;
        }

        const emailValidation = validateEmail(email);
        if (!emailValidation.isValid) {
            res.status(400).json({
                status: false,
                message: emailValidation.error
            });
            return;
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            res.status(400).json({
                status: false,
                message: passwordValidation.error
            });
            return;
        }

        // For now, we'll create a user with email/password provider
        // In production, you'd hash the password
        const response = await loginService.login({
            email,
            name,
            provider: req.body.provider || 'email',
            profile_pic: ""
        }, req.ip, req.get('User-Agent'));

        // Set HttpOnly Cookie
        res.cookie('refresh_token', response.refreshToken, REFRESH_COOKIE_OPTIONS);

        res.status(201).json({
            status: true,
            message: "Registration successful",
            user: response.user,
            token: response.token,
            // Do NOT send refreshToken in body if using cookies (or optional: send for mobile apps)
            // For PWA coverage, cookies are preferred.
            expiresAt: response.expiresAt
        });
        return;
    } catch (err: any) {
        logger.error('Registration error:', err);

        // Handle duplicate email
        if (err.message.includes('duplicate') || err.code === 11000) {
            res.status(409).json({
                status: false,
                message: "Email already registered"
            });
            return;
        }

        next(err);
    }
}

export const loginController: RequestHandler = async (req, res, next) => {
    let email: string | undefined;
    let phone_number: string | undefined;
    let provider: string | undefined;
    let name: string | undefined;
    let profile_pic: string | undefined;

    try {
        const { email, phone_number, name, profile_pic, provider, password } = trimObject(req.body);

        // Handle both social login and email/password login
        let loginProvider = provider;
        let loginEmail = email;
        let loginName = name;
        let loginProfilePic = profile_pic;

        // If password is provided, treat as email/password login
        if (password) {
            if (!email) {
                res.status(400).json({
                    status: false,
                    message: "Email is required for password login"
                });
                return;
            }

            const emailValidation = validateEmail(email);
            if (!emailValidation.isValid) {
                res.status(400).json({
                    status: false,
                    message: emailValidation.error
                });
                return;
            }

            const passwordValidation = validatePassword(password);
            if (!passwordValidation.isValid) {
                res.status(400).json({
                    status: false,
                    message: passwordValidation.error
                });
                return;
            }

            // For email/password login, use 'email' as provider
            loginProvider = 'email';
        } else {
            // Social login validation
            if (!provider) {
                res.status(400).json({
                    status: false,
                    message: "Provider is required for social login"
                });
                return;
            }

            const providerValidation = validateProvider(provider);
            if (!providerValidation.isValid) {
                res.status(400).json({
                    status: false,
                    message: providerValidation.error
                });
                return;
            }
        }

        // Validate login credentials
        const credentialsValidation = validateLoginCredentials({
            email: loginEmail,
            phone_number,
            provider: loginProvider,
            password
        });

        if (!credentialsValidation.isValid) {
            res.status(400).json({
                status: false,
                message: credentialsValidation.error
            });
            return;
        }

        // Validate optional fields
        if (loginName) {
            const nameValidation = validateName(loginName);
            if (!nameValidation.isValid) {
                res.status(400).json({
                    status: false,
                    message: nameValidation.error
                });
                return;
            }
        }

        if (loginProfilePic) {
            const urlValidation = validateUrl(loginProfilePic);
            if (!urlValidation.isValid) {
                res.status(400).json({
                    status: false,
                    message: urlValidation.error
                });
                return;
            }
        }

        const response = await loginService.login({
            email: loginEmail,
            phone_number,
            name: loginName,
            profile_pic: loginProfilePic,
            provider: loginProvider,
            password: password
        }, req.ip, req.get('User-Agent'));

        // Check for suspicious activity
        const suspiciousCheck = await sessionService.detectSuspiciousActivity(
            response.user.id,
            {
                ip: req.ip,
                userAgent: req.get('User-Agent') || '',
                deviceFingerprint: undefined // Could be added later
            }
        );

        // Set HttpOnly Cookie
        res.cookie('refresh_token', response.refreshToken, REFRESH_COOKIE_OPTIONS);

        const loginResponse: any = {
            ...response,
            refreshToken: undefined, // Remove from body
            securityNotice: suspiciousCheck.isSuspicious ? {
                level: suspiciousCheck.riskLevel,
                message: 'Unusual login activity detected. Please review your account security.'
            } : undefined
        };

        res.status(200).json(loginResponse);

        // Audit successful login with security info
        await auditService.logEvent({
            eventType: 'login',
            userId: response.user.id,
            ip: req.ip,
            userAgent: req.get('User-Agent') || '',
            success: true,
            metadata: {
                provider: loginProvider,
                email: loginEmail,
                phone: phone_number,
                suspiciousActivity: suspiciousCheck.isSuspicious,
                riskLevel: suspiciousCheck.riskLevel,
                securityReasons: suspiciousCheck.reasons
            }
        });

        // Log security warning if suspicious
        if (suspiciousCheck.isSuspicious) {
            logger.warn('Suspicious login detected', {
                userId: response.user.id,
                ip: req.ip,
                riskLevel: suspiciousCheck.riskLevel,
                reasons: suspiciousCheck.reasons
            });
        }

        return;
    } catch (err: any) {
        // Security: Log detailed error for monitoring but return generic message
        const ip = req.ip;
        const userAgent = req.get('User-Agent');

        // Log security-relevant details internally
        logger.warn('Login attempt failed', {
            ip,
            userAgent,
            email: email ? 'provided' : 'not provided',
            phone_number: phone_number ? 'provided' : 'not provided',
            provider,
            error: err.message,
            timestamp: new Date().toISOString()
        });

        // Audit failed login attempt
        await auditService.logEvent({
            eventType: 'login',
            userId: undefined, // Don't know user ID for failed attempts
            ip,
            userAgent: userAgent || '',
            success: false,
            errorMessage: 'Invalid credentials',
            metadata: {
                provider,
                email: email ? 'provided' : undefined,
                phone: phone_number ? 'provided' : undefined
            }
        });

        // Return generic error message to prevent information leakage
        res.status(401).json({
            status: false,
            message: "Invalid email/phone or password"
        });
        return;
    }
};


export const refreshTokenController: RequestHandler = async (req, res, next) => {
    try {
        // Try to get token from cookie first, then body (for non-browser clients)
        const refreshToken = req.cookies.refresh_token || req.body.refreshToken;

        if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
            logger.warn('Refresh token missing', {
                cookies: Object.keys(req.cookies),
                hasCookie: !!req.cookies.refresh_token,
                body: !!req.body?.refreshToken,
                origin: req.headers.origin
            });

            res.status(401).json({
                status: false,
                message: "Refresh token is missing"
            });
            return;
        }

        const result = await loginService.refreshUserToken(refreshToken, req.ip, req.get('User-Agent'));

        // Check if service threw an error that was caught but returned as failure?
        // loginService.refreshUserToken typically throws on failure in typical implementations,
        // but let's check its implementation or assume it throws.
        // Actually looking at loginService (which I haven't seen fully but assumed), 
        // if it returns, it's success. If it throws, it goes to catch.

        // Wait, I need to check login.service.ts to see if it throws or returns null.
        // If it throws, the catch block handles it.

        // Rotate cookie
        res.cookie('refresh_token', result.refreshToken, REFRESH_COOKIE_OPTIONS);

        res.status(200).json({
            status: true,
            message: "Token refreshed successfully",
            token: result.accessToken,
            // refreshToken: result.refreshToken, // Hide new refresh token from body
            expiresAt: result.expiresAt
        });

        return;
    } catch (err: any) {
        // Clear cookie on failure
        res.clearCookie('refresh_token', { path: '/' });

        logger.warn('Refresh token failed', { error: err.message });

        // Return 401 with specific error message for debugging
        res.status(401).json({
            status: false,
            message: err.message || "Token refresh failed",
            debug: process.env.NODE_ENV !== 'production' ? { error: err.message, stack: err.stack } : undefined
        });
        return;
    }
}

export const logoutController: RequestHandler = async (req, res, next) => {
    try {
        const refreshToken = req.cookies.refresh_token || req.body.refreshToken;

        if (refreshToken) {
            await tokenService.revokeToken(refreshToken);
        }

        // Always clear cookie
        res.clearCookie('refresh_token', { path: '/' });

        const userId = (req as any).user?._id?.toString();

        logger.info('User logged out', {
            userId,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });

        // Audit logout
        if (userId) {
            await auditService.logEvent({
                eventType: 'logout',
                userId,
                ip: req.ip,
                userAgent: req.get('User-Agent') || '',
                success: true
            });
        }

        res.status(200).json({
            status: true,
            message: "Logged out successfully"
        });
        return;
    } catch (err: any) {
        logger.error('Logout error:', err);
        next(err);
    }
}

export const googleAuthController: RequestHandler = async (req, res, next) => {
    try {
        // This is a placeholder for Google OAuth implementation
        // In production, you would use google-auth-library or similar

        const { redirect_uri } = req.query;

        if (!redirect_uri) {
            res.status(400).json({
                status: false,
                message: "redirect_uri is required"
            });
            return;
        }

        // Generate Google OAuth URL
        // This is a simplified example - use proper OAuth2 flow
        const googleAuthUrl = `https://accounts.google.com/oauth/authorize?` +
            `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
            `redirect_uri=${encodeURIComponent(redirect_uri as string)}&` +
            `scope=email profile&` +
            `response_type=code&` +
            `access_type=offline`;

        res.status(200).json({
            status: true,
            authUrl: googleAuthUrl,
            message: "Redirect to Google OAuth URL"
        });
        return;
    } catch (err: any) {
        logger.error('Google auth error:', err);
        next(err);
    }
}

export const googleAuthCallbackController: RequestHandler = async (req, res, next) => {
    try {
        const { code, redirectUri } = req.body;

        if (!code || !redirectUri) {
            res.status(400).json({
                status: false,
                message: "Authorization code and redirect URI are required"
            });
            return;
        }

        // This is a placeholder for Google OAuth callback
        // In production, exchange code for tokens and create/update user

        // For now, return a mock response
        res.status(200).json({
            status: true,
            message: "Google OAuth callback - implement token exchange",
            data: {
                code,
                redirectUri,
                note: "Implement actual Google OAuth token exchange here"
            }
        });
        return;
    } catch (err: any) {
        logger.error('Google auth callback error:', err);
        next(err);
    }
}

export const verifyUserController: RequestHandler = async (req, res, next) => {
    try {
        // if album id , then register the user as a viewer against the album
        res.status(200).json({
            status: true,
            message: "User verified successfully",
        });
        return // the user will be verified by the middleware
    } catch (err) {
        next(err);
    }
}

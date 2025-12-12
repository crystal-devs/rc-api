import { Request, Response, NextFunction, RequestHandler } from "express";
import { trimObject } from "@utils/sanitizers.util";
import { loginService, tokenService } from "@services/auth";
import { logger } from "@utils/logger";

// Basic validation functions (since Joi might not be available)
const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const validatePhoneNumber = (phone: string): boolean => {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
};

const validateProvider = (provider: string): boolean => {
    const validProviders = ['google', 'apple', 'instagram', 'facebook'];
    return validProviders.includes(provider);
};

const validateName = (name: string): boolean => {
    return name && name.length >= 1 && name.length <= 100;
};

const validateUrl = (url: string): boolean => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

export const registerController: RequestHandler = async (req, res, next) => {
    try {
        const { name, email, password } = trimObject(req.body);

        // Comprehensive validation
        if (!name || !validateName(name)) {
            res.status(400).json({
                status: false,
                message: "Name is required and must be between 1 and 100 characters"
            });
            return;
        }

        if (!email || !validateEmail(email)) {
            res.status(400).json({
                status: false,
                message: "Valid email is required"
            });
            return;
        }

        if (!password || password.length < 8) {
            res.status(400).json({
                status: false,
                message: "Password must be at least 8 characters long"
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
        });

        res.status(201).json({
            status: true,
            message: "Registration successful",
            user: response.user,
            token: response.token,
            refreshToken: response.refreshToken,
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
            if (!email || !validateEmail(email)) {
                res.status(400).json({
                    status: false,
                    message: "Valid email is required for password login"
                });
                return;
            }

            if (password.length < 8) {
                res.status(400).json({
                    status: false,
                    message: "Password must be at least 8 characters"
                });
                return;
            }

            // For email/password login, use 'email' as provider
            loginProvider = 'email';
        } else {
            // Social login validation
            if (!provider || !validateProvider(provider)) {
                res.status(400).json({
                    status: false,
                    message: "Valid provider is required (google, apple, instagram, facebook)"
                });
                return;
            }
        }

        // Common validation for both login types
        if (!email && !phone_number) {
            res.status(400).json({
                status: false,
                message: "Either email or phone number is required for login"
            });
            return;
        }

        if (email && !validateEmail(email)) {
            res.status(400).json({
                status: false,
                message: "Invalid email format"
            });
            return;
        }

        if (phone_number && !validatePhoneNumber(phone_number)) {
            res.status(400).json({
                status: false,
                message: "Invalid phone number format"
            });
            return;
        }

        if (name && !validateName(name)) {
            res.status(400).json({
                status: false,
                message: "Name must be between 1 and 100 characters"
            });
            return;
        }

        if (profile_pic && !validateUrl(profile_pic)) {
            res.status(400).json({
                status: false,
                message: "Invalid profile picture URL"
            });
            return;
        }

        if (!email && !phone_number) {
            res.status(400).json({
                status: false,
                message: "Either email or phone number is required for login"
            });
            return;
        }

        if (email && !validateEmail(email)) {
            res.status(400).json({
                status: false,
                message: "Invalid email format"
            });
            return;
        }

        if (phone_number && !validatePhoneNumber(phone_number)) {
            res.status(400).json({
                status: false,
                message: "Invalid phone number format"
            });
            return;
        }

        if (name && !validateName(name)) {
            res.status(400).json({
                status: false,
                message: "Name must be between 1 and 100 characters"
            });
            return;
        }

        if (profile_pic && !validateUrl(profile_pic)) {
            res.status(400).json({
                status: false,
                message: "Invalid profile picture URL"
            });
            return;
        }

        const response = await loginService.login({
            email: loginEmail,
            phone_number,
            name: loginName,
            profile_pic: loginProfilePic,
            provider: loginProvider,
            password: password
        });

        res.status(200).json(response);
        return;
    } catch (err: any) {
        // Enhanced error handling with security logging
        const ip = req.ip;
        const userAgent = req.get('User-Agent');

        if (err.message.includes('locked')) {
            logger.warn('Account lockout triggered', {
                ip,
                userAgent,
                email,
                phone_number,
                provider,
                error: err.message
            });
        } else {
            logger.warn('Login validation failed', {
                ip,
                userAgent,
                email: email ? 'provided' : 'not provided',
                phone_number: phone_number ? 'provided' : 'not provided',
                provider,
                error: err.message
            });
        }

        next(err);
    }
};


export const refreshTokenController: RequestHandler = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
            res.status(400).json({
                status: false,
                message: "Valid refresh token is required"
            });
            return;
        }

        const result = await loginService.refreshUserToken(refreshToken);

        res.status(200).json({
            status: true,
            message: "Token refreshed successfully",
            token: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt
        });
        return;
    } catch (err) {
        next(err);
    }
}

export const logoutController: RequestHandler = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            res.status(400).json({
                status: false,
                message: "Refresh token is required for logout"
            });
            return;
        }

        // In a production system, you would:
        // 1. Blacklist the refresh token in Redis/database
        // 2. Clear any server-side sessions
        // 3. Log the logout event

        // For now, we'll just validate the token exists and respond
        const tokenValidation = tokenService.verifyRefreshToken(refreshToken);

        if (!tokenValidation.valid) {
            res.status(400).json({
                status: false,
                message: "Invalid refresh token"
            });
            return;
        }

        logger.info('User logged out', {
            userId: tokenValidation.userId,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });

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

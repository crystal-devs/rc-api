// ====================================
// 4. services/auth/login.service.ts
// ====================================

import mongoose from "mongoose";
import { User } from "@models/user.model";
import { logger } from "@utils/logger";

// Import our modular services
import { tokenService } from './token.service';
import { userInitializationService } from './user-initialization.service';

import type { LoginData, LoginResult } from './auth.types';

import bcrypt from 'bcryptjs';

export class LoginService {
    /**
     * 🚀 MAIN LOGIN/SIGNUP FLOW
     */
    async login(loginData: LoginData, ip: string = 'unknown', userAgent: string = 'unknown'): Promise<LoginResult> {
        try {
            const { email, phone_number, name, profile_pic, provider, country_code, password } = loginData;

            // Build query to find existing user
            const query: any = {};
            if (email) query.email = email;
            if (phone_number) query.phone_number = phone_number;

            // Find existing user
            let user = await User.findOne(query);
            let isNewUser = false;

            logger.info(`Login attempt: ${email || phone_number} (provider: ${provider})`);

            // Check if account is locked
            if (user && user.lockoutUntil && user.lockoutUntil > new Date()) {
                const remainingTime = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 1000 / 60);
                throw new Error(`Account is temporarily locked due to too many failed attempts. Try again in ${remainingTime} minutes.`);
            }

            // Reset lockout if enough time has passed
            if (user && user.lockoutUntil && user.lockoutUntil <= new Date()) {
                user.failedLoginAttempts = 0;
                user.lockoutUntil = null;
                await user.save();
            }

            if (user) {
                // If user exists and provider is email, verify password
                if (provider === 'email') {
                    if (!user.password) {
                        throw new Error("Invalid credentials");
                    }

                    if (!password) {
                        throw new Error("Password is required");
                    }

                    const isMatch = await bcrypt.compare(password, user.password);
                    if (!isMatch) {
                        // Increment failed attempts
                        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
                        user.lastFailedLoginAt = new Date();

                        // Lockout policy: 5 failed attempts = 15 min lockout
                        if (user.failedLoginAttempts >= 5) {
                            user.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000);
                            await user.save();
                            throw new Error("Account is temporarily locked due to too many failed attempts. Try again in 15 minutes.");
                        }

                        await user.save();
                        throw new Error("Invalid credentials");
                    }
                }
            }

            if (!user) {
                // **SIGNUP FLOW**: Create new user
                logger.info(`Creating new user: ${email || phone_number}`);

                let hashedPassword = undefined;
                if (provider === 'email' && password) {
                    hashedPassword = await bcrypt.hash(password, 10);
                }

                const newUserData = {
                    email,
                    phone_number,
                    country_code,
                    role_id: userInitializationService.getDefaultRoleId(),
                    provider,
                    password: hashedPassword,
                    name: name || "Clicky",
                    profile_pic: profile_pic || "",
                    preferences: userInitializationService.createDefaultPreferences(),
                    lastLoginAt: new Date()
                };

                const newUser = await User.create(newUserData);
                user = newUser;
                isNewUser = true;
            }

            // Initialize user data (subscription and usage)
            const initResult = await userInitializationService.initializeUserData(user._id.toString());

            // Generate JWT Token
            const token = tokenService.generateToken(
                user._id.toString(),
                user.email,
                user.provider
            );

            // Generate Opaque Refresh Token & Session
            const { token: refreshToken } = await tokenService.createRefreshSession(user._id.toString(), ip, userAgent);

            // Reset failed login attempts on successful login
            if (user.failedLoginAttempts > 0) {
                user.failedLoginAttempts = 0;
                user.lockoutUntil = null;
                user.lastFailedLoginAt = null;
            }

            // Update successful login tracking
            user.lastSuccessfulLoginAt = new Date();
            user.loginCount = (user.loginCount || 0) + 1;

            await user.save();

            // Build response
            const result: LoginResult = {
                token,
                refreshToken,
                message: isNewUser ? "Signup successful" : "Login successful",
                status: true,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
                user: {
                    id: user._id.toString(),
                    email: user.email,
                    phone_number: user.phone_number,
                    name: user.name,
                    profile_pic: user.profile_pic,
                    provider: user.provider
                }
            };

            logger.info(`${isNewUser ? 'Signup' : 'Login'} successful for user: ${user._id}`, {
                subscriptionCreated: initResult.subscriptionCreated,
                usageCreated: initResult.usageCreated
            });

            return result;
        } catch (error: any) {
            logger.error('Login service error:', error);
            throw error;
        }
    }

    /**
     * 🔍 FIND USER BY CREDENTIALS
     */
    async findUserByCredentials(email?: string, phone?: string) {
        const query: any = {};
        if (email) query.email = email;
        if (phone) query.phone_number = phone;

        return await User.findOne(query).lean();
    }

    /**
     * 🔄 REFRESH USER TOKEN
     */
    async refreshUserToken(refreshToken: string, ip: string = 'unknown', userAgent: string = 'unknown'): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
        try {
            // Validate & Rotate Token
            const rotationResult = await tokenService.rotateRefreshToken(refreshToken, ip, userAgent);

            if (!rotationResult) {
                throw new Error('Invalid or Expired Refresh Token');
            }

            const { token: newRefreshToken, userId } = rotationResult;

            // Fetch User for Access Token Generation
            const user = await User.findById(userId);
            if (!user) throw new Error('User not found');

            const accessToken = tokenService.generateToken(user._id.toString(), user.email, user.provider);

            return {
                accessToken,
                refreshToken: newRefreshToken,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 mins now
            };
        } catch (error: any) {
            logger.error('Token refresh error:', error);
            throw new Error('Failed to refresh token: ' + error.message);
        }
    }

    /**
     * 📊 GET LOGIN STATISTICS
     */
    async getLoginStats(timeframe: 'daily' | 'weekly' | 'monthly' = 'daily') {
        try {
            const now = new Date();
            let startDate: Date;

            switch (timeframe) {
                case 'weekly':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'monthly':
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            }

            const stats = await User.aggregate([
                {
                    $match: {
                        lastLoginAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            provider: "$provider",
                            date: {
                                $dateToString: {
                                    format: "%Y-%m-%d",
                                    date: "$lastLoginAt"
                                }
                            }
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { "_id.date": -1 }
                }
            ]);

            return stats;
        } catch (error) {
            logger.error('Error getting login stats:', error);
            throw error;
        }
    }
}

// Singleton instance
export const loginService = new LoginService();
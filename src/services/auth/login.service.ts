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

export class LoginService {
    /**
     * 🚀 MAIN LOGIN/SIGNUP FLOW
     */
    async login(loginData: LoginData): Promise<LoginResult> {
        try {
            const { email, phone_number, name, profile_pic, provider, country_code } = loginData;

            // Build query to find existing user
            const query: any = {};
            if (email) query.email = email;
            if (phone_number) query.phone_number = phone_number;
            
            // Find existing user
            let user = await User.findOne(query).lean();
            let isNewUser = false;

            logger.info(`Login attempt: ${email || phone_number} (provider: ${provider})`);

            if (!user) {
                // **SIGNUP FLOW**: Create new user
                logger.info(`Creating new user: ${email || phone_number}`);
                
                const newUserData = {
                    email,
                    phone_number,
                    country_code,
                    role_id: userInitializationService.getDefaultRoleId(),
                    provider,
                    name: name || "Clicky",
                    profile_pic: profile_pic || "",
                    preferences: userInitializationService.createDefaultPreferences(),
                    lastLoginAt: new Date()
                };

                const newUser = await User.create(newUserData);
                user = newUser.toObject();
                isNewUser = true;
            }

            // Initialize user data (subscription and usage)
            const initResult = await userInitializationService.initializeUserData(user._id.toString());
            
            // Generate JWT token
            const token = tokenService.generateToken(
                user._id.toString(),
                user.email,
                user.provider
            );

            // Build response
            const result: LoginResult = {
                token,
                message: isNewUser ? "Signup successful" : "Login successful",
                status: true,
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
    async refreshUserToken(oldToken: string): Promise<{ token: string }> {
        try {
            const newToken = tokenService.refreshToken(oldToken);
            return { token: newToken };
        } catch (error: any) {
            logger.error('Token refresh error:', error);
            throw new Error('Failed to refresh token');
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
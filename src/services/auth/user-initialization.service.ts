// ====================================
// 3. services/auth/user-initialization.service.ts
// ====================================

import mongoose from "mongoose";
import { User } from "@models/user.model";
import { UserSubscription } from "@models/user-subscription.model";
import { UserUsage } from "@models/user-usage.model";
import { SubscriptionPlan } from "@models/subscription-plan.model";
import { logger } from "@utils/logger";
import type { UserInitializationData } from './auth.types';

export class UserInitializationService {
    /**
     * Initialize subscription and usage data for new or existing users
     */
    async initializeUserData(userId: string): Promise<UserInitializationData> {
        try {
            const [subscriptionCreated, usageCreated] = await Promise.all([
                this.initializeSubscription(userId),
                this.initializeUsage(userId)
            ]);

            // Update last login time
            await User.findByIdAndUpdate(userId, { 
                lastLoginAt: new Date() 
            });

            return {
                subscriptionCreated,
                usageCreated,
                isNewUser: subscriptionCreated && usageCreated
            };
        } catch (error) {
            logger.error(`Error initializing user data for ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Initialize user subscription if not exists
     */
    private async initializeSubscription(userId: string): Promise<boolean> {
        try {
            // Check if user already has a subscription
            const existingSubscription = await UserSubscription.findOne({ userId });
            
            if (existingSubscription) {
                return false; // Already exists
            }

            logger.info(`Creating default subscription for user: ${userId}`);
            
            // Get the free plan
            const freePlan = await SubscriptionPlan.findOne({ planId: "free" });
            
            if (!freePlan) {
                throw new Error("Free plan not found when initializing user subscription");
            }
            
            // Create expiration date (1 year from now for free plan)
            const expirationDate = new Date();
            expirationDate.setFullYear(expirationDate.getFullYear() + 1);
            
            // Create new subscription
            const newSubscription = new UserSubscription({
                userId: new mongoose.Types.ObjectId(userId),
                planId: freePlan.planId,
                planName: freePlan.name,
                status: "active",
                limits: freePlan.limits,
                currentPeriodStart: new Date(),
                currentPeriodEnd: expirationDate
            });
            
            const savedSubscription = await newSubscription.save();
            
            // Update user with subscription ID
            await User.findByIdAndUpdate(userId, { 
                subscriptionId: savedSubscription._id
            });
            
            logger.info(`Created subscription ${savedSubscription._id} for user ${userId}`);
            return true;
        } catch (error) {
            logger.error(`Error initializing subscription for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Initialize user usage data if not exists
     */
    private async initializeUsage(userId: string): Promise<boolean> {
        try {
            // Check if user has usage data
            const existingUsage = await UserUsage.findOne({ userId });
            
            if (existingUsage) {
                return false; // Already exists
            }

            logger.info(`Creating initial usage data for user: ${userId}`);
            
            // Create initial usage data with zeros
            const newUsage = new UserUsage({
                userId: new mongoose.Types.ObjectId(userId),
                date: new Date(),
                metrics: {
                    photosUploaded: 0,
                    storageUsed: 0,
                    eventsCreated: 0,
                    activeEvents: []
                },
                totals: {
                    photos: 0,
                    storage: 0,
                    events: 0
                }
            });
            
            await newUsage.save();
            logger.info(`Created initial usage data for user ${userId}`);
            return true;
        } catch (error) {
            logger.error(`Error initializing usage for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Create default user preferences
     */
    createDefaultPreferences() {
        return {
            emailNotifications: true,
            defaultEventPrivacy: "private",
            language: "en",
            timezone: "UTC",
            theme: "light"
        };
    }

    /**
     * Get default role ID (should be configurable)
     */
    getDefaultRoleId(): mongoose.Types.ObjectId {
        // TODO: Make this configurable or fetch from database
        return new mongoose.Types.ObjectId("67dd8031cd6d859e3813e8bb");
    }
}

// Singleton instance
export const userInitializationService = new UserInitializationService();
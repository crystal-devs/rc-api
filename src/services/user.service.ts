import { User, UserType } from "@models/user.model";
import { UserSubscription, UserSubscriptionType } from "@models/user-subscription.model";
import { UserUsage, UserUsageType } from "@models/user-usage.model";
import { SubscriptionPlan } from "@models/subscription-plan.model";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import mongoose from "mongoose";
import { logger } from "@utils/logger";

/**
 * Get user by ID
 */
export const getUserByIdService = async (user_id: string) => {
    const user = await User.findById(user_id);
    if(!user) {
        throw new Error("User not found");
    }
    return user;    
}

/**
 * Get user profile information
 */
export const getUserProfileService = async (userId: string) => {
    try {
        const user = await User.findById(userId).select('-password').lean();
        
        if (!user) {
            throw new Error("User not found");
        }
        
        return {
            status: true,
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                phone_number: user.phone_number,
                profile_pic: user.profile_pic,
                provider: user.provider,
                country_code: user.country_code,
                preferences: user.preferences,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt
            }
        };
    } catch (error: any) {
        logger.error(`Error in getUserProfileService: ${error.message}`);
        throw error;
    }
};

/**
 * Get user subscription information
 */
export const getUserSubscriptionService = async (userId: string) => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        
        // Get user subscription
        let subscription: UserSubscriptionType | null = null;
        
        if (user.subscriptionId) {
            subscription = await UserSubscription.findById(user.subscriptionId).lean();
        }
        
        // If no subscription exists, create a free subscription
        if (!subscription) {
            // Get free plan
            const freePlan = await SubscriptionPlan.findOne({ planId: "free" });
            
            if (!freePlan) {
                throw new Error("Free plan not found");
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
                currentPeriodEnd: expirationDate
            });
            
            subscription = await newSubscription.save();
            
            // Update user with subscription ID
            await User.findByIdAndUpdate(userId, { subscriptionId: subscription._id });
        }
        
        // Format the response for frontend
        const formattedSubscription = {
            id: subscription._id,
            userId: subscription.userId,
            planId: subscription.planId,
            planName: subscription.planName,
            status: subscription.status,
            limits: subscription.limits,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt
        };
        
        return {
            status: true,
            data: formattedSubscription
        };
    } catch (error: any) {
        logger.error(`Error in getUserSubscriptionService: ${error.message}`);
        throw error;
    }
};

/**
 * Get user usage information
 */
export const getUserUsageService = async (userId: string) => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        
        // Get the most recent usage record
        const latestUsage = await UserUsage.findOne({ userId: new mongoose.Types.ObjectId(userId) })
            .sort({ date: -1 })
            .lean();
        
        // If no usage exists, create a new one with zeros
        if (!latestUsage) {
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
            
            const savedUsage = await newUsage.save();
            
            // Format the response for frontend
            const formattedUsage = {
                userId: savedUsage.userId,
                date: savedUsage.date,
                metrics: savedUsage.metrics,
                totals: savedUsage.totals
            };
            
            return {
                status: true,
                data: formattedUsage
            };
        }
        
        // Format the response for frontend
        const formattedUsage = {
            userId: latestUsage.userId,
            date: latestUsage.date,
            metrics: {
                photosUploaded: latestUsage.metrics.photosUploaded,
                storageUsed: latestUsage.metrics.storageUsed,
                eventsCreated: latestUsage.metrics.eventsCreated,
                activeEvents: latestUsage.metrics.activeEvents
            },
            totals: {
                photos: latestUsage.totals.photos,
                storage: latestUsage.totals.storage,
                events: latestUsage.totals.events
            }
        };
        
        return {
            status: true,
            data: formattedUsage
        };
    } catch (error: any) {
        logger.error(`Error in getUserUsageService: ${error.message}`);
        throw error;
    }
};

/**
 * Upgrade user subscription
 */
export const upgradeSubscriptionService = async (userId: string, planId: string, paymentMethodId?: string) => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        
        // Check if plan exists
        const plan = await SubscriptionPlan.findOne({ planId, isActive: true });
        if (!plan) {
            throw new Error("Subscription plan not found or inactive");
        }
        
        // If it's not a free plan, validate payment information
        if (plan.planId !== 'free' && plan.price > 0 && !paymentMethodId && !user.stripeCustomerId) {
            throw new Error("Payment method is required for paid plans");
        }
        
        // Create expiration date based on billing cycle
        const expirationDate = new Date();
        if (plan.billingCycle === 'monthly') {
            expirationDate.setMonth(expirationDate.getMonth() + 1);
        } else if (plan.billingCycle === 'yearly') {
            expirationDate.setFullYear(expirationDate.getFullYear() + 1);
        }
        
        // TODO: If Stripe integration is needed, handle payment and subscription creation here
        
        // Create or update subscription
        let subscription: UserSubscriptionType;
        
        if (user.subscriptionId) {
            // Update existing subscription
            subscription = await UserSubscription.findByIdAndUpdate(
                user.subscriptionId,
                {
                    planId: plan.planId,
                    planName: plan.name,
                    status: "active",
                    limits: plan.limits,
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: expirationDate,
                    cancelAtPeriodEnd: false,
                    updatedAt: new Date()
                },
                { new: true }
            );
            
            if (!subscription) {
                throw new Error("Failed to update subscription");
            }
        } else {
            // Create new subscription
            const newSubscription = new UserSubscription({
                userId: new mongoose.Types.ObjectId(userId),
                planId: plan.planId,
                planName: plan.name,
                status: "active",
                limits: plan.limits,
                currentPeriodStart: new Date(),
                currentPeriodEnd: expirationDate,
                // If we had Stripe integration:
                // stripeSubscriptionId: stripeSubscription.id,
                // stripeCustomerId: stripeCustomer.id,
            });
            
            subscription = await newSubscription.save();
            
            // Update user with subscription ID
            await User.findByIdAndUpdate(userId, { 
                subscriptionId: subscription._id,
                // If we had Stripe integration:
                // stripeCustomerId: stripeCustomer.id
            });
        }
        
        return {
            status: true,
            message: `Successfully upgraded to ${plan.name} plan`,
            data: subscription
        };
    } catch (error: any) {
        logger.error(`Error in upgradeSubscriptionService: ${error.message}`);
        throw error;
    }
};

/**
 * Check if user has reached their limits
 */
export const checkUserLimitsService = async (userId: string, checkType: 'event' | 'photo' | 'storage', value?: number): Promise<boolean> => {
    try {
        // Get user subscription
        const userSubscriptionResult = await getUserSubscriptionService(userId);
        const subscription = userSubscriptionResult.data;
        
        // Get user usage
        const userUsageResult = await getUserUsageService(userId);
        const usage = userUsageResult.data;
        
        switch (checkType) {
            case 'event':
                return usage.totals.events < subscription.limits.maxEvents;
            
            case 'photo':
                // Check if adding this photo would exceed the limit for the event
                if (!value) {
                    return true; // If no eventId provided, just check general limit
                }
                
                // Count photos in the specified event (value is eventId in this case)
                // This would need to be implemented based on your media schema and queries
                
                return true; // Placeholder - implement actual check based on your media schema
            
            case 'storage':
                // value would be the size of the new photo in MB
                const newTotal = usage.totals.storage + (value || 0);
                return newTotal <= subscription.limits.maxStorage;
                
            default:
                return true;
        }
    } catch (error: any) {
        logger.error(`Error in checkUserLimitsService: ${error.message}`);
        return false; // Default to not allowing if there's an error
    }
};

/**
 * Get user statistics including event and media counts
 */
export const getUserStatisticsService = async (userId: string) => {
    try {
        const objectId = new mongoose.Types.ObjectId(userId);
        
        // Get total hosted events (created by user)
        const totalHostedEvents = await Event.countDocuments({ created_by: objectId });
        
        // Get total events user is part of (has uploaded media to)
        const eventsWithUserMedia = await Media.distinct("event_id", { uploaded_by: objectId });
        const totalAttendingEvents = eventsWithUserMedia.length;
        
        // Get total photos uploaded by user
        const totalPhotos = await Media.countDocuments({ uploaded_by: objectId, type: "image" });
        
        // Get total videos uploaded by user
        const totalVideos = await Media.countDocuments({ uploaded_by: objectId, type: "video" });
        
        // Get total events (combination of hosted and attended)
        // Use a Set to avoid duplicate event IDs
        const hostedEventIds = await Event.distinct("_id", { created_by: objectId });
        const totalEvents = new Set([...hostedEventIds, ...eventsWithUserMedia]).size;
        
        return {
            status: true,
            data: {
                totalEvents,
                totalHostedEvents,
                totalAttendingEvents,
                totalPhotos,
                totalVideos,
                totalMedia: totalPhotos + totalVideos
            }
        };
    } catch (error: any) {
        logger.error(`Error in getUserStatisticsService: ${error.message}`);
        return {
            status: false,
            message: `Failed to get user statistics: ${error.message}`
        };
    }
};
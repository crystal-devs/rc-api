// 3. services/user/user-subscription.service.ts
// ====================================

import mongoose from "mongoose";
import { User } from "@models/user.model";
import { UserSubscription } from "@models/user-subscription.model";
import { SubscriptionPlan } from "@models/subscription-plan.model";
import { logger } from "@utils/logger";
import type { 
    ServiceResponse, 
    FormattedSubscription, 
    UpgradeSubscriptionOptions 
} from './user.types';

export const getUserSubscriptionService = async (userId: string): Promise<ServiceResponse<FormattedSubscription>> => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        // Get user subscription
        let subscription = null;

        if (user.subscriptionId) {
            subscription = await UserSubscription.findById(user.subscriptionId).lean();
        }

        // If no subscription exists, create a free subscription
        if (!subscription) {
            subscription = await createFreeSubscription(userId);
        }

        // Format the response for frontend
        const formattedSubscription: FormattedSubscription = {
            id: subscription._id.toString(),
            userId: subscription.userId.toString(),
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

export const upgradeSubscriptionService = async (
    userId: string, 
    options: UpgradeSubscriptionOptions
): Promise<ServiceResponse<any>> => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        // Check if plan exists
        const plan = await SubscriptionPlan.findOne({ 
            planId: options.planId, 
            isActive: true 
        });
        
        if (!plan) {
            throw new Error("Subscription plan not found or inactive");
        }

        // Validate payment for paid plans
        if (plan.planId !== 'free' && plan.price > 0 && !options.paymentMethodId && !user.stripeCustomerId) {
            throw new Error("Payment method is required for paid plans");
        }

        // Create expiration date based on billing cycle
        const expirationDate = calculateExpirationDate(plan.billingCycle);

        // Create or update subscription
        const subscription = await createOrUpdateSubscription(user, plan, expirationDate);

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

// Helper functions
const createFreeSubscription = async (userId: string) => {
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

    const subscription = await newSubscription.save();

    // Update user with subscription ID
    await User.findByIdAndUpdate(userId, { subscriptionId: subscription._id });

    return subscription;
};

const calculateExpirationDate = (billingCycle: string): Date => {
    const expirationDate = new Date();
    
    if (billingCycle === 'monthly') {
        expirationDate.setMonth(expirationDate.getMonth() + 1);
    } else if (billingCycle === 'yearly') {
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
    }
    
    return expirationDate;
};

const createOrUpdateSubscription = async (user: any, plan: any, expirationDate: Date) => {
    if (user.subscriptionId) {
        // Update existing subscription
        const subscription = await UserSubscription.findByIdAndUpdate(
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
        return subscription;
    } else {
        // Create new subscription
        const newSubscription = new UserSubscription({
            userId: new mongoose.Types.ObjectId(user._id),
            planId: plan.planId,
            planName: plan.name,
            status: "active",
            limits: plan.limits,
            currentPeriodStart: new Date(),
            currentPeriodEnd: expirationDate
        });

        const subscription = await newSubscription.save();

        // Update user with subscription ID
        await User.findByIdAndUpdate(user._id, {
            subscriptionId: subscription._id
        });

        return subscription;
    }
};

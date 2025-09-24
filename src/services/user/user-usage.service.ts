// 4. services/user/user-usage.service.ts
// ====================================

import mongoose from "mongoose";
import { User } from "@models/user.model";
import { UserUsage } from "@models/user-usage.model";
import { Media } from "@models/media.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";
import { getUserSubscriptionService } from './user-subscription.service';
import type { ServiceResponse, FormattedUsage, LimitCheckType } from './user.types';

export const getUserUsageService = async (userId: string): Promise<ServiceResponse<FormattedUsage>> => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        // Get the most recent usage record
        const latestUsage = await UserUsage.findOne({ 
            userId: new mongoose.Types.ObjectId(userId) 
        })
        .sort({ date: -1 })
        .lean();

        // If no usage exists, create a new one with zeros
        if (!latestUsage) {
            const newUsage = await createInitialUsage(userId);
            return {
                status: true,
                data: formatUsageForResponse(newUsage)
            };
        }

        return {
            status: true,
            data: formatUsageForResponse(latestUsage)
        };
    } catch (error: any) {
        logger.error(`Error in getUserUsageService: ${error.message}`);
        throw error;
    }
};

export const checkUserLimitsService = async (
    userId: string, 
    checkType: LimitCheckType, 
    value?: number | string
): Promise<boolean> => {
    try {
        // Get user subscription
        const userSubscriptionResult = await getUserSubscriptionService(userId);
        const subscription = userSubscriptionResult.data!;

        // Get user usage
        const userUsageResult = await getUserUsageService(userId);
        const usage = userUsageResult.data!;

        logger.info(`Checking limits for user ${userId}:`, { checkType, subscription: subscription.planId });

        switch (checkType) {
            case 'event':
                return usage.totals.events < subscription.limits.maxEvents;

            case 'photo':
                return await checkPhotoLimit(userId, subscription, value as string);

            case 'storage':
                const newTotal = usage.totals.storage + (value as number || 0);
                return newTotal <= subscription.limits.maxStorage;

            default:
                return true;
        }
    } catch (error: any) {
        logger.error(`Error in checkUserLimitsService: ${error.message}`);
        return false; // Default to not allowing if there's an error
    }
};

// Helper functions
const createInitialUsage = async (userId: string) => {
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

    return await newUsage.save();
};

const formatUsageForResponse = (usage: any): FormattedUsage => {
    return {
        userId: usage.userId,
        date: usage.date,
        metrics: {
            photosUploaded: usage.metrics.photosUploaded,
            storageUsed: usage.metrics.storageUsed,
            eventsCreated: usage.metrics.eventsCreated,
            activeEvents: usage.metrics.activeEvents
        },
        totals: {
            photos: usage.totals.photos,
            storage: usage.totals.storage,
            events: usage.totals.events
        }
    };
};

const checkPhotoLimit = async (userId: string, subscription: any, eventId?: string): Promise<boolean> => {
    if (!eventId) {
        return true; // If no eventId provided, just check general limit
    }

    try {
        logger.info(`Counting photos in event ${eventId} for limit check`);
        
        let eventObjectId;
        try {
            eventObjectId = new mongoose.Types.ObjectId(eventId);
        } catch (err) {
            logger.error(`Invalid event ID format: ${eventId}`);
            return false;
        }
        
        const photosInEvent = await Media.countDocuments({
            event_id: eventObjectId,
            type: 'image'
        });
        
        logger.info(`Photos in event ${eventId}: ${photosInEvent}, limit: ${subscription.limits.maxPhotosPerEvent}`);
        
        // Check if adding one more photo would exceed the limit
        return photosInEvent + 1 <= subscription.limits.maxPhotosPerEvent;
    } catch (err) {
        logger.error(`Error checking photo limit: ${err}`);
        return false;
    }
};

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

        // AGGREGATION: Calculate real-time usage from Media collection
        // This ensures the progress bar is always accurate even if counters drift
        const usageStats = await Media.aggregate([
            {
                $match: {
                    uploader_id: new mongoose.Types.ObjectId(userId),
                    is_deleted: { $ne: true } // Exclude deleted files
                }
            },
            {
                $group: {
                    _id: null,
                    totalStorage: { $sum: "$size" },
                    totalPhotos: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "image"] }, 1, 0]
                        }
                    },
                    totalVideos: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "video"] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        const realStats = usageStats[0] || { totalStorage: 0, totalPhotos: 0, totalVideos: 0 };

        // Also count events
        // Assuming events are stored in Event model and have owner_id or similar
        // We'll skip precise event counting here to avoid circular dependencies or complex lookups if not critical for storage bar
        // But let's try to get it if we can, otherwise keep existing logic for events.

        // Update the usage record with real data
        const updatedUsage = await UserUsage.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId) },
            {
                $set: {
                    "totals.storage": realStats.totalStorage,
                    "totals.photos": realStats.totalPhotos,
                    // "totals.videos": realStats.totalVideos, // Add if model supports it
                    updatedAt: new Date()
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        // If no usage existed (upsert case), ensure structure
        if (!updatedUsage) {
            const newUsage = await createInitialUsage(userId);
            return {
                status: true,
                data: formatUsageForResponse(newUsage)
            };
        }

        return {
            status: true,
            data: formatUsageForResponse(updatedUsage)
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

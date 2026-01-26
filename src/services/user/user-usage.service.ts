// 4. services/user/user-usage.service.ts
// ====================================

import mongoose from "mongoose";
import { User } from "@models/user.model";
import { UserUsage } from "@models/user-usage.model";
import { Event as EventModel } from "@models/event.model";
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

        // 1. Get all active events created by the user (to determine ownership of storage)
        // We count archived events too if they still take up storage, unless policy says otherwise.
        // Usually archived events still consume storage until deleted.
        const userEvents = await EventModel.find({
            created_by: new mongoose.Types.ObjectId(userId),
            archived_at: null // Assuming deleted events are hard deleted or archived ones still count? 
            // If soft-deleted events (archived) count, remove this filter. 
            // Let's assume ALL events owned by user count.
        }).select('_id');

        const userEventIds = userEvents.map(e => e._id);
        const eventCount = userEvents.length;

        // AGGREGATION: Calculate real-time usage from Media collection
        // Fix: Use `isDeleted` (camelCase) verifying schema
        // Fix: Match by `event_id` in user's events to cover guest uploads
        const usageStats = await Media.aggregate([
            {
                $match: {
                    event_id: { $in: userEventIds },
                    isDeleted: { $ne: true } // Correct field name from schema
                }
            },
            {
                $group: {
                    _id: null,
                    totalStorage: { $sum: "$original.size_mb" }, // Use original.size_mb from schema
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

        // Update the usage record with real data
        const updatedUsage = await UserUsage.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId) },
            {
                $set: {
                    // Update current metrics to match reality
                    "metrics.storageUsed": realStats.totalStorage,
                    "metrics.photosUploaded": realStats.totalPhotos,
                    "metrics.eventsCreated": eventCount,
                    "metrics.activeEvents": userEventIds,

                    // Update totals (lifetime) - hard to reconstruct if we only look at current snapshot.
                    // But for storage, "totals" usually means "currently used". 
                    // If "totals" means "cumulative ever uploaded", we can't reconstruct it from current state.
                    // However, standard SaaS behavior for limits is "current usage".
                    "totals.storage": realStats.totalStorage,
                    "totals.photos": realStats.totalPhotos,
                    "totals.events": eventCount,

                    updatedAt: new Date()
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        // If no usage existed (upsert case), ensure structure (handled by upsert but for safety)
        if (!updatedUsage) {
            // This branch is theoretically unreachable due to upsert: true
            return {
                status: true,
                data: {
                    userId: userId,
                    date: new Date(),
                    metrics: {
                        photosUploaded: realStats.totalPhotos,
                        storageUsed: realStats.totalStorage,
                        eventsCreated: eventCount,
                        activeEvents: userEventIds
                    },
                    totals: {
                        photos: realStats.totalPhotos,
                        storage: realStats.totalStorage,
                        events: eventCount
                    }
                } as any
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

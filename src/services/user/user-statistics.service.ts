// 5. services/user/user-statistics.service.ts
// ====================================

import mongoose from "mongoose";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import { logger } from "@utils/logger";
import type { ServiceResponse, UserStatistics } from './user.types';

export const getUserStatisticsService = async (userId: string): Promise<ServiceResponse<UserStatistics>> => {
    try {
        const objectId = new mongoose.Types.ObjectId(userId);

        // Get all statistics in parallel for better performance
        const [
            totalHostedEvents,
            eventsWithUserMedia,
            totalPhotos,
            totalVideos,
            hostedEventIds
        ] = await Promise.all([
            Event.countDocuments({ created_by: objectId }),
            Media.distinct("event_id", { uploaded_by: objectId }),
            Media.countDocuments({ uploaded_by: objectId, type: "image" }),
            Media.countDocuments({ uploaded_by: objectId, type: "video" }),
            Event.distinct("_id", { created_by: objectId })
        ]);

        const totalAttendingEvents = eventsWithUserMedia.length;

        // Get total events (combination of hosted and attended)
        // Use a Set to avoid duplicate event IDs
        const totalEvents = new Set([...hostedEventIds, ...eventsWithUserMedia]).size;

        const statistics: UserStatistics = {
            totalEvents,
            totalHostedEvents,
            totalAttendingEvents,
            totalPhotos,
            totalVideos,
            totalMedia: totalPhotos + totalVideos
        };

        return {
            status: true,
            data: statistics
        };
    } catch (error: any) {
        logger.error(`Error in getUserStatisticsService: ${error.message}`);
        return {
            status: false,
            message: `Failed to get user statistics: ${error.message}`
        };
    }
};
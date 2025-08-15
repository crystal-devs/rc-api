// 6. services/guest/guest-stats.service.ts
// ====================================

import mongoose from 'mongoose';
import { Media } from '@models/media.model';
import { logger } from '@utils/logger';
import type { GuestUploadStats } from './guest.types';

export const getGuestUploadStats = async (eventId: string): Promise<GuestUploadStats> => {
    try {
        const eventObjectId = new mongoose.Types.ObjectId(eventId);

        const totalGuestUploads = await Media.countDocuments({
            event_id: eventObjectId,
            uploader_type: 'guest'
        });

        const uniqueGuests = await Media.distinct('guest_uploader.guest_id', {
            event_id: eventObjectId,
            uploader_type: 'guest'
        });

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentUploads = await Media.countDocuments({
            event_id: eventObjectId,
            uploader_type: 'guest',
            created_at: { $gte: oneDayAgo }
        });

        return {
            totalGuestUploads,
            totalGuestUploaders: uniqueGuests.length,
            recentUploads,
            avgUploadsPerGuest: uniqueGuests.length > 0 ?
                Math.round(totalGuestUploads / uniqueGuests.length * 100) / 100 : 0
        };

    } catch (error: any) {
        logger.error('Error getting guest upload stats:', error);
        return {
            totalGuestUploads: 0,
            totalGuestUploaders: 0,
            recentUploads: 0,
            avgUploadsPerGuest: 0
        };
    }
};


import { Event } from '@models/event.model';
import { logger } from '@utils/logger';

export const validatePermissionsAndGetApproval = async (eventId: string, userId?: string) => {
    const event = await Event.findById(eventId)
        .select('permissions created_by')
        .lean();

    if (!event) {
        throw new Error('Event not found');
    }

    const creatorId = event.created_by?.toString();
    const uploaderId = userId?.toString();

    logger.info('🔍 Media Upload Permission Check:', {
        eventId,
        creatorId,
        uploaderId,
        isMatch: creatorId === uploaderId
    });

    // Auto-approve if uploader is the event creator
    if (creatorId && uploaderId && creatorId === uploaderId) {
        logger.info(`✅ Auto-approving upload for event creator: ${uploaderId}`);
        return {
            status: 'approved',
            auto_approval_reason: 'event_creator',
            approved_by: userId,
            approved_at: new Date()
        };
    }

    logger.info(`⏳ Setting upload status to pending for user: ${uploaderId}`);
    return {
        status: 'pending',
        auto_approval_reason: null,
        approved_by: null,
        approved_at: null
    };
};

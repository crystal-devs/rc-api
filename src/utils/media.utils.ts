import { logger } from '@utils/logger';
import { determineApprovalStatus } from './user.utils';

export const validatePermissionsAndGetApproval = async (eventId: string, userId?: string) => {
    logger.info('🔍 Media Upload Permission Check:', {
        eventId,
        uploaderId: userId
    });

    const result = await determineApprovalStatus(eventId, userId);

    if (result.status === 'auto_approved') {
        logger.info(`✅ Auto-approving upload: ${result.autoApprovalReason}`);
    } else if (result.status === 'pending') {
        logger.info(`⏳ Setting upload status to pending`);
    }

    return {
        status: result.status === 'auto_approved' ? 'approved' : result.status,
        auto_approval_reason: result.autoApprovalReason,
        approved_by: result.approvedBy,
        approved_at: result.approvedAt
    };
};

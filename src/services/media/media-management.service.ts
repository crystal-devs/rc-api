// 3. services/media/media-management.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { mediaNotificationService } from '../websocket/notifications';
import type { ServiceResponse, StatusUpdateOptions } from './media.types';

export const updateMediaStatusService = async (
    mediaId: string,
    status: string,
    options: StatusUpdateOptions
): Promise<ServiceResponse<any>> => {
    try {
        // Validate mediaId
        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'A valid media ID is required' }
            };
        }

        // Find the media item
        const media = await Media.findById(mediaId).select(
            'approval event_id url image_variants original_filename type'
        );

        if (!media) {
            return {
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media with the provided ID does not exist' }
            };
        }

        const previousStatus = media.approval?.status;
        const eventId = media.event_id.toString();

        // Build update object
        const updateObj: any = {
            'approval.status': status,
            updated_at: new Date()
        };

        if (status === 'approved' || status === 'auto_approved') {
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
            updateObj['approval.approved_at'] = new Date();
            updateObj['approval.rejection_reason'] = '';
        } else if (status === 'rejected') {
            updateObj['approval.rejection_reason'] = options.reason || 'Rejected by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        } else if (status === 'hidden') {
            updateObj['approval.rejection_reason'] = options.hideReason || 'Hidden by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        }

        const updatedMedia = await Media.findByIdAndUpdate(
            mediaId,
            updateObj,
            { new: true, lean: true }
        );

        // Broadcast status change via WebSocket
        try {
            mediaNotificationService.broadcastMediaStats(eventId);
            logger.info('📤 WebSocket status update and stats broadcasted', {
                mediaId: mediaId.substring(0, 8) + '...',
                previousStatus,
                newStatus: status,
                eventId: eventId.substring(0, 8) + '...'
            });
        } catch (wsError) {
            logger.error('❌ Failed to broadcast via WebSocket:', wsError);
        }

        logger.info('Media status updated:', {
            mediaId,
            previousStatus,
            newStatus: status,
            adminId: options.adminId
        });

        return {
            status: true,
            code: 200,
            message: 'Media status updated successfully',
            data: updatedMedia,
            error: null,
            other: {
                previousStatus,
                newStatus: status,
                websocketBroadcasted: true
            }
        };

    } catch (error: any) {
        logger.error('Error in updateMediaStatusService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to update media status',
            data: null,
            error: { message: error.message }
        };
    }
};

export const bulkUpdateMediaStatusService = async (
    eventId: string,
    mediaIds: string[],
    status: string,
    options: StatusUpdateOptions
): Promise<ServiceResponse<any>> => {
    try {
        // Validate eventId
        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'A valid event ID is required' }
            };
        }

        // Validate mediaIds
        const validMediaIds = mediaIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validMediaIds.length === 0) {
            return {
                status: false,
                code: 400,
                message: 'No valid media IDs provided',
                data: null,
                error: { message: 'At least one valid media ID is required' }
            };
        }

        // Prepare update object
        const updateObj: any = {
            'approval.status': status,
            updated_at: new Date()
        };

        if (status === 'approved' || status === 'auto_approved') {
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
            updateObj['approval.approved_at'] = new Date();
            updateObj['approval.rejection_reason'] = '';
        } else if (status === 'rejected') {
            updateObj['approval.rejection_reason'] = options.reason || 'Bulk rejected by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        } else if (status === 'hidden') {
            updateObj['approval.rejection_reason'] = options.hideReason || 'Bulk hidden by admin';
            updateObj['approval.approved_by'] = options.adminId ? new mongoose.Types.ObjectId(options.adminId) : null;
        }

        // Perform bulk update
        const result = await Media.updateMany(
            {
                _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            updateObj
        );

        // Broadcast stats update after bulk change
        try {
            mediaNotificationService.broadcastMediaStats(eventId);
            logger.info(`📤 Bulk WebSocket stats update broadcasted for ${result.modifiedCount} items`);
        } catch (wsError) {
            logger.error('❌ Failed to broadcast bulk update via WebSocket:', wsError);
        }

        logger.info('Bulk media status update completed:', {
            eventId,
            mediaCount: validMediaIds.length,
            modifiedCount: result.modifiedCount,
            status
        });

        return {
            status: true,
            code: 200,
            message: `Successfully updated ${result.modifiedCount} media items`,
            data: {
                modifiedCount: result.modifiedCount,
                requestedCount: validMediaIds.length
            },
            error: null,
            other: {
                newStatus: status,
                updatedBy: options.adminId || 'system',
                websocketBroadcasted: true
            }
        };

    } catch (error: any) {
        logger.error('Error in bulkUpdateMediaStatusService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to bulk update media status',
            data: null,
            error: { message: error.message }
        };
    }
};

export const deleteMediaService = async (
    mediaId: string,
    userId: string,
    options?: {
        adminName?: string;
        reason?: string;
    }
): Promise<ServiceResponse<any>> => {
    try {
        // Validate inputs
        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid media ID',
                data: null,
                error: { message: 'A valid media ID is required' }
            };
        }

        // Find the media item BEFORE deletion
        const media = await Media.findById(mediaId).select(
            'event_id url original_filename type approval.status'
        );

        if (!media) {
            return {
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media item does not exist' }
            };
        }

        const eventId = media.event_id.toString();
        const wasVisible = ['approved', 'auto_approved'].includes(media.approval?.status || '');

        // Delete the media record
        await Media.findByIdAndDelete(mediaId);

        // Broadcast deletion to guests if the image was visible
        if (wasVisible) {
            try {
                mediaNotificationService.broadcastMediaRemoved({
                    mediaId,
                    eventId,
                    reason: options?.reason || 'deleted_by_admin',
                    adminName: options?.adminName
                });

                // Also update stats since total count changed
                mediaNotificationService.broadcastMediaStats(eventId);

                logger.info('📤 Media deletion broadcasted to guests', {
                    mediaId: mediaId.substring(0, 8) + '...',
                    eventId: eventId.substring(0, 8) + '...',
                    wasVisible
                });
            } catch (wsError) {
                logger.error('❌ Failed to broadcast media deletion via WebSocket:', wsError);
            }
        }

        logger.info('Media deleted successfully:', {
            mediaId,
            deletedBy: userId,
            eventId,
            wasVisibleToGuests: wasVisible
        });

        return {
            status: true,
            code: 200,
            message: 'Media deleted successfully',
            data: {
                id: mediaId,
                wasVisibleToGuests: wasVisible
            },
            error: null,
            other: {
                websocketBroadcasted: wasVisible
            }
        };

    } catch (error: any) {
        logger.error('Error in deleteMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to delete media',
            data: null,
            error: { message: error.message }
        };
    }
};

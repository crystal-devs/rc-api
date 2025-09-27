// 3. services/media/media-management.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { EventParticipant } from '@models/event-participants.model';
import { mediaNotificationService } from '../websocket/notifications';
import type { ServiceResponse, StatusUpdateOptions } from './media.types';
import { getPhotoWallWebSocketService } from '@services/photoWallWebSocketService';

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

        // Find the media item with additional fields for counter logic
        const media = await Media.findById(mediaId).select(
            'approval event_id url image_variants original_filename type uploaded_by size_mb'
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
        const uploadedBy = media.uploaded_by;
        const sizeMB = media.size_mb || 0;

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

        // Update Event and Participant counters based on status change
        try {
            await updateCountersForStatusChange(eventId, uploadedBy, previousStatus, status, sizeMB);
        } catch (counterError) {
            logger.warn('Failed to update counters for status change:', counterError);
            // Don't fail the operation if counter update fails
        }

        // Get event share token for PhotoWall notification
        let shareToken: string | null = null;
        if (status === 'approved' || status === 'auto_approved') {
            try {
                const event = await Event.findById(eventId).select('share_token').lean();
                shareToken = event?.share_token || null;
            } catch (eventError) {
                logger.warn('Could not fetch share token for PhotoWall notification', { eventId });
            }
        }

        // Broadcast status change via WebSocket
        try {
            mediaNotificationService.broadcastMediaStats(eventId);

            // Notify PhotoWall if media was approved and we have share token
            if ((status === 'approved' || status === 'auto_approved') &&
                shareToken &&
                previousStatus !== 'approved' &&
                previousStatus !== 'auto_approved') {

                const photoWallService = getPhotoWallWebSocketService();
                if (photoWallService) {
                    await photoWallService.notifyNewMediaUpload(shareToken, updatedMedia);
                }
            }

            logger.info('WebSocket status update and stats broadcasted', {
                mediaId: mediaId.substring(0, 8) + '...',
                previousStatus,
                newStatus: status,
                eventId: eventId.substring(0, 8) + '...',
                photoWallNotified: !!(shareToken && (status === 'approved' || status === 'auto_approved'))
            });
        } catch (wsError) {
            logger.error('Failed to broadcast via WebSocket:', wsError);
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
                websocketBroadcasted: true,
                photoWallNotified: !!(shareToken && (status === 'approved' || status === 'auto_approved'))
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

        // Get media items with their current status for counter calculations
        const mediaItems = await Media.find({
            _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
            event_id: new mongoose.Types.ObjectId(eventId)
        }).select('approval.status uploaded_by size_mb type').lean();

        if (mediaItems.length === 0) {
            return {
                status: false,
                code: 404,
                message: 'No media items found',
                data: null,
                error: { message: 'No matching media items found for the provided IDs' }
            };
        }

        // Get share token if we're approving media for PhotoWall
        let shareToken: string | null = null;
        if (status === 'approved' || status === 'auto_approved') {
            try {
                const event = await Event.findById(eventId).select('share_token').lean();
                shareToken = event?.share_token || null;
            } catch (eventError) {
                logger.warn('Could not fetch share token for bulk PhotoWall notification', { eventId });
            }
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

        // Get newly approved media for PhotoWall notification
        const newlyApprovedMedia = mediaItems.filter(media =>
            !['approved', 'auto_approved'].includes(media.approval?.status || '') &&
            (status === 'approved' || status === 'auto_approved')
        );

        // Perform bulk update
        const result = await Media.updateMany(
            {
                _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            updateObj
        );

        // Update counters in bulk for better performance
        try {
            await updateBulkCountersForStatusChange(eventId, mediaItems, status);
        } catch (counterError) {
            logger.warn('Failed to update bulk counters:', counterError);
            // Don't fail the operation if counter update fails
        }

        // Broadcast stats update after bulk change
        try {
            mediaNotificationService.broadcastMediaStats(eventId);

            // Notify PhotoWall for each newly approved media
            if ((status === 'approved' || status === 'auto_approved') &&
                shareToken &&
                newlyApprovedMedia.length > 0) {

                const photoWallService = getPhotoWallWebSocketService();
                if (photoWallService) {
                    for (const media of newlyApprovedMedia) {
                        await photoWallService.notifyNewMediaUpload(shareToken, media);
                    }
                }
            }

            logger.info(`Bulk WebSocket stats update broadcasted for ${result.modifiedCount} items`, {
                photoWallNotifications: newlyApprovedMedia.length
            });
        } catch (wsError) {
            logger.error('Failed to broadcast bulk update via WebSocket:', wsError);
        }

        logger.info('Bulk media status update completed:', {
            eventId,
            mediaCount: validMediaIds.length,
            modifiedCount: result.modifiedCount,
            status,
            newlyApprovedForPhotoWall: newlyApprovedMedia.length
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
                websocketBroadcasted: true,
                photoWallNotifications: newlyApprovedMedia.length
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

        // Find the media item AND get share token in one query
        const media = await Media.findById(mediaId)
            .select('event_id url original_filename type approval.status uploaded_by size_mb')
            .populate('event_id', 'share_token')
            .lean();

        if (!media) {
            return {
                status: false,
                code: 404,
                message: 'Media not found',
                data: null,
                error: { message: 'Media item does not exist' }
            };
        }

        const eventId = media.event_id._id?.toString() || media.event_id.toString();
        const shareToken = (media.event_id as any)?.share_token || null;
        const wasVisible = ['approved', 'auto_approved'].includes(media.approval?.status || '');
        const uploadedBy = media.uploaded_by;
        const sizeMB = media.size_mb || 0;

        // Delete the media record
        await Media.findByIdAndDelete(mediaId);

        // Update counters after deletion
        try {
            await updateCountersForDeletion(eventId, uploadedBy, media.approval?.status || 'pending', sizeMB);
        } catch (counterError) {
            logger.warn('Failed to update counters after deletion:', counterError);
            // Don't fail the operation if counter update fails
        }

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

                // Notify PhotoWall about media removal
                if (shareToken) {
                    const photoWallService = getPhotoWallWebSocketService();
                    if (photoWallService) {
                        await photoWallService.notifyMediaRemoved(
                            shareToken,
                            mediaId,
                            options?.reason || 'Removed by admin'
                        );
                    }
                }

                logger.info('Media deletion broadcasted to guests', {
                    mediaId: mediaId.substring(0, 8) + '...',
                    eventId: eventId.substring(0, 8) + '...',
                    wasVisible,
                    photoWallNotified: !!shareToken
                });
            } catch (wsError) {
                logger.error('Failed to broadcast media deletion via WebSocket:', wsError);
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
                websocketBroadcasted: wasVisible,
                photoWallNotified: !!(wasVisible && shareToken)
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

// Helper function to update counters for individual status changes
async function updateCountersForStatusChange(
    eventId: string,
    uploadedBy: mongoose.Types.ObjectId | null,
    previousStatus: string | undefined,
    newStatus: string,
    sizeMB: number
): Promise<void> {
    const wasApproved = ['approved', 'auto_approved'].includes(previousStatus || '');
    const isNowApproved = ['approved', 'auto_approved'].includes(newStatus);

    // No counter change needed if approval status didn't change
    if (wasApproved === isNowApproved) {
        return;
    }

    const increment = isNowApproved ? 1 : -1; // +1 if newly approved, -1 if newly rejected/hidden

    // Update Event stats
    await Event.updateOne(
        { _id: new mongoose.Types.ObjectId(eventId) },
        {
            $inc: { 'stats.photos': increment },
            $set: { 'updated_at': new Date() }
        }
    );

    // Update EventParticipant stats if uploaded by registered user
    if (uploadedBy) {
        await EventParticipant.updateOne(
            {
                user_id: uploadedBy,
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            {
                $inc: { 'stats.approved_uploads': increment },
                $set: { 'last_activity_at': new Date() }
            }
        );
    }

    logger.debug(`Updated counters for status change: ${previousStatus} -> ${newStatus}`, {
        eventId,
        increment,
        uploadedBy: uploadedBy?.toString()
    });
}

// Helper function to update counters for bulk status changes
async function updateBulkCountersForStatusChange(
    eventId: string,
    mediaItems: any[],
    newStatus: string
): Promise<void> {
    // Calculate net changes
    let eventPhotoIncrement = 0;
    const participantIncrements = new Map<string, number>();

    for (const media of mediaItems) {
        const wasApproved = ['approved', 'auto_approved'].includes(media.approval?.status || '');
        const isNowApproved = ['approved', 'auto_approved'].includes(newStatus);

        if (wasApproved !== isNowApproved) {
            const increment = isNowApproved ? 1 : -1;
            eventPhotoIncrement += increment;

            // Track participant increments
            if (media.uploaded_by) {
                const userId = media.uploaded_by.toString();
                participantIncrements.set(userId, (participantIncrements.get(userId) || 0) + increment);
            }
        }
    }

    // Update Event stats if there's a net change
    if (eventPhotoIncrement !== 0) {
        await Event.updateOne(
            { _id: new mongoose.Types.ObjectId(eventId) },
            {
                $inc: { 'stats.photos': eventPhotoIncrement },
                $set: { 'updated_at': new Date() }
            }
        );
    }

    // Update EventParticipant stats for each participant
    for (const [userId, increment] of participantIncrements) {
        if (increment !== 0) {
            await EventParticipant.updateOne(
                {
                    user_id: new mongoose.Types.ObjectId(userId),
                    event_id: new mongoose.Types.ObjectId(eventId)
                },
                {
                    $inc: { 'stats.approved_uploads': increment },
                    $set: { 'last_activity_at': new Date() }
                }
            );
        }
    }

    logger.debug(`Updated bulk counters for ${mediaItems.length} items`, {
        eventId,
        eventPhotoIncrement,
        participantUpdates: participantIncrements.size
    });
}

// Helper function to update counters for deletion
async function updateCountersForDeletion(
    eventId: string,
    uploadedBy: mongoose.Types.ObjectId | null,
    deletedStatus: string,
    sizeMB: number
): Promise<void> {
    // Only decrement if the deleted media was approved/visible
    const wasApproved = ['approved', 'auto_approved'].includes(deletedStatus);

    if (!wasApproved) {
        return; // No counter update needed for non-approved media
    }

    // Update Event stats
    await Event.updateOne(
        { _id: new mongoose.Types.ObjectId(eventId) },
        {
            $inc: {
                'stats.photos': -1,
                'stats.total_size_mb': -sizeMB
            },
            $set: { 'updated_at': new Date() }
        }
    );

    // Update EventParticipant stats if uploaded by registered user
    if (uploadedBy) {
        await EventParticipant.updateOne(
            {
                user_id: uploadedBy,
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            {
                $inc: {
                    'stats.uploads_count': -1,
                    'stats.approved_uploads': -1,
                    'stats.total_file_size_mb': -sizeMB
                },
                $set: { 'last_activity_at': new Date() }
            }
        );
    }

    logger.debug(`Updated counters for deletion`, {
        eventId,
        wasApproved,
        uploadedBy: uploadedBy?.toString()
    });
}
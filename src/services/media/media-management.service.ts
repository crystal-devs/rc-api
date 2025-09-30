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
import { imagekit } from '@configs/imagekit.config';
import { FileObject } from 'imagekit/dist/libs/interfaces';
// import { queueStorageCleanup } from 'workers/storageCleanupWorker';
import { queueStorageCleanup } from 'workers/batchStorageCleanupWorker';
import { validateAndCleanUrls } from '@utils/file.util';

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

        // Find the media item
        const media = await Media.findById(mediaId)
            .select('event_id url image_variants original_filename type approval.status uploaded_by size_mb')
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

        // IMPROVED: Collect all URLs with better validation
        const urlsToDelete = collectAllMediaUrls(media);
        const { validUrls, invalidUrls } = validateAndCleanUrls(urlsToDelete);

        if (invalidUrls.length > 0) {
            logger.warn(`Found ${invalidUrls} invalid URLs for media ${mediaId}`, {
                invalidUrls: invalidUrls.slice(0, 3)
            });
        }

        logger.info(`Collected ${validUrls} valid URLs for deletion ${urlsToDelete.length}`, {
            mediaId,
            totalUrls: urlsToDelete.length,
            validUrls: validUrls.length,
            invalidUrls: invalidUrls.length,
            sampleUrls: validUrls.slice(0, 3)
        });

        // STEP 1: Delete from database IMMEDIATELY (for instant UI response)
        await Media.findByIdAndDelete(mediaId);

        // STEP 2: Update counters
        try {
            await updateCountersForDeletion(eventId, uploadedBy, media.approval?.status || 'pending', sizeMB);
        } catch (counterError) {
            logger.warn('Failed to update counters after deletion:', counterError);
        }

        // STEP 3: Broadcast deletion to guests if visible
        if (wasVisible) {
            try {
                mediaNotificationService.broadcastMediaRemoved({
                    mediaId,
                    eventId,
                    reason: options?.reason || 'deleted_by_admin',
                    adminName: options?.adminName
                });

                mediaNotificationService.broadcastMediaStats(eventId);

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
            } catch (wsError) {
                logger.error('Failed to broadcast media deletion via WebSocket:', wsError);
            }
        }

        // STEP 4: Queue storage cleanup in background (non-blocking) - ONLY valid URLs
        if (validUrls.length > 0) {
            logger.info(`Queueing storage cleanup for ${validUrls.length} valid URLs`);
            queueStorageCleanup({
                mediaId,
                urls: validUrls, // Only pass valid URLs
                eventId,
                userId,
                isBulk: false
            }).catch((error: any) => {
                logger.error('Failed to queue storage cleanup:', error);
            });
        } else {
            logger.info('No valid URLs to cleanup for media deletion');
        }

        logger.info('Media deleted successfully (storage cleanup queued):', {
            mediaId,
            deletedBy: userId,
            eventId,
            urlsToCleanup: validUrls.length
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
                photoWallNotified: !!(wasVisible && shareToken),
                storageCleanupQueued: validUrls.length > 0,
                validUrlsQueued: validUrls.length,
                invalidUrlsSkipped: invalidUrls.length
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


/**
 * Bulk delete multiple media items
 */
export const bulkDeleteMediaService = async (
    eventId: string,
    mediaIds: string[],
    userId: string,
    options?: {
        adminName?: string;
        reason?: string;
    }
): Promise<ServiceResponse<any>> => {
    try {
        // Validation
        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid event ID',
                data: null,
                error: { message: 'A valid event ID is required' }
            };
        }

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

        // Get media items for URL collection
        const mediaItems = await Media.find({
            _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
            event_id: new mongoose.Types.ObjectId(eventId)
        }).select('url image_variants approval.status uploaded_by size_mb')
            .populate('event_id', 'share_token')
            .lean();

        if (mediaItems.length === 0) {
            return {
                status: false,
                code: 404,
                message: 'No media items found',
                data: null,
                error: { message: 'No matching media items found for the provided IDs' }
            };
        }

        const shareToken = (mediaItems[0].event_id as any)?.share_token || null;
        const visibleMediaIds: string[] = [];

        // IMPROVED: Collect all URLs with better validation
        const allUrls: string[] = [];
        mediaItems.forEach(media => {
            const urls = collectAllMediaUrls(media);
            allUrls.push(...urls);

            if (['approved', 'auto_approved'].includes(media.approval?.status || '')) {
                visibleMediaIds.push(media._id.toString());
            }
        });

        const { validUrls, invalidUrls } = validateAndCleanUrls(allUrls);

        if (invalidUrls.length > 0) {
            logger.warn(`Found ${invalidUrls.length} invalid URLs for bulk deletion`, {
                eventId,
                mediaCount: mediaItems.length,
                invalidUrls: invalidUrls.slice(0, 3)
            });
        }

        logger.info(`Collected URLs for bulk deletion`, {
            eventId,
            mediaItems: mediaItems.length,
            totalUrls: allUrls.length,
            validUrls: validUrls.length,
            invalidUrls: invalidUrls.length
        });

        // STEP 1: Delete from database IMMEDIATELY
        const deleteResult = await Media.deleteMany({
            _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
            event_id: new mongoose.Types.ObjectId(eventId)
        });

        // STEP 2: Update counters
        try {
            await updateBulkCountersForDeletion(eventId, mediaItems);
        } catch (counterError) {
            logger.warn('Failed to update bulk counters for deletion:', counterError);
        }

        // STEP 3: Broadcast deletions
        if (visibleMediaIds.length > 0) {
            try {
                for (const mediaId of visibleMediaIds) {
                    mediaNotificationService.broadcastMediaRemoved({
                        mediaId,
                        eventId,
                        reason: options?.reason || 'bulk_deleted_by_admin',
                        adminName: options?.adminName
                    });
                }

                mediaNotificationService.broadcastMediaStats(eventId);

                if (shareToken) {
                    const photoWallService = getPhotoWallWebSocketService();
                    if (photoWallService) {
                        for (const mediaId of visibleMediaIds) {
                            await photoWallService.notifyMediaRemoved(
                                shareToken,
                                mediaId,
                                options?.reason || 'Bulk removed by admin'
                            );
                        }
                    }
                }
            } catch (wsError) {
                logger.error('Failed to broadcast bulk media deletion via WebSocket:', wsError);
            }
        }

        // STEP 4: Queue storage cleanup in background - ONLY valid URLs
        if (validUrls.length > 0) {
            logger.info(`Queueing bulk storage cleanup for ${validUrls.length} valid URLs`);
            queueStorageCleanup({
                mediaId: `bulk-${eventId}-${Date.now()}`,
                urls: validUrls, // Only pass valid URLs
                eventId,
                userId,
                isBulk: true
            }).catch((error: any) => {
                logger.error('Failed to queue bulk storage cleanup:', error);
            });
        } else {
            logger.info('No valid URLs to cleanup for bulk media deletion');
        }

        logger.info('Bulk media deletion completed:', {
            eventId,
            requestedCount: validMediaIds.length,
            deletedFromDb: deleteResult.deletedCount,
            urlsToCleanup: validUrls.length
        });

        return {
            status: true,
            code: 200,
            message: `Successfully deleted ${deleteResult.deletedCount} media items`,
            data: {
                deletedCount: deleteResult.deletedCount,
                requestedCount: validMediaIds.length,
                visibleMediaDeleted: visibleMediaIds.length
            },
            error: null,
            other: {
                websocketBroadcasted: visibleMediaIds.length > 0,
                photoWallNotified: !!(shareToken && visibleMediaIds.length > 0),
                storageCleanupQueued: validUrls.length > 0,
                validUrlsQueued: validUrls.length,
                invalidUrlsSkipped: invalidUrls.length
            }
        };

    } catch (error: any) {
        logger.error('Error in bulkDeleteMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to bulk delete media',
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
// Helper function to update counters for bulk deletion
async function updateBulkCountersForDeletion(
    eventId: string,
    mediaItems: any[]
): Promise<void> {
    let eventPhotoDecrement = 0;
    let eventSizeDecrement = 0;
    const participantDecrements = new Map<string, { uploads: number; approved: number; size: number }>();

    for (const media of mediaItems) {
        const wasApproved = ['approved', 'auto_approved'].includes(media.approval?.status || '');
        const sizeMB = media.size_mb || 0;

        if (wasApproved) {
            eventPhotoDecrement += 1;
            eventSizeDecrement += sizeMB;
        }

        // Track participant decrements
        if (media.uploaded_by) {
            const userId = media.uploaded_by.toString();
            const current = participantDecrements.get(userId) || { uploads: 0, approved: 0, size: 0 };

            current.uploads += 1;
            current.size += sizeMB;
            if (wasApproved) {
                current.approved += 1;
            }

            participantDecrements.set(userId, current);
        }
    }

    // Update Event stats if there's a net change
    if (eventPhotoDecrement > 0 || eventSizeDecrement > 0) {
        await Event.updateOne(
            { _id: new mongoose.Types.ObjectId(eventId) },
            {
                $inc: {
                    'stats.photos': -eventPhotoDecrement,
                    'stats.total_size_mb': -eventSizeDecrement
                },
                $set: { 'updated_at': new Date() }
            }
        );
    }

    // Update EventParticipant stats for each participant
    for (const [userId, decrements] of participantDecrements) {
        if (decrements.uploads > 0 || decrements.approved > 0 || decrements.size > 0) {
            await EventParticipant.updateOne(
                {
                    user_id: new mongoose.Types.ObjectId(userId),
                    event_id: new mongoose.Types.ObjectId(eventId)
                },
                {
                    $inc: {
                        'stats.uploads_count': -decrements.uploads,
                        'stats.approved_uploads': -decrements.approved,
                        'stats.total_file_size_mb': -decrements.size
                    },
                    $set: { 'last_activity_at': new Date() }
                }
            );
        }
    }

    logger.debug(`Updated bulk deletion counters for ${mediaItems.length} items`, {
        eventId,
        eventPhotoDecrement,
        eventSizeDecrement,
        participantUpdates: participantDecrements.size
    });
}

// Helper function to collect all URLs from a media item
function collectAllMediaUrls(media: any): string[] {
    const urls = new Set<string>();

    // Add main URL if it exists and is valid
    if (media.url && typeof media.url === 'string' && media.url.trim()) {
        urls.add(media.url.trim());
    }

    // Add variant URLs if they exist
    if (media.image_variants && typeof media.image_variants === 'object') {
        const variants = media.image_variants;

        // Helper to safely add URL
        const addUrl = (obj: any) => {
            if (obj && typeof obj === 'object' && obj.url && typeof obj.url === 'string' && obj.url.trim()) {
                urls.add(obj.url.trim());
            }
        };

        // Original variant
        addUrl(variants.original);

        // Small variants
        if (variants.small) {
            addUrl(variants.small.webp);
            addUrl(variants.small.jpeg);
        }

        // Medium variants
        if (variants.medium) {
            addUrl(variants.medium.webp);
            addUrl(variants.medium.jpeg);
        }

        // Large variants
        if (variants.large) {
            addUrl(variants.large.webp);
            addUrl(variants.large.jpeg);
        }
    }

    const urlArray = Array.from(urls);

    logger.debug(`Collected ${urlArray.length} URLs for media`, {
        mediaId: media._id?.toString(),
        hasMainUrl: !!media.url,
        hasVariants: !!media.image_variants,
        urlCount: urlArray.length
    });

    return urlArray;
}


// Cleanup orphaned ImageKit files - CORRECTED VERSION
export const cleanupOrphanedImageKitFiles = async (eventId: string): Promise<void> => {
    try {
        // List all files in the event folder
        const listResponse = await imagekit.listFiles({
            path: `/events/${eventId}`,
            limit: 1000
        });

        // Filter to only get files (not folders)
        const files = listResponse.filter((item): item is FileObject =>
            'fileId' in item && item.type === 'file'
        );

        // Get all media URLs from database
        const mediaItems = await Media.find({ event_id: eventId })
            .select('url image_variants')
            .lean();

        const validUrls = new Set<string>();

        // Collect all valid URLs from media items
        mediaItems.forEach(media => {
            if (media.url) validUrls.add(media.url);

            // Add all variant URLs
            if (media.image_variants) {
                const variants = media.image_variants;

                // Helper to safely add URL
                const addUrl = (obj: any) => {
                    if (obj?.url) validUrls.add(obj.url);
                };

                // Original
                addUrl(variants.original);

                // Small variants
                addUrl(variants.small?.webp);
                addUrl(variants.small?.jpeg);

                // Medium variants
                addUrl(variants.medium?.webp);
                addUrl(variants.medium?.jpeg);

                // Large variants
                addUrl(variants.large?.webp);
                addUrl(variants.large?.jpeg);
            }
        });

        // Find orphaned files
        const orphanedFiles = files.filter(file => !validUrls.has(file.url));

        logger.info(`Found ${orphanedFiles.length} orphaned files for event ${eventId}`);

        // Delete orphaned files
        for (const file of orphanedFiles) {
            try {
                await imagekit.deleteFile(file.fileId);
                logger.debug(`Deleted orphaned file: ${file.name}`);
            } catch (deleteError) {
                logger.error(`Failed to delete orphaned file ${file.name}:`, deleteError);
            }
        }
    } catch (error) {
        logger.error('Cleanup orphaned files error:', error);
    }
};

// 3. services/media/media-management.service.ts
// ====================================

import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { keys } from '@configs/dotenv.config';

const s3Client = new S3Client({
    region: keys.awsRegion as string,
    credentials: {
        accessKeyId: keys.awsAccessKeyId as string,
        secretAccessKey: keys.awsSecretAccessKey as string
    }
});
import { Event } from '@models/event.model';
import { EventParticipant } from '@models/event-participants.model';
import { mediaNotificationService } from '@services/websocket/notifications';
import type { ServiceResponse, StatusUpdateOptions } from './media.types';
import { getPhotoWallWebSocketService } from '@services/photoWallWebSocketService';
import { getWebSocketService } from '@services/websocket/websocket.service';

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
            'approval event_id original variants type owner size_mb'
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
        const uploadedBy = media.owner?.user_id;
        const sizeMB = media.original?.size_mb || 0;

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
            // 1. Broadcast updated stats counts to admin
            mediaNotificationService.broadcastMediaStats(eventId);

            // 2. Emit guest-facing slim event (new_photos_available or photo_removed)
            //    This is the primary path — done directly in the service for reliability.
            const webSocketService = getWebSocketService();
            if (webSocketService) {
                type MediaStatus = 'pending' | 'approved' | 'rejected' | 'hidden' | 'deleted' | 'auto_approved';
                webSocketService.emitStatusUpdate({
                    mediaId,
                    eventId,
                    previousStatus: (previousStatus || 'pending') as MediaStatus,
                    newStatus: status as MediaStatus,
                    updatedBy: {
                        name: options.adminId || 'admin',
                        type: 'admin'
                    },
                    timestamp: new Date()
                });
            }

            // 3. Notify PhotoWall if media was approved and we have share token
            if ((status === 'approved' || status === 'auto_approved') &&
                previousStatus !== 'approved' &&
                previousStatus !== 'auto_approved') {

                try {
                    const event = await Event.findById(eventId).select('share_token').lean();
                    const shareToken = event?.share_token;
                    if (shareToken) {
                        const photoWallService = getPhotoWallWebSocketService();
                        if (photoWallService) {
                            await photoWallService.notifyNewMediaUpload(shareToken, updatedMedia);
                        }
                    }
                } catch (eventError) {
                    logger.warn('Could not fetch share token for PhotoWall notification', { eventId });
                }
            }

            logger.info('✅ WebSocket status update broadcasted', {
                mediaId: mediaId.substring(0, 8) + '...',
                previousStatus,
                newStatus: status,
                eventId: eventId.substring(0, 8) + '...',
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
            data: {
                mediaId: mediaId,
                eventId: eventId,
                newStatus: status,
                previousStatus: previousStatus
            },
            error: null,
            other: {
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
        }).select('approval.status owner size_mb type').lean();

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
                requestedCount: validMediaIds.length,
                updatedMediaIds: validMediaIds, // Return the list of successfully updated media IDs
                eventId: eventId,
                newStatus: status
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
            .select('event_id original variants type approval.status owner size_mb')
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
        const uploadedBy = media.owner?.user_id;
        const sizeMB = media.original?.size_mb || 0;

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
                // storageCleanupQueued: validUrls.length > 0,
                // validUrlsQueued: validUrls.length,
                // invalidUrlsSkipped: invalidUrls.length
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

export const softDeleteMediaService = async (
    mediaId: string,
    userId: string,
    options?: {
        adminName?: string;
        reason?: string;
    }
): Promise<ServiceResponse<any>> => {
    try {
        const media = await Media.findById(mediaId)
            .select('event_id original variants approval.status owner size_mb deleteGroup')
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
        const uploadedBy = media.owner?.user_id;
        const sizeMB = media.original?.size_mb || 0;

        // STEP 1: Soft-delete in DB IMMEDIATELY
        const updateResult = await Media.updateOne(
            { _id: mediaId },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    approval: {
                        ...media.approval,
                        status: 'deleted' // or 'rejected' if needed
                    }
                }
            }
        );

        if (updateResult.modifiedCount === 0) {
            return {
                status: false,
                code: 404,
                message: 'Media not found or already deleted',
                data: null,
                error: { message: 'No changes made' }
            };
        }

        // STEP 2: Update counters
        try {
            await updateCountersForDeletion(eventId, uploadedBy, media.approval?.status || 'pending', sizeMB);
        } catch (counterError) {
            logger.warn('Failed to update counters after soft-deletion:', counterError);
        }

        // STEP 3: Broadcast soft-deletion if visible
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
                            options?.reason || 'Soft-removed by admin'
                        );
                    }
                }
            } catch (wsError) {
                logger.error('Failed to broadcast soft-deletion via WebSocket:', wsError);
            }
        }

        return {
            status: true,
            code: 200,
            message: 'Media soft-deleted successfully',
            data: {
                id: mediaId,
                wasVisibleToGuests: wasVisible
            },
            error: null,
            other: {
                websocketBroadcasted: wasVisible,
                photoWallNotified: !!(wasVisible && shareToken),
                cleanupScheduled: true // Now async after 30 days
            }
        };

    } catch (error: any) {
        logger.error('Error in softDeleteMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to soft-delete media',
            data: null,
            error: { message: error.message }
        };
    }
};

// export const recoverMediaService = async (
//     mediaId: string,
//     userId: string
// ): Promise<ServiceResponse<any>> => {
//     try {
//         const media = await Media.findById(mediaId)
//             .select('event_id approval.status')
//             .lean();

//         if (!media) {
//             return {
//                 status: false,
//                 code: 404,
//                 message: 'Media not found',
//                 data: null,
//                 error: { message: 'Media item does not exist' }
//             };
//         }

//         // STEP 1: Recover in DB
//         const updateResult = await Media.updateOne(
//             { _id: mediaId },
//             {
//                 $set: {
//                     isDeleted: false,
//                     approval: {
//                         ...media.approval,
//                         status: 'approved' // or original status
//                     }
//                 },
//                 $unset: { deletedAt: "" }
//             }
//         );

//         if (updateResult.modifiedCount === 0) {
//             return {
//                 status: false,
//                 code: 404,
//                 message: 'Media not deleted or already recovered',
//                 data: null,
//                 error: { message: 'No changes made' }
//             };
//         }

//         // STEP 2: Broadcast recovery
//         try {
//             mediaNotificationService.broadcastMediaRecovered({
//                 mediaId,
//                 eventId: media.event_id.toString(),
//                 userId
//             });
//         } catch (wsError) {
//             logger.error('Failed to broadcast recovery:', wsError);
//         }

//         return {
//             status: true,
//             code: 200,
//             message: 'Media recovered successfully',
//             data: { id: mediaId },
//             error: null,
//             other: null
//         };
//     } catch (error: any) {
//         logger.error('Error in recoverMediaService:', error);
//         return {
//             status: false,
//             code: 500,
//             message: 'Failed to recover media',
//             data: null,
//             error: { message: error.message }
//         };
//     }
// };

export const cleanupDeletedMedia = async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Find media items that are soft-deleted and older than 30 days
    const toDelete = await Media.find({
        isDeleted: true,
        deletedAt: { $lt: thirtyDaysAgo }
    }).select('original variants owner').lean();

    if (toDelete.length === 0) return;

    logger.info(`Found ${toDelete.length} expired media items to cleanup.`);

    // Collect all S3 keys to delete
    const keysToDelete: string[] = [];

    toDelete.forEach((media: any) => {
        // 1. Original
        if (media.original?.public_id) {
            keysToDelete.push(media.original.public_id);
        } else if (media.public_id) {
            // Legacy support
            keysToDelete.push(media.public_id);
        }

        // 2. Variants (Images)
        if (media.variants?.images) {
            const v = media.variants.images;
            if (v.small?.public_id) keysToDelete.push(v.small.public_id);
            if (v.medium?.public_id) keysToDelete.push(v.medium.public_id);
            if (v.large?.public_id) keysToDelete.push(v.large.public_id);
        }

        // 3. Variants (Videos)
        if (media.variants?.videos) {
            const v = media.variants.videos;
            if (v.p360?.public_id) keysToDelete.push(v.p360.public_id);
            if (v.p720?.public_id) keysToDelete.push(v.p720.public_id);
            if (v.p1080?.public_id) keysToDelete.push(v.p1080.public_id);
        }

        // 4. Thumbnails
        if (media.variants?.thumbnails) {
            const t = media.variants.thumbnails;
            if (t.poster?.public_id) keysToDelete.push(t.poster.public_id);
            if (t.preview?.public_id) keysToDelete.push(t.preview.public_id);
        }

        // 5. Legacy image_variants support
        if (media.image_variants) {
            const v = media.image_variants;
            if (v.small?.public_id) keysToDelete.push(v.small.public_id);
            if (v.medium?.public_id) keysToDelete.push(v.medium.public_id);
            if (v.large?.public_id) keysToDelete.push(v.large.public_id);
        }
    });

    if (keysToDelete.length > 0) {
        // S3 DeleteObjects allows max 1000 keys per request
        const chunkSize = 1000;
        for (let i = 0; i < keysToDelete.length; i += chunkSize) {
            const batch = keysToDelete.slice(i, i + chunkSize);
            try {
                const command = new DeleteObjectsCommand({
                    Bucket: keys.s3BucketName as string,
                    Delete: {
                        Objects: batch.map(key => ({ Key: key })),
                        Quiet: true
                    }
                });
                await s3Client.send(command);
                logger.info(`Deleted batch of ${batch.length} files from S3.`);
            } catch (err) {
                logger.error('Failed to delete batch from S3 during cleanup:', err);
                // Continue to next batch even if one fails
            }
        }
    }

    // Hard-delete from DB
    const deleteResult = await Media.deleteMany({
        _id: { $in: toDelete.map(m => m._id) }
    });

    logger.info(`Cleanup complete. Permanently deleted ${deleteResult.deletedCount} media records.`);
};
/**
 * Bulk delete multiple media items
 */
export const bulkSoftDeleteMediaService = async (
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

        // Get media items for processing
        const mediaItems = await Media.find({
            _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
            event_id: new mongoose.Types.ObjectId(eventId)
        }).select('original variants approval.status owner size_mb deleteGroup')
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

        // Collect visible media IDs for notifications
        mediaItems.forEach(media => {
            if (['approved', 'auto_approved'].includes(media.approval?.status || '')) {
                visibleMediaIds.push(media._id.toString());
            }
        });

        // STEP 1: Soft-delete in DB IMMEDIATELY
        const updateResult = await Media.updateMany(
            {
                _id: { $in: validMediaIds.map(id => new mongoose.Types.ObjectId(id)) },
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    approval: {
                        ...mediaItems[0].approval, // Use first item's approval as template
                        status: 'deleted'
                    }
                }
            }
        );

        if (updateResult.modifiedCount === 0) {
            return {
                status: false,
                code: 404,
                message: 'No media items were modified',
                data: null,
                error: { message: 'No changes made - items may already be deleted' }
            };
        }

        // STEP 2: Update counters
        try {
            await updateBulkCountersForDeletion(eventId, mediaItems);
        } catch (counterError) {
            logger.warn('Failed to update bulk counters for soft-deletion:', counterError);
        }

        // STEP 3: Broadcast soft-deletions if visible
        if (visibleMediaIds.length > 0) {
            try {
                for (const mediaId of visibleMediaIds) {
                    mediaNotificationService.broadcastMediaRemoved({
                        mediaId,
                        eventId,
                        reason: options?.reason || 'bulk_soft_deleted_by_admin',
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
                                options?.reason || 'Bulk soft-removed by admin'
                            );
                        }
                    }
                }
            } catch (wsError) {
                logger.error('Failed to broadcast bulk soft-deletion via WebSocket:', wsError);
            }
        }

        return {
            status: true,
            code: 200,
            message: `Successfully soft-deleted ${updateResult.modifiedCount} media items`,
            data: {
                modifiedCount: updateResult.modifiedCount,
                requestedCount: validMediaIds.length,
                visibleMediaDeleted: visibleMediaIds.length
            },
            error: null,
            other: {
                websocketBroadcasted: visibleMediaIds.length > 0,
                photoWallNotified: !!(shareToken && visibleMediaIds.length > 0),
                cleanupScheduled: true // Now async after 30 days
            }
        };

    } catch (error: any) {
        logger.error('Error in bulkSoftDeleteMediaService:', error);
        return {
            status: false,
            code: 500,
            message: 'Failed to bulk soft-delete media',
            data: null,
            error: { message: error.message }
        };
    }
};


// Helper function to update counters for individual status changes
async function updateCountersForStatusChange(
    eventId: string,
    uploadedBy: mongoose.Types.ObjectId | undefined,
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
            if (media.owner?.user_id) {
                const userId = media.owner.user_id.toString();
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
    uploadedBy: mongoose.Types.ObjectId | undefined,
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
        if (media.owner?.user_id) {
            const userId = media.owner.user_id.toString();
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


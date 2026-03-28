// services/websocket/notifications/media-notifications.service.ts
//
// Slim notification service — guests receive only 3 meaningful events:
//   new_photos_available  (count of new approved photos)
//   photo_removed         (a previously visible photo was removed)
//   moderation_count_updated  (admin room only — pending count badge)
//
// Detailed processing progress is handled by SSE (see upload-progress route).
// Admin bulk operations emit bulk_operation_started / bulk_operation_complete only.

import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import mongoose from 'mongoose';

import type {
    MediaNotificationPayload,
    MediaBroadcastPayload,
    MediaRemovedPayload
} from './notification.types';
import { WEBSOCKET_EVENTS } from 'types/websocket.types';
import { getWebSocketService } from '../websocket.service';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function getRoomSize(roomName: string): number {
    try {
        const wsService = getWebSocketService();
        const room = wsService.io.sockets.adapter.rooms.get(roomName);
        return room ? room.size : 0;
    } catch {
        return 0;
    }
}

/**
 * Emit the current pending moderation count to the admin room.
 * Lightweight — sends cached aggregate, not a full stats object.
 */
async function emitModerationCount(eventId: string): Promise<void> {
    try {
        const wsService = getWebSocketService();
        const adminRoom = `admin_${eventId}`;

        const [result] = await Media.aggregate([
            { $match: { event_id: new mongoose.Types.ObjectId(eventId) } },
            {
                $group: {
                    _id: null,
                    pending: { $sum: { $cond: [{ $eq: ['$approval.status', 'pending'] }, 1, 0] } },
                    approved: {
                        $sum: {
                            $cond: [{ $in: ['$approval.status', ['approved', 'auto_approved']] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        const pending = result?.pending ?? 0;
        const approved = result?.approved ?? 0;

        wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.MODERATION_COUNT_UPDATED, {
            eventId,
            pending,
            approved,
            timestamp: new Date()
        });

        logger.debug(`Moderation count emitted to admin room: pending=${pending}, approved=${approved}`);
    } catch (error) {
        logger.warn('Failed to emit moderation count update:', error);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MediaNotificationService
// ─────────────────────────────────────────────────────────────────────────────

export class MediaNotificationService {

    /**
     * Called when one or more photos become visible to guests (approved / auto_approved).
     * Emits a single `new_photos_available` event with just the count.
     * Guest UI shows a banner: "3 new photos — tap to load".
     *
     * Also emits `admin_new_upload_notification` to the admin room for the
     * pending badge and upload notification toasts.
     */
    public notifyNewPhotosAvailable(params: {
        eventId: string;
        count: number;
        uploadedBy: { id: string; name: string; type: string };
        requiresApproval: boolean;
    }): void {
        try {
            const { eventId, count, uploadedBy, requiresApproval } = params;
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;
            const wsService = getWebSocketService();

            // Guest-facing: minimal payload, no media data
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.NEW_PHOTOS_AVAILABLE, {
                eventId,
                count,
                timestamp: new Date()
            });

            // Admin-facing: richer notification for the upload badge
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, {
                eventId,
                uploadedBy,
                count,
                requiresApproval,
                timestamp: new Date()
            });

            logger.info(`new_photos_available emitted: count=${count}, guests=${getRoomSize(guestRoom)}, admins=${getRoomSize(adminRoom)}`);
        } catch (error) {
            logger.error('Failed to emit new_photos_available:', error);
        }
    }

    /**
     * Notifies ONLY admins about a guest upload (when it requires approval,
     * so it is NOT yet visible to other guests).
     */
    public notifyAdminsAboutGuestUpload(params: MediaNotificationPayload): void {
        try {
            const { eventId, uploadedBy, mediaData, requiresApproval } = params;
            const adminRoom = `admin_${eventId}`;
            const wsService = getWebSocketService();

            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, {
                eventId,
                uploadedBy,
                media: {
                    id: mediaData.mediaId,
                    url: mediaData.url,
                    filename: mediaData.filename,
                    type: mediaData.type,
                    size: mediaData.size,
                    approvalStatus: mediaData.approvalStatus
                },
                requiresApproval,
                count: 1,
                timestamp: new Date()
            });

            // Update admin pending badge
            emitModerationCount(eventId).catch(() => {});

            logger.info(`Admin notified about guest upload: ${mediaData.filename}, admins=${getRoomSize(adminRoom)}`);
        } catch (error) {
            logger.error('Failed to notify admins about guest upload:', error);
        }
    }

    /**
     * Broadcast a new media item that is immediately visible to all guests
     * (auto-approved or approval not required).
     * Emits `new_photos_available` with count=1 to guest room.
     */
    public broadcastNewMediaToGuests(params: MediaBroadcastPayload): void {
        try {
            const { eventId, uploadedBy } = params;
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;
            const wsService = getWebSocketService();

            // Slim guest event — guests just need to know count, not media data
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.NEW_PHOTOS_AVAILABLE, {
                eventId,
                count: 1,
                timestamp: new Date()
            });

            // Admin notification
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, {
                eventId,
                uploadedBy,
                count: 1,
                requiresApproval: false,
                timestamp: new Date()
            });

            logger.info(`new_photos_available (broadcast) emitted: guests=${getRoomSize(guestRoom)}`);
        } catch (error) {
            logger.error('Failed to broadcast new media to guests:', error);
        }
    }

    /**
     * Notify guests that a previously visible photo has been removed
     * (rejected, hidden, or deleted by admin).
     * Emits `photo_removed` — guest UI silently removes it from local state.
     */
    public broadcastMediaRemoved(params: MediaRemovedPayload): void {
        try {
            const { mediaId, eventId } = params;
            const guestRoom = `guest_${eventId}`;
            const wsService = getWebSocketService();

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.PHOTO_REMOVED, {
                mediaId,
                eventId,
                timestamp: new Date()
            });

            // Update admin moderation count badge
            emitModerationCount(eventId).catch(() => {});

            logger.info(`photo_removed emitted: mediaId=${mediaId.substring(0, 8)}..., guests=${getRoomSize(guestRoom)}`);
        } catch (error) {
            logger.error('Failed to broadcast photo removed:', error);
        }
    }

    /**
     * Broadcast bulk media removal to guests.
     * Emits one `photo_removed` per removed media ID.
     * For large batches (>10), batches them with small delays to avoid
     * flooding client event queues.
     */
    public async broadcastBulkMediaRemoved(params: {
        mediaIds: string[];
        eventId: string;
    }): Promise<void> {
        try {
            const { mediaIds, eventId } = params;
            const guestRoom = `guest_${eventId}`;
            const wsService = getWebSocketService();
            const timestamp = new Date();

            for (const mediaId of mediaIds) {
                wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.PHOTO_REMOVED, {
                    mediaId,
                    eventId,
                    timestamp
                });
            }

            // Update admin moderation count badge once
            emitModerationCount(eventId).catch(() => {});

            logger.info(`photo_removed bulk emitted: count=${mediaIds.length}, guests=${getRoomSize(guestRoom)}`);
        } catch (error) {
            logger.error('Failed to broadcast bulk media removed:', error);
        }
    }

    /**
     * Emit that multiple new photos are now available after a bulk approval.
     * Emits a single `new_photos_available` event with the total count.
     */
    public broadcastBulkPhotosApproved(params: {
        eventId: string;
        count: number;
        approvedBy: { id: string; name: string; type: string };
    }): void {
        try {
            const { eventId, count } = params;
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;
            const wsService = getWebSocketService();

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.NEW_PHOTOS_AVAILABLE, {
                eventId,
                count,
                timestamp: new Date()
            });

            // Update admin pending badge
            emitModerationCount(eventId).catch(() => {});

            logger.info(`new_photos_available (bulk) emitted: count=${count}, guests=${getRoomSize(guestRoom)}`);
        } catch (error) {
            logger.error('Failed to broadcast bulk photos approved:', error);
        }
    }

    /**
     * Emit moderation count update to admin room only.
     * Call this after any operation that changes the pending count.
     */
    public broadcastModerationCountUpdate(eventId: string): void {
        emitModerationCount(eventId).catch((error) => {
            logger.warn('Failed to broadcast moderation count:', error);
        });
    }

    /**
     * @deprecated Use broadcastNewMediaToGuests or notifyNewPhotosAvailable instead.
     * Kept for backward compatibility with PhotoWall and older callers.
     * Will be removed in a future version.
     */
    public broadcastMediaStats(eventId: string): void {
        this.broadcastModerationCountUpdate(eventId);
    }

    /**
     * @deprecated Processing progress is now handled via SSE.
     * No-op kept for backward compatibility to prevent build breaks.
     */
    public broadcastProcessingComplete(_params: any): void {
        // No-op in slim architecture
        return;
    }

    /**
     * @deprecated Processing progress is now handled via SSE.
     */
    public broadcastProcessingFailed(_params: any): void {
        // No-op in slim architecture
        return;
    }
}

// Export singleton instance
export const mediaNotificationService = new MediaNotificationService();
export default mediaNotificationService;
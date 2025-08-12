// ====================================
// services/websocket/notifications/index.ts - UNIFIED EXPORT
// ====================================

import adminNotificationService from './admin-notifications.service';
import mediaNotificationService from './media-notifications.service';

// Re-export all notification services for easy importing
export { mediaNotificationService } from './media-notifications.service';
export { adminNotificationService } from './admin-notifications.service';

// Export types
export type {
    MediaNotificationPayload,
    BulkMediaNotificationPayload,
    MediaBroadcastPayload,
    ProcessingCompletePayload,
    ProcessingFailedPayload,
    MediaRemovedPayload
} from './notification.types';

// Convenience exports for common use cases
export const broadcastNewMediaToGuests = mediaNotificationService.broadcastNewMediaToGuests.bind(mediaNotificationService);
export const notifyAdminsAboutGuestUpload = mediaNotificationService.notifyAdminsAboutGuestUpload.bind(mediaNotificationService);
export const broadcastProcessingComplete = mediaNotificationService.broadcastProcessingComplete.bind(mediaNotificationService);
export const broadcastMediaRemoved = mediaNotificationService.broadcastMediaRemoved.bind(mediaNotificationService);
export const broadcastStatusUpdate = adminNotificationService.broadcastStatusUpdate.bind(adminNotificationService);
export const broadcastRoomCounts = adminNotificationService.broadcastRoomCounts.bind(adminNotificationService);
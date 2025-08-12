// 7. services/websocket/notifications/admin-notifications.service.ts
// ====================================

import { logger } from '@utils/logger';
import { getWebSocketService } from '../websocket.service';
import { StatusUpdatePayload } from '../websocket.types';

class AdminNotificationService {
    /**
     * 🔔 Broadcast status updates to admins and guests
     */
    public broadcastStatusUpdate(payload: StatusUpdatePayload): void {
        try {
            const adminRoom = `admin_${payload.eventId}`;
            const guestRoom = `guest_${payload.eventId}`;

            logger.info(`📤 Broadcasting status update: ${payload.mediaId.substring(0, 8)}... (${payload.previousStatus} → ${payload.newStatus})`);

            const wsService = getWebSocketService();

            // Send full payload to admin room
            wsService.io.to(adminRoom).emit('media_status_updated', payload);

            // Send appropriate notifications to guest room
            if (payload.newStatus === 'approved' || payload.newStatus === 'auto_approved') {
                wsService.io.to(guestRoom).emit('media_approved', {
                    mediaId: payload.mediaId,
                    eventId: payload.eventId,
                    mediaData: payload.mediaData,
                    timestamp: payload.timestamp
                });
            } else if (['approved', 'auto_approved'].includes(payload.previousStatus) &&
                !['approved', 'auto_approved'].includes(payload.newStatus)) {
                wsService.io.to(guestRoom).emit('media_removed', {
                    mediaId: payload.mediaId,
                    eventId: payload.eventId,
                    reason: `Status changed to ${payload.newStatus}`,
                    timestamp: payload.timestamp
                });
            }

            // Also send status update to guests
            wsService.io.to(guestRoom).emit('media_status_updated', payload);

        } catch (error) {
            logger.error('❌ Failed to broadcast status update:', error);
        }
    }

    /**
     * 📊 Broadcast room user counts to both admin and guest rooms
     */
    public broadcastRoomCounts(eventId: string): void {
        try {
            const wsService = getWebSocketService();
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;
            const roomCounts = this.getRoomUserCounts();

            const adminCount = roomCounts[adminRoom] || 0;
            const guestCount = roomCounts[guestRoom] || 0;
            const total = adminCount + guestCount;

            // Send to admin room (they see both counts)
            wsService.io.to(adminRoom).emit('room_user_counts', {
                eventId,
                adminCount,
                guestCount,
                total
            });

            // Send to guest room (they see guest count)
            wsService.io.to(guestRoom).emit('room_user_counts', {
                eventId,
                guestCount,
                total: guestCount
            });

            logger.info(`📊 Room counts for ${eventId}: Admin(${adminCount}) Guest(${guestCount}) Total(${total})`);

        } catch (error) {
            logger.error('❌ Failed to broadcast room counts:', error);
        }
    }

    /**
     * 🚨 Broadcast system notifications to admins
     */
    public notifyAdminsSystemEvent(eventId: string, notification: {
        type: 'warning' | 'error' | 'info';
        title: string;
        message: string;
        data?: any;
    }): void {
        try {
            const adminRoom = `admin_${eventId}`;
            const wsService = getWebSocketService();

            const payload = {
                eventId,
                notification: {
                    ...notification,
                    timestamp: new Date(),
                    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`
                }
            };

            wsService.io.to(adminRoom).emit('admin_system_notification', payload);
            logger.info(`🚨 System notification sent to admins: ${notification.title}`);

        } catch (error) {
            logger.error('❌ Failed to send system notification:', error);
        }
    }

    private getRoomUserCounts(): Record<string, number> {
        try {
            const wsService = getWebSocketService();
            return wsService.getRoomUserCounts();
        } catch (error) {
            logger.error('Failed to get room counts:', error);
            return {};
        }
    }
}

// Export singleton instance
export const adminNotificationService = new AdminNotificationService();
export default adminNotificationService;
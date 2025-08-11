// services/mediaWebSocket.service.ts - UPDATED: Use correct event names from your types

import { logger } from '@utils/logger';
import { getWebSocketService } from '@services/websocket.service';
// Use your existing WEBSOCKET_EVENTS
import { WEBSOCKET_EVENTS } from '../types/websocket.types';
import { Media } from '@models/media.model';

class MediaWebSocketService {
    /**
 * 🚀 SIMPLE: Notify ONLY admins about guest uploads
 */
    public notifyAdminsAboutGuestUpload(params: {
        eventId: string;
        uploadedBy: {
            id: string;
            name: string;
            type: string;
            email?: string;
        };
        mediaData: {
            mediaId: string;
            url: string;
            filename: string;
            type: string;
            size: number;
            approvalStatus: string;
        };
        requiresApproval: boolean;
    }): void {
        try {
            const { eventId, uploadedBy, mediaData, requiresApproval } = params;
            const adminRoom = `admin_${eventId}`;

            logger.info(`📤 Notifying admins about guest upload: ${mediaData.filename}`, {
                adminRoom,
                uploader: uploadedBy.name,
                requiresApproval,
                mediaId: mediaData.mediaId.substring(0, 8) + '...'
            });

            const wsService = getWebSocketService();

            const payload = {
                eventId,
                uploadedBy,
                media: {
                    id: mediaData.mediaId,
                    url: mediaData.url,
                    filename: mediaData.filename,
                    type: mediaData.type as 'image' | 'video',
                    size: mediaData.size,
                    approvalStatus: mediaData.approvalStatus
                },
                requiresApproval,
                uploadedAt: new Date(),
                timestamp: new Date()
            };

            // 🚀 Send to admin room only using existing event type
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, payload);

            logger.info(`✅ Admin notification sent to ${this.getRoomSize(adminRoom)} admin(s)`);

        } catch (error) {
            logger.error('❌ Failed to notify admins about guest upload:', error);
        }
    }

    /**
     * 🚀 SIMPLE: Notify admins about bulk guest uploads
     */
    public notifyAdminsAboutBulkGuestUpload(params: {
        eventId: string;
        uploadedBy: {
            id: string;
            name: string;
            type: string;
            email?: string;
        };
        mediaItems: Array<{
            mediaId: string;
            url: string;
            filename: string;
            type: string;
            size: number;
            approvalStatus: string;
        }>;
        totalCount: number;
        requiresApproval: boolean;
    }): void {
        try {
            const { eventId, uploadedBy, mediaItems, totalCount, requiresApproval } = params;
            const adminRoom = `admin_${eventId}`;

            logger.info(`📤 Notifying admins about bulk guest upload: ${totalCount} items`, {
                adminRoom,
                uploader: uploadedBy.name,
                requiresApproval
            });

            const wsService = getWebSocketService();

            const payload = {
                eventId,
                uploadedBy,
                mediaItems: mediaItems.map(item => ({
                    id: item.mediaId,
                    url: item.url,
                    filename: item.filename,
                    type: item.type as 'image' | 'video',
                    size: item.size,
                    approvalStatus: item.approvalStatus
                })),
                bulkUpload: {
                    totalCount,
                    successCount: mediaItems.length,
                    requiresApproval
                },
                uploadedAt: new Date(),
                timestamp: new Date()
            };

            // 🚀 Send to admin room only
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, payload);

            logger.info(`✅ Bulk admin notification sent to ${this.getRoomSize(adminRoom)} admin(s)`);

        } catch (error) {
            logger.error('❌ Failed to notify admins about bulk guest upload:', error);
        }
    }


    /**
     * 🚀 Broadcast new media upload to guests immediately
     */
    public broadcastNewMediaToGuests(params: {
        mediaId: string;
        eventId: string;
        uploadedBy: { id: string; name: string; type: any };
        mediaData: {
            url: string;
            filename: string;
            type: string;
            size: number;
            format?: string;
        };
    }): void {
        try {
            const { mediaId, eventId, uploadedBy, mediaData } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`📤 Broadcasting new media to guests: ${mediaId.substring(0, 8)}...`, {
                filename: mediaData.filename,
                uploadedBy: uploadedBy.name,
                room: guestRoom
            });

            const wsService = getWebSocketService();

            const payload = {
                mediaId,
                eventId,
                uploadedBy: {
                    id: uploadedBy.id,
                    name: uploadedBy.name,
                    type: uploadedBy.type,
                },
                media: {
                    url: mediaData.url,
                    thumbnailUrl: mediaData.url, // Initially same as preview
                    filename: mediaData.filename,
                    originalFilename: mediaData.filename,
                    type: mediaData.type as 'image' | 'video',
                    size: mediaData.size,
                    format: mediaData.format
                },
                status: 'auto_approved', // Auto-approved for admin uploads
                uploadedAt: new Date(),
                processingStatus: 'processing',
                timestamp: new Date()
            };

            // 🚀 FIXED: Use correct event name from your types
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.NEW_MEDIA_UPLOADED, payload);

            // Optional: Send notification to admin room
            const adminRoom = `admin_${eventId}`;
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, {
                mediaId,
                guestRoomSize: this.getRoomSize(guestRoom),
                uploadedBy: uploadedBy.name,
                timestamp: new Date()
            });

            logger.info(`✅ New media broadcasted to ${this.getRoomSize(guestRoom)} guests`);

        } catch (error) {
            logger.error('❌ Failed to broadcast new media:', error);
            // Don't throw error - WebSocket failure shouldn't break upload
        }
    }

    /**
     * 🔄 Broadcast processing completion to guests
     */
    public broadcastProcessingComplete(params: {
        mediaId: string;
        eventId: string;
        newUrl: string;
        variants?: {
            thumbnail?: string;
            display?: string;
            full?: string;
        };
        processingTimeMs?: number;
    }): void {
        try {
            const { mediaId, eventId, newUrl, variants, processingTimeMs } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`📤 Broadcasting processing completion: ${mediaId.substring(0, 8)}...`, {
                newUrl,
                processingTime: processingTimeMs ? `${processingTimeMs}ms` : 'unknown'
            });

            const wsService = getWebSocketService();

            const payload = {
                mediaId,
                eventId,
                processingStatus: 'completed' as const,
                progress: 100,
                stage: 'completed' as const,
                variantsGenerated: true,
                variants: variants || {
                    thumbnail: newUrl,
                    display: newUrl,
                    full: newUrl
                },
                timestamp: new Date()
            };

            // 🚀 FIXED: Use correct event name from your types
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_COMPLETE, payload);

            logger.info(`✅ Processing completion broadcasted to guests`);

        } catch (error) {
            logger.error('❌ Failed to broadcast processing completion:', error);
        }
    }

    /**
     * ❌ Broadcast processing failure to guests
     */
    public broadcastProcessingFailed(params: {
        mediaId: string;
        eventId: string;
        errorMessage: string;
    }): void {
        try {
            const { mediaId, eventId, errorMessage } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`📤 Broadcasting processing failure: ${mediaId.substring(0, 8)}...`);

            const wsService = getWebSocketService();

            const payload = {
                mediaId,
                eventId,
                processingStatus: 'failed' as const,
                progress: 0,
                stage: 'completed' as const,
                variantsGenerated: false,
                error: {
                    code: 'PROCESSING_FAILED',
                    message: 'Image processing failed',
                    details: errorMessage
                },
                timestamp: new Date()
            };

            // 🚀 FIXED: Use correct event name from your types
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.MEDIA_UPLOAD_FAILED, payload);

            logger.info(`✅ Processing failure broadcasted`);

        } catch (error) {
            logger.error('❌ Failed to broadcast processing failure:', error);
        }
    }

    /**
     * 📊 Broadcast updated media statistics to guests
     */
    public broadcastMediaStats(eventId: string): void {
        try {
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;

            // Quick stats broadcast (don't await to keep it fast)
            this.getQuickStats(eventId).then(stats => {
                const wsService = getWebSocketService();

                const payload = {
                    eventId,
                    stats,
                    breakdown: {
                        mediaByType: {
                            image: stats.approved,
                            video: 0
                        },
                        mediaByStatus: {
                            approved: stats.approved,
                            pending: stats.pendingApproval
                        }
                    },
                    updatedAt: new Date(),
                    timestamp: new Date()
                };

                // 🚀 FIXED: Use correct event name from your types
                wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.EVENT_STATS_UPDATE, payload);
                wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.EVENT_STATS_UPDATE, payload);

            }).catch(error => {
                logger.warn('Failed to get stats for broadcast:', error);
            });

        } catch (error) {
            logger.error('❌ Failed to broadcast media stats:', error);
        }
    }

    public broadcastMediaRemoved(params: {
        mediaId: string;
        eventId: string;
        reason: string;
        adminName?: string;
    }): void {
        try {
            const { mediaId, eventId, reason, adminName } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`📤 Broadcasting media removal: ${mediaId.substring(0, 8)}... - ${reason}`, {
                room: guestRoom,
                adminName
            });

            const wsService = getWebSocketService();

            const payload = {
                mediaId,
                eventId,
                reason: this.getGuestFriendlyReason(reason),
                removedBy: adminName || 'Admin',
                timestamp: new Date(),
                guest_context: {
                    should_remove_from_display: true,
                    reason_display: this.getGuestFriendlyReason(reason)
                }
            };

            // 🚀 Use the correct event name from your existing types
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.GUEST_MEDIA_REMOVED, payload);

            // Also send to admin room for confirmation
            const adminRoom = `admin_${eventId}`;
            wsService.io.to(adminRoom).emit('media_deletion_broadcasted', {
                mediaId,
                guestRoomSize: this.getRoomSize(guestRoom),
                reason,
                timestamp: new Date()
            });

            logger.info(`✅ Media removal broadcasted to ${this.getRoomSize(guestRoom)} guests`);

        } catch (error) {
            logger.error('❌ Failed to broadcast media removal:', error);
        }
    }


    private getGuestFriendlyReason(reason: string): string {
        const reasonMap: Record<string, string> = {
            'rejected': 'Content was removed by moderator',
            'hidden': 'Content is temporarily hidden',
            'inappropriate': 'Content was flagged as inappropriate',
            'duplicate': 'Duplicate content was removed',
            'admin_action': 'Content was removed by admin',
            'deleted_by_admin': 'Photo was deleted by admin',
            'bulk_deleted_by_admin': 'Photo was removed during cleanup',
            'user_request': 'Photo was removed at user request',
            'policy_violation': 'Content violated community guidelines'
        };

        return reasonMap[reason] || 'Content was removed';
    }
    /**
     * 🛠️ Helper Methods
     */
    private getRoomSize(roomName: string): number {
        try {
            const wsService = getWebSocketService();
            const room = wsService.io.sockets.adapter.rooms.get(roomName);
            return room ? room.size : 0;
        } catch (error) {
            return 0;
        }
    }

    private async getQuickStats(eventId: string) {
        try {
            // Use your existing Media model
            const mongoose = await import('mongoose');

            const stats = await Media.aggregate([
                {
                    $match: {
                        event_id: new mongoose.Types.ObjectId(eventId)
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        approved: {
                            $sum: {
                                $cond: [
                                    { $in: ['$approval.status', ['approved', 'auto_approved']] },
                                    1,
                                    0
                                ]
                            }
                        },
                        pending: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$approval.status', 'pending'] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

            const result = stats[0] || { total: 0, approved: 0, pending: 0 };

            return {
                totalMedia: result.total,
                pendingApproval: result.pending,
                approved: result.approved,
                autoApproved: result.approved, // Simplified
                rejected: 0,
                hidden: 0,
                deleted: 0,
                totalUploaders: 1,
                activeGuests: this.getRoomSize(`guest_${eventId}`),
                activeAdmins: this.getRoomSize(`admin_${eventId}`),
                totalConnections: this.getRoomSize(`guest_${eventId}`) + this.getRoomSize(`admin_${eventId}`)
            };
        } catch (error) {
            logger.error('Failed to get quick stats:', error);
            return {
                totalMedia: 0,
                pendingApproval: 0,
                approved: 0,
                autoApproved: 0,
                rejected: 0,
                hidden: 0,
                deleted: 0,
                totalUploaders: 0,
                activeGuests: 0,
                activeAdmins: 0,
                totalConnections: 0
            };
        }
    }
}

// Export singleton instance
export const mediaWebSocketService = new MediaWebSocketService();
export default mediaWebSocketService;
// services/websocket/notifications.ts - ENHANCED WITH OPTIMISTIC SUPPORT

import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import mongoose from 'mongoose';

import type {
    MediaNotificationPayload,
    BulkMediaNotificationPayload,
    MediaBroadcastPayload,
    ProcessingCompletePayload,
    ProcessingFailedPayload,
    MediaRemovedPayload
} from './notification.types';
import { WEBSOCKET_EVENTS } from 'types/websocket.types';
import { getWebSocketService } from '../websocket.service';

// New interfaces for optimistic updates
interface OptimisticMediaUpdate {
    type: 'optimistic_upload' | 'processing_progress' | 'processing_complete' | 'processing_failed';
    eventId: string;
    mediaData: {
        id: string;
        filename: string;
        tempUrl?: string;
        finalUrl?: string;
        status: 'optimistic' | 'processing' | 'completed' | 'failed';
        uploadedBy: {
            id: string;
            name: string;
            type: 'admin' | 'guest';
        };
        metadata?: {
            size: number;
            format: string;
            uploadTime: Date;
        };
        // image_variants?: {
        //     small?: { jpeg?: { url: string } };
        //     medium?: { jpeg?: { url: string } };
        //     large?: { jpeg?: { url: string } };
        // };
        [key: string]: any;
        processingStage: string;
        progressPercentage: number;
        error?: string;
    };
    timestamp: Date;
    allUsersCanSee: boolean;
}

interface EventStatsUpdate {
    eventId: string;
    type: 'optimistic_increment' | 'actual_update';
    photoCount: number;
    totalSizeMB?: number;
    isOptimistic: boolean;
}

class MediaNotificationService {
    notifyAdminsAboutBulkGuestUpload(arg0: { eventId: string; uploadedBy: { id: string; name: any; type: string; email: any; uploadTime: Date; }; mediaItems: { mediaId: any; url: any; filename: any; type: any; size: any; approvalStatus: any; }[]; totalCount: number; requiresApproval: boolean; }) {
        throw new Error("Method not implemented.");
    }
    /**
     * 🚀 NEW: Broadcast optimistic media update to ALL users instantly
     */
    public broadcastOptimisticMediaUpdate(update: OptimisticMediaUpdate): void {
        try {
            const { eventId, mediaData, type } = update;
            
            // Get all relevant rooms
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;
            const eventRoom = `event_${eventId}`;
            
            logger.info(`Broadcasting optimistic ${type}: ${mediaData.filename}`, {
                mediaId: mediaData.id.substring(0, 8) + '...',
                stage: mediaData.processingStage,
                progress: mediaData.progressPercentage
            });

            const wsService = getWebSocketService();

            // Base payload for all users
            const basePayload = {
                mediaId: mediaData.id,
                eventId,
                filename: mediaData.filename,
                status: mediaData.status,
                processingStage: mediaData.processingStage,
                progressPercentage: mediaData.progressPercentage,
                uploadedBy: mediaData.uploadedBy,
                timestamp: new Date(),
                isOptimistic: type === 'optimistic_upload'
            };

            // Handle different update types
            switch (type) {
                case 'optimistic_upload':
                    // Send to ALL users immediately - this solves the guest visibility issue
                    const optimisticPayload = {
                        ...basePayload,
                        media: {
                            id: mediaData.id,
                            url: mediaData.tempUrl,
                            thumbnailUrl: mediaData.tempUrl,
                            filename: mediaData.filename,
                            type: 'image' as const,
                            size: mediaData.metadata?.size || 0,
                            format: mediaData.metadata?.format || 'jpg'
                        },
                        tempUrl: mediaData.tempUrl,
                        visibleToAll: true,
                        processingStatus: 'optimistic',
                        allUsersCanSee: true
                    };

                    // Broadcast to guests (they can see it immediately)
                    wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.NEW_MEDIA_UPLOADED, optimisticPayload);
                    
                    // Broadcast to admins
                    wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, {
                        ...optimisticPayload,
                        isOptimisticUpload: true,
                        requiresApproval: false
                    });

                    // Also send to general event room
                    wsService.io.to(eventRoom).emit('optimistic_media_added', optimisticPayload);

                    logger.info(`Optimistic upload visible to ${this.getRoomSize(guestRoom)} guests and ${this.getRoomSize(adminRoom)} admins`);
                    break;

                case 'processing_progress':
                    // Send progress updates to all users
                    const progressPayload = {
                        ...basePayload,
                        progress: mediaData.progressPercentage,
                        stage: mediaData.processingStage
                    };

                    wsService.io.to(guestRoom).emit('media_processing_progress', progressPayload);
                    wsService.io.to(adminRoom).emit('media_processing_progress', progressPayload);
                    break;

                case 'processing_complete':
                    // Replace optimistic URL with final URL
                    const completePayload = {
                        ...basePayload,
                        finalUrl: mediaData.finalUrl,
                        processingStatus: 'completed',
                        progress: 100,
                        variantsGenerated: true
                    };

                    wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_COMPLETE, completePayload);
                    wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_COMPLETE, completePayload);
                    break;

                case 'processing_failed':
                    // Notify about failure
                    const failedPayload = {
                        ...basePayload,
                        error: mediaData.error,
                        processingStatus: 'failed',
                        shouldRemoveFromUI: true
                    };

                    wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.MEDIA_UPLOAD_FAILED, failedPayload);
                    wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.MEDIA_UPLOAD_FAILED, failedPayload);
                    break;
            }

        } catch (error) {
            logger.error('Failed to broadcast optimistic media update:', error);
        }
    }

    /**
     * 🚀 NEW: Broadcast event stats update (optimistic or actual)
     */
    public broadcastEventStatsUpdate(statsUpdate: EventStatsUpdate): void {
        try {
            const { eventId, type, photoCount, isOptimistic } = statsUpdate;
            
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;
            
            const wsService = getWebSocketService();

            const payload = {
                eventId,
                statsUpdate: {
                    type,
                    photoCount,
                    isOptimistic,
                    timestamp: new Date()
                },
                incrementalUpdate: true
            };

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.EVENT_STATS_UPDATE, payload);
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.EVENT_STATS_UPDATE, payload);

            logger.debug(`Broadcasted ${type} stats update: +${photoCount} photos`);

        } catch (error) {
            logger.error('Failed to broadcast event stats update:', error);
        }
    }

    /**
     * 🚀 ENHANCED: Notify ONLY admins about guest uploads (with optimistic support)
     */
    public notifyAdminsAboutGuestUpload(params: MediaNotificationPayload): void {
        try {
            const { eventId, uploadedBy, mediaData, requiresApproval } = params;
            const adminRoom = `admin_${eventId}`;

            logger.info(`Notifying admins about guest upload: ${mediaData.filename}`, {
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
                timestamp: new Date(),
                isOptimistic: false // Traditional upload
            };

            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, payload);
            logger.info(`Admin notification sent to ${this.getRoomSize(adminRoom)} admin(s)`);

        } catch (error) {
            logger.error('Failed to notify admins about guest upload:', error);
        }
    }

    /**
     * 🚀 ENHANCED: Broadcast new media upload to guests immediately (with optimistic support)
     */
    public broadcastNewMediaToGuests(params: MediaBroadcastPayload): void {
        try {
            const { mediaId, eventId, uploadedBy, mediaData } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`Broadcasting new media to guests: ${mediaId.substring(0, 8)}...`, {
                filename: mediaData.filename,
                uploadedBy: uploadedBy.name,
                room: guestRoom,
                hasInstantPreview: mediaData.hasInstantPreview || false
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
                    thumbnailUrl: mediaData.url,
                    filename: mediaData.filename,
                    originalFilename: mediaData.filename,
                    type: mediaData.type as 'image' | 'video',
                    size: mediaData.size,
                    format: mediaData.format
                },
                status: 'auto_approved',
                uploadedAt: new Date(),
                processingStatus: mediaData.hasInstantPreview ? 'optimistic' : 'processing',
                timestamp: new Date(),
                isInstantPreview: mediaData.hasInstantPreview || false,
                allUsersCanSee: true
            };

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.NEW_MEDIA_UPLOADED, payload);

            // Notify admin room about the broadcast
            const adminRoom = `admin_${eventId}`;
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_NEW_UPLOAD_NOTIFICATION, {
                mediaId,
                guestRoomSize: this.getRoomSize(guestRoom),
                uploadedBy: uploadedBy.name,
                isInstantPreview: mediaData.hasInstantPreview || false,
                timestamp: new Date()
            });

            logger.info(`New media broadcasted to ${this.getRoomSize(guestRoom)} guests`);

        } catch (error) {
            logger.error('Failed to broadcast new media:', error);
        }
    }

    /**
     * 🔄 Broadcast processing completion to guests
     */
    public broadcastProcessingComplete(params: ProcessingCompletePayload): void {
        try {
            const { mediaId, eventId, newUrl, variants, processingTimeMs } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`Broadcasting processing completion: ${mediaId.substring(0, 8)}...`, {
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
                finalUrl: newUrl,
                variants: variants || {
                    thumbnail: newUrl,
                    display: newUrl,
                    full: newUrl
                },
                processingTime: processingTimeMs,
                timestamp: new Date()
            };

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_COMPLETE, payload);
            
            // Also notify admin room
            const adminRoom = `admin_${eventId}`;
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_COMPLETE, payload);
            
            logger.info(`Processing completion broadcasted to guests and admins`);

        } catch (error) {
            logger.error('Failed to broadcast processing completion:', error);
        }
    }

    /**
     * ❌ Broadcast processing failure to guests
     */
    public broadcastProcessingFailed(params: ProcessingFailedPayload): void {
        try {
            const { mediaId, eventId, errorMessage } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`Broadcasting processing failure: ${mediaId.substring(0, 8)}...`);

            const wsService = getWebSocketService();

            const payload = {
                mediaId,
                eventId,
                processingStatus: 'failed' as const,
                progress: 0,
                stage: 'failed' as const,
                variantsGenerated: false,
                error: {
                    code: 'PROCESSING_FAILED',
                    message: 'Image processing failed',
                    details: errorMessage
                },
                shouldRemoveFromUI: true,
                timestamp: new Date()
            };

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.MEDIA_UPLOAD_FAILED, payload);
            
            // Also notify admin room
            const adminRoom = `admin_${eventId}`;
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.MEDIA_UPLOAD_FAILED, payload);
            
            logger.info(`Processing failure broadcasted`);

        } catch (error) {
            logger.error('Failed to broadcast processing failure:', error);
        }
    }

    /**
     * 🗑️ Broadcast media removal to guests
     */
    public broadcastMediaRemoved(params: MediaRemovedPayload): void {
        try {
            const { mediaId, eventId, reason, adminName } = params;
            const guestRoom = `guest_${eventId}`;

            logger.info(`Broadcasting media removal: ${mediaId.substring(0, 8)}... - ${reason}`, {
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

            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.GUEST_MEDIA_REMOVED, payload);

            // Also send to admin room for confirmation
            const adminRoom = `admin_${eventId}`;
            wsService.io.to(adminRoom).emit('media_deletion_broadcasted', {
                mediaId,
                guestRoomSize: this.getRoomSize(guestRoom),
                reason,
                timestamp: new Date()
            });

            logger.info(`Media removal broadcasted to ${this.getRoomSize(guestRoom)} guests`);

        } catch (error) {
            logger.error('Failed to broadcast media removal:', error);
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

                wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.EVENT_STATS_UPDATE, payload);
                wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.EVENT_STATS_UPDATE, payload);

            }).catch(error => {
                logger.warn('Failed to get stats for broadcast:', error);
            });

        } catch (error) {
            logger.error('Failed to broadcast media stats:', error);
        }
    }

    /**
     * 📦 Broadcast bulk media upload notification
     */
    public broadcastBulkMediaUpload(params: {
        batchId: string;
        eventId: string;
        uploadedBy: {
            id: string;
            name: string;
            type: string;
        };
        fileCount: number;
        estimatedCompletionTime: string;
    }): void {
        try {
            const { batchId, eventId, uploadedBy, fileCount, estimatedCompletionTime } = params;
            const guestRoom = `guest_${eventId}`;
            const adminRoom = `admin_${eventId}`;

            logger.info(`Broadcasting bulk upload notification: ${fileCount} files`, {
                batchId,
                uploader: uploadedBy.name,
                estimatedTime: estimatedCompletionTime
            });

            const wsService = getWebSocketService();

            const payload = {
                batchId,
                eventId,
                uploadedBy: {
                    id: uploadedBy.id,
                    name: uploadedBy.name,
                    type: uploadedBy.type,
                },
                bulkUpload: {
                    fileCount,
                    estimatedCompletionTime,
                    status: 'processing',
                    startedAt: new Date()
                },
                message: `${uploadedBy.name} uploaded ${fileCount} photos`,
                timestamp: new Date()
            };

            // Notify guests about bulk upload
            wsService.io.to(guestRoom).emit(WEBSOCKET_EVENTS.BULK_UPLOAD_STARTED, payload);

            // Notify admins
            wsService.io.to(adminRoom).emit(WEBSOCKET_EVENTS.ADMIN_BULK_UPLOAD_NOTIFICATION, {
                ...payload,
                adminInfo: {
                    guestRoomSize: this.getRoomSize(guestRoom),
                    queuedForProcessing: true
                }
            });

            logger.info(`Bulk upload notification sent to ${this.getRoomSize(guestRoom)} guests and ${this.getRoomSize(adminRoom)} admins`);

        } catch (error) {
            logger.error('Failed to broadcast bulk media upload:', error);
        }
    }

    /**
     * 🛠️ Helper Methods
     */
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
                autoApproved: result.approved,
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
export const mediaNotificationService = new MediaNotificationService();
export default mediaNotificationService;
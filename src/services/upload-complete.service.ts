import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { mediaNotificationService } from '@services/websocket/notifications';
import { unifiedProgressService } from '@services/websocket/unified-progress.service';
import { createGuestUploaderInfo, Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { EventParticipant } from '@models/event-participants.model';
import { GuestSession } from '@models/guest-session.model';

interface UploadCompleteContext {
    originalUrl: string;
    eventId: string;
    upload_id: string;
    filename: string;
    size_mb: number;
    format: string;
    width?: number;
    height?: number;
    userId?: string;
    userName?: string;
    isGuestUpload?: boolean;
    guestSessionId?: string;
    guestInfo?: any;
}

class UploadCompleteServiceClass {
    /**
     * Main entry point for upload completion processing
     * Handles direct URL uploads (no ImageKit processing needed)
     */
    async processUploadComplete(context: UploadCompleteContext): Promise<any> {
        const startTime = Date.now();
        const mediaId = new mongoose.Types.ObjectId().toString();

        try {
            logger.info(`🔄 Processing upload complete: ${context.filename}`);

            // Initialize progress tracking
            unifiedProgressService.initializeUpload(
                mediaId,
                context.eventId,
                context.filename,
                context.size_mb * 1024 * 1024 // Convert MB to bytes
            );

            // Broadcast initial progress
            this.broadcastProgress(mediaId, context, 'processing', 50);

            // Validate permissions and get approval status
            const approvalResult = await this.validatePermissionsAndGetApproval(context);

            // Save to database
            await this.saveToDatabase({
                mediaId,
                ...context,
                approvalStatus: approvalResult.status,
                autoApprovalReason: approvalResult.reason
            });

            // Broadcast completion
            const processingTime = Date.now() - startTime;
            this.broadcastComplete(mediaId, context, processingTime);

            logger.info(`✅ Upload complete processing finished: ${context.filename} in ${processingTime}ms`);

            return {
                mediaId,
                url: context.originalUrl,
                filename: context.filename,
                size_mb: context.size_mb,
                format: context.format,
                approval: {
                    status: approvalResult.status,
                    auto_approval_reason: approvalResult.reason
                }
            };

        } catch (error: any) {
            logger.error(`❌ Upload complete processing failed: ${context.filename}`, error);
            this.broadcastError(mediaId, context, error);
            unifiedProgressService.markFailed(mediaId, error.message || 'Processing failed');
            throw error;
        }
    }

    /**
     * Validate permissions and determine approval status
     */
    private async validatePermissionsAndGetApproval(context: UploadCompleteContext): Promise<{ status: 'pending' | 'approved' | 'auto_approved'; reason: string | null }> {
        // Fetch event permissions
        const event = await Event.findById(context.eventId)
            .select('permissions created_by')
            .lean();

        if (!event) {
            throw new Error('Event not found');
        }

        // Check if user is admin (event creator)
        const isAdmin = context.userId && event.created_by.toString() === context.userId;

        if (isAdmin) {
            // Admin uploads are always auto-approved
            return { status: 'auto_approved', reason: 'admin_user' };
        }

        if (context.isGuestUpload) {
            // Validate guest permissions
            if (event.permissions?.can_upload === false) {
                throw new Error('Guest uploads not allowed for this event');
            }

            // Check if guest has participant access
            if (context.guestSessionId) {
                const participant = await EventParticipant.findOne({
                    guest_session_id: context.guestSessionId,
                    event_id: context.eventId,
                    status: 'active'
                }).select('permissions').lean();

                if (!participant) {
                    throw new Error('Guest does not have access to this event');
                }

                if (!participant.permissions?.can_upload) {
                    throw new Error('Guest does not have upload permissions for this event');
                }
            }

            // Determine approval based on event settings
            if (event.permissions?.require_approval === true) {
                return { status: 'pending', reason: null };
            } else {
                return { status: 'auto_approved', reason: 'guest_auto_approve' };
            }
        } else {
            // Authenticated user - check participant permissions
            if (context.userId) {
                const participant = await EventParticipant.findOne({
                    user_id: context.userId,
                    event_id: context.eventId,
                    status: 'active'
                }).select('permissions role').lean();

                if (!participant) {
                    throw new Error('User does not have access to this event');
                }

                if (!participant.permissions?.can_upload) {
                    throw new Error('User does not have upload permissions for this event');
                }

                // Higher roles get auto-approval
                if (['creator', 'co_host', 'moderator'].includes(participant.role as string)) {
                    return { status: 'auto_approved', reason: 'privileged_user' };
                }
            }

            // Regular authenticated users - auto approve
            return { status: 'auto_approved', reason: 'authenticated_user' };
        }
    }

    /**
     * Save media to database with transaction
     */
    private async saveToDatabase(data: any): Promise<void> {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                // Build media document
                const mediaDoc: any = {
                    _id: new mongoose.Types.ObjectId(data.mediaId),
                    url: data.originalUrl,
                    type: 'image',
                    album_id: new mongoose.Types.ObjectId(data.eventId), // Using eventId as albumId
                    event_id: new mongoose.Types.ObjectId(data.eventId),
                    original_filename: data.filename,
                    size_mb: data.size_mb,
                    format: data.format,
                    image_variants: {
                        small: { webp: null, jpeg: null },
                        medium: { webp: null, jpeg: null },
                        large: { webp: null, jpeg: null },
                        original: {
                            url: data.originalUrl,
                            width: data.width || 1920,
                            height: data.height || 1080,
                            size_mb: data.size_mb,
                            format: data.format
                        }
                    },
                    metadata: {
                        width: data.width || 1920,
                        height: data.height || 1080,
                        aspect_ratio: (data.height || 1080) / (data.width || 1920),
                        format: data.format,
                        size: data.size_mb * 1024 * 1024
                    },
                    processing: {
                        status: 'completed',
                        current_stage: 'completed',
                        progress_percentage: 100,
                        started_at: new Date(),
                        completed_at: new Date(),
                        variants_generated: false, // No variants generated for direct URL
                        variants_count: 1 // Only original
                    },
                    approval: {
                        status: data.approvalStatus,
                        auto_approval_reason: data.autoApprovalReason,
                        approved_at: data.approvalStatus !== 'pending' ? new Date() : null,
                        approved_by: null,
                        rejection_reason: ''
                    },
                    upload_id: data.upload_id
                };

                // Handle uploader type
                if (data.isGuestUpload && data.guestSessionId) {
                    mediaDoc.uploader_type = 'guest';
                    mediaDoc.guest_session_id = data.guestSessionId;
                    mediaDoc.uploaded_by = null;

                    if (data.guestInfo) {
                        const guestDataWithSession = {
                            ...data.guestInfo,
                            sessionId: data.guestSessionId
                        };
                        mediaDoc.guest_uploader = createGuestUploaderInfo(guestDataWithSession, true);
                    }
                } else if (data.userId && mongoose.Types.ObjectId.isValid(data.userId)) {
                    mediaDoc.uploader_type = 'registered_user';
                    mediaDoc.uploaded_by = new mongoose.Types.ObjectId(data.userId);
                } else {
                    logger.warn(`Invalid userId: ${data.userId}, treating as guest`);
                    mediaDoc.uploader_type = 'guest';
                    mediaDoc.uploaded_by = null;
                }

                const media = new Media(mediaDoc);
                await media.save({ session });

                // Update event stats based on approval status
                const statsUpdate: any = {
                    $inc: {
                        'stats.total_size_mb': data.size_mb
                    },
                    $set: { 'updated_at': new Date() }
                };

                if (data.approvalStatus === 'pending') {
                    statsUpdate.$inc['stats.pending_approval'] = 1;
                } else {
                    statsUpdate.$inc['stats.photos'] = 1;
                }

                await Event.updateOne(
                    { _id: new mongoose.Types.ObjectId(data.eventId) },
                    statsUpdate,
                    { session }
                );

                // Update participant stats for authenticated users
                if (!data.isGuestUpload && data.userId && mongoose.Types.ObjectId.isValid(data.userId)) {
                    const participant = await EventParticipant.findOne({
                        user_id: new mongoose.Types.ObjectId(data.userId),
                        event_id: new mongoose.Types.ObjectId(data.eventId)
                    }).session(session);

                    if (participant) {
                        await EventParticipant.updateOne(
                            { _id: participant._id },
                            {
                                $inc: {
                                    'stats.uploads_count': 1,
                                    'stats.total_file_size_mb': data.size_mb
                                },
                                $set: {
                                    'stats.last_upload_at': new Date(),
                                    'last_activity_at': new Date()
                                }
                            },
                            { session }
                        );
                    } else {
                        // Create participant record if it doesn't exist
                        await EventParticipant.create([{
                            user_id: new mongoose.Types.ObjectId(data.userId),
                            event_id: new mongoose.Types.ObjectId(data.eventId),
                            join_method: 'admin_upload',
                            status: 'active',
                            joined_at: new Date(),
                            stats: {
                                uploads_count: 1,
                                total_file_size_mb: data.size_mb,
                                last_upload_at: new Date()
                            },
                            last_activity_at: new Date()
                        }], { session });
                    }
                }

                // Update guest session stats if applicable
                if (data.isGuestUpload && data.guestSessionId) {
                    await GuestSession.updateOne(
                        { _id: data.guestSessionId },
                        {
                            $inc: {
                                'upload_stats.successful_uploads': 1,
                                'upload_stats.total_uploads': 1,
                                'upload_stats.total_size_mb': data.size_mb
                            },
                            $set: {
                                'upload_stats.last_upload_at': new Date(),
                                'last_activity_at': new Date()
                            },
                            $setOnInsert: {
                                'upload_stats.first_upload_at': new Date()
                            }
                        },
                        { session }
                    );
                }
            });

            logger.info(`Successfully saved media ${data.mediaId} with approval status: ${data.approvalStatus}`);

        } catch (dbError) {
            logger.error(`Database save failed for ${data.mediaId}:`, dbError);
            throw dbError;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Broadcast progress updates
     */
    private broadcastProgress(mediaId: string, context: UploadCompleteContext, stage: string, percentage: number): void {
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_progress',
            eventId: context.eventId,
            mediaData: {
                id: mediaId,
                filename: context.filename,
                status: 'processing',
                processingStage: stage,
                progressPercentage: percentage,
                message: 'Saving media...',
                uploadedBy: {
                    id: context.userId || 'unknown',
                    name: context.userName || 'Unknown',
                    type: context.isGuestUpload ? 'guest' : 'admin'
                }
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });
    }

    private broadcastComplete(mediaId: string, context: UploadCompleteContext, processingTime: number): void {
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_complete',
            eventId: context.eventId,
            mediaData: {
                id: mediaId,
                filename: context.filename,
                finalUrl: context.originalUrl,
                status: 'completed',
                image_variants: {
                    small: { webp: null, jpeg: null },
                    medium: { webp: null, jpeg: null },
                    large: { webp: null, jpeg: null },
                    original: {
                        url: context.originalUrl,
                        width: context.width || 1920,
                        height: context.height || 1080,
                        size_mb: context.size_mb,
                        format: context.format
                    }
                },
                processingStage: 'completed',
                progressPercentage: 100,
                uploadedBy: {
                    id: context.userId || 'unknown',
                    name: context.userName || 'Unknown',
                    type: context.isGuestUpload ? 'guest' : 'admin'
                }
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });

        // Also use existing method for backward compatibility
        if (mediaNotificationService.broadcastProcessingComplete) {
            mediaNotificationService.broadcastProcessingComplete({
                mediaId,
                eventId: context.eventId,
                newUrl: context.originalUrl,
                variants: {
                    original: {
                        url: context.originalUrl,
                        width: context.width || 1920,
                        height: context.height || 1080,
                        size_mb: context.size_mb,
                        format: context.format
                    },
                },

                processingTimeMs: processingTime
            });
        }
    }

    private broadcastError(mediaId: string, context: UploadCompleteContext, error: any): void {
        mediaNotificationService.broadcastOptimisticMediaUpdate({
            type: 'processing_failed',
            eventId: context.eventId,
            mediaData: {
                id: mediaId,
                filename: context.filename,
                status: 'failed',
                error: error.message || 'Processing failed',
                processingStage: 'failed',
                progressPercentage: 0,
                uploadedBy: {
                    id: context.userId || 'unknown',
                    name: context.userName || 'Unknown',
                    type: context.isGuestUpload ? 'guest' : 'admin'
                }
            },
            timestamp: new Date(),
            allUsersCanSee: true
        });
    }
}

// Export singleton instance
export const uploadCompleteService = new UploadCompleteServiceClass();
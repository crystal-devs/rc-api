// services/sessionClaimService.ts
import mongoose from 'mongoose';
import { GuestSession } from '@models/guest-session.model';
import { EventParticipant } from '@models/event-participants.model';
import { Event } from '@models/event.model';
import { User } from '@models/user.model';
import { Media } from '@models/media.model';
import { logger } from '@utils/logger';

export interface ClaimResult {
    success: boolean;
    sessionsFound: number;
    sessionsClaimed: number;
    mediaMigrated: number;
    errors: string[];
}

export class SessionClaimService {

    /**
     * Find sessions that can be claimed by a user
     */
    static async findClaimableSessions(
        userId: mongoose.Types.ObjectId | string,
        eventId: mongoose.Types.ObjectId | string
    ): Promise<any[]> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const sessions = await GuestSession.findClaimableSessions(
                typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
                typeof eventId === 'string' ? new mongoose.Types.ObjectId(eventId) : eventId,
                user.email,
                user.phone_number
            );

            // Get upload counts for each session
            const sessionsWithCounts = await Promise.all(
                sessions.map(async (session) => {
                    const uploadCount = await Media.countDocuments({
                        guest_session_id: session._id,
                        event_id: eventId
                    });

                    return {
                        sessionId: session.session_id,
                        _id: session._id,
                        uploadCount,
                        firstUploadAt: session.upload_stats.first_upload_at,
                        lastUploadAt: session.upload_stats.last_upload_at,
                        guestName: session.guest_info.name || 'Anonymous Guest',
                        accessMethod: session.access_method
                    };
                })
            );

            return sessionsWithCounts.filter(s => s.uploadCount > 0);
        } catch (error: any) {
            logger.error('Error finding claimable sessions:', error);
            throw error;
        }
    }

    /**
 * Get claim summary by session ID (from cookie)
 */
    static async getClaimSummaryBySessionId(
        userId: mongoose.Types.ObjectId | string,
        eventId: mongoose.Types.ObjectId | string,
        sessionId: string
    ): Promise<any> {
        try {
            const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
            const eventIdObj = typeof eventId === 'string' ? new mongoose.Types.ObjectId(eventId) : eventId;

            // Find session by session_id
            const session = await GuestSession.findOne({
                session_id: sessionId,
                event_id: eventIdObj,
                status: 'active',
                claimed_by_user: null
            });

            if (!session) {
                return {
                    hasClaimableContent: false,
                    totalSessions: 0,
                    totalMedia: 0,
                    sessions: []
                };
            }

            // Count media for this session
            const mediaCount = await Media.countDocuments({
                guest_session_id: session._id,
                event_id: eventIdObj
            });

            if (mediaCount === 0) {
                return {
                    hasClaimableContent: false,
                    totalSessions: 0,
                    totalMedia: 0,
                    sessions: []
                };
            }

            return {
                hasClaimableContent: true,
                totalSessions: 1,
                totalMedia: mediaCount,
                sessions: [{
                    sessionId: session.session_id,
                    _id: session._id,
                    mediaCount: mediaCount,
                    firstUploadAt: session.upload_stats.first_upload_at,
                    lastUploadAt: session.upload_stats.last_upload_at,
                    guestName: session.guest_info.name || 'Anonymous Guest',
                    accessMethod: session.access_method
                }]
            };
        } catch (error: any) {
            logger.error('Error getting claim summary by session ID:', error);
            throw error;
        }
    }

    /**
* Claim guest content (sessionIds are now REQUIRED)
*/
    static async claimGuestContent(
        userId: mongoose.Types.ObjectId | string,
        eventId: mongoose.Types.ObjectId | string,
        sessionIds: string[] // Now required, not optional
    ): Promise<ClaimResult> {
        const session = await mongoose.startSession();
        session.startTransaction();

        const result: ClaimResult = {
            success: false,
            sessionsFound: 0,
            sessionsClaimed: 0,
            mediaMigrated: 0,
            errors: []
        };

        try {
            if (!sessionIds || sessionIds.length === 0) {
                throw new Error('Session IDs are required to claim content');
            }

            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
            const eventIdObj = typeof eventId === 'string' ? new mongoose.Types.ObjectId(eventId) : eventId;

            // Find sessions by session_id (from cookie)
            const sessionsToClaim = await GuestSession.find({
                session_id: { $in: sessionIds },
                event_id: eventIdObj,
                status: 'active',
                claimed_by_user: null
            }).session(session);

            result.sessionsFound = sessionsToClaim.length;

            if (sessionsToClaim.length === 0) {
                await session.commitTransaction();
                result.success = true;
                return result;
            }

            // Update all guest sessions
            const sessionObjectIds = sessionsToClaim.map(s => s._id);

            await GuestSession.updateMany(
                { _id: { $in: sessionObjectIds } },
                {
                    $set: {
                        claimed_by_user: userIdObj,
                        claimed_at: new Date(),
                        status: 'claimed'
                    }
                },
                { session }
            );

            result.sessionsClaimed = sessionsToClaim.length;

            // Migrate media uploads
            const mediaUpdateResult = await Media.updateMany(
                {
                    guest_session_id: { $in: sessionObjectIds },
                    event_id: eventIdObj,
                    uploader_type: 'guest'
                },
                {
                    $set: {
                        uploaded_by: userIdObj,
                        uploader_type: 'registered_user'
                    },
                    $unset: { guest_uploader: 1 }
                },
                { session }
            );

            result.mediaMigrated = mediaUpdateResult.modifiedCount;

            // Ensure EventParticipant exists
            const existingParticipant = await EventParticipant.findOne({
                user_id: userIdObj,
                event_id: eventIdObj
            }).session(session);

            if (!existingParticipant) {
                await EventParticipant.create([{
                    user_id: userIdObj,
                    event_id: eventIdObj,
                    role: 'guest',
                    status: 'active',
                    join_method: 'share_link',
                    joined_at: new Date()
                }], { session });
            }

            // Update event stats
            await this.recalculateEventStats(eventIdObj, session);

            await session.commitTransaction();
            result.success = true;

            logger.info(`✅ Successfully claimed content for user ${userId}:`, {
                sessionsFound: result.sessionsFound,
                sessionsClaimed: result.sessionsClaimed,
                mediaMigrated: result.mediaMigrated
            });

            return result;

        } catch (error: any) {
            await session.abortTransaction();
            logger.error('Error in claimGuestContent:', error);
            result.errors.push(error.message);
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Recalculate event statistics
     */
    private static async recalculateEventStats(
        eventId: mongoose.Types.ObjectId,
        session?: mongoose.ClientSession
    ): Promise<void> {
        try {
            const stats = await Media.aggregate([
                {
                    $match: {
                        event_id: eventId,
                        'approval.status': { $in: ['approved', 'auto_approved'] }
                    }
                },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 },
                        totalSize: { $sum: '$size_mb' }
                    }
                }
            ]).session(session || null);

            const photosCount = stats.find(s => s._id === 'image')?.count || 0;
            const videosCount = stats.find(s => s._id === 'video')?.count || 0;
            const totalSize = stats.reduce((sum, s) => sum + s.totalSize, 0);

            const pendingCount = await Media.countDocuments({
                event_id: eventId,
                'approval.status': 'pending'
            }).session(session || null);

            await Event.updateOne(
                { _id: eventId },
                {
                    $set: {
                        'stats.photos': photosCount,
                        'stats.videos': videosCount,
                        'stats.total_size_mb': totalSize,
                        'stats.pending_approval': pendingCount
                    }
                },
                { session: session || undefined }
            );

        } catch (error: any) {
            logger.error('Error recalculating event stats:', error);
        }
    }

    /**
     * Get claim summary for a user in an event
     */
    static async getClaimSummary(
        userId: mongoose.Types.ObjectId | string,
        eventId: mongoose.Types.ObjectId | string
    ): Promise<any> {
        try {
            const claimableSessions = await this.findClaimableSessions(userId, eventId);

            const totalUploads = claimableSessions.reduce((sum, s) => sum + s.uploadCount, 0);

            return {
                hasClaimableContent: claimableSessions.length > 0,
                sessionsCount: claimableSessions.length,
                totalUploads,
                sessions: claimableSessions
            };
        } catch (error: any) {
            logger.error('Error getting claim summary:', error);
            throw error;
        }
    }
}
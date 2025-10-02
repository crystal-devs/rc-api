// =================================================================
// services/participant.service.ts - Pure Business Logic
// =================================================================

import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
import { EventInvitation } from "@models/event-invitations.model";
import { GuestSession } from "@models/guest-session.model";
import { ActivityLog } from "@models/activity-log.model";
import { User } from "@models/user.model";
import mongoose from "mongoose";
import { logger } from "@utils/logger";

// Service Response Type
interface ServiceResponse<T> {
    status: boolean;
    message: string;
    data: T | null;
    error?: any;
}

// Role permissions template
const ROLE_PERMISSIONS = {
    creator: {
        can_view: true,
        can_upload: true,
        can_download: true,
        can_invite_others: true,
        can_moderate_content: true,
        can_manage_participants: true,
        can_edit_event: true,
        can_delete_event: true,
        can_transfer_ownership: true,
        can_approve_content: true,
        can_export_data: true,
        can_view_analytics: true,
        can_manage_settings: true
    },
    co_host: {
        can_view: true,
        can_upload: true,
        can_download: true,
        can_invite_others: true,
        can_moderate_content: true,
        can_manage_participants: true,
        can_edit_event: true,
        can_delete_event: false,
        can_transfer_ownership: false,
        can_approve_content: true,
        can_export_data: true,
        can_view_analytics: true,
        can_manage_settings: false
    },
    moderator: {
        can_view: true,
        can_upload: true,
        can_download: true,
        can_invite_others: false,
        can_moderate_content: true,
        can_manage_participants: false,
        can_edit_event: false,
        can_delete_event: false,
        can_transfer_ownership: false,
        can_approve_content: true,
        can_export_data: false,
        can_view_analytics: false,
        can_manage_settings: false
    },
    guest: {
        can_view: true,
        can_upload: true,
        can_download: false,
        can_invite_others: false,
        can_moderate_content: false,
        can_manage_participants: false,
        can_edit_event: false,
        can_delete_event: false,
        can_transfer_ownership: false,
        can_approve_content: false,
        can_export_data: false,
        can_view_analytics: false,
        can_manage_settings: false
    },
    viewer: {
        can_view: true,
        can_upload: false,
        can_download: false,
        can_invite_others: false,
        can_moderate_content: false,
        can_manage_participants: false,
        can_edit_event: false,
        can_delete_event: false,
        can_transfer_ownership: false,
        can_approve_content: false,
        can_export_data: false,
        can_view_analytics: false,
        can_manage_settings: false
    }
};

// Get event participants with filtering and pagination
export const getEventParticipants = async (
    eventId: string,
    filters?: {
        role?: string[];
        status?: string[];
        search?: string;
        page?: number;
        limit?: number;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    }
): Promise<ServiceResponse<any>> => {
    try {
        const {
            role,
            status,
            search,
            page = 1,
            limit = 20,
            sortBy = 'joined_at',
            sortOrder = 'desc'
        } = filters || {};

        // Build query
        const query: any = {
            event_id: new mongoose.Types.ObjectId(eventId),
            deleted_at: null
        };

        if (role && role.length > 0) {
            query.role = { $in: role };
        }

        if (status && status.length > 0) {
            query.status = { $in: status };
        }

        // Calculate pagination
        const skip = (page - 1) * limit;
        const sortDirection = sortOrder === 'desc' ? -1 : 1;

        // Build aggregation pipeline for search functionality
        const pipeline: any[] = [
            { $match: query },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'user_info'
                }
            },
            {
                $lookup: {
                    from: 'guest_sessions',
                    localField: 'guest_session_id',
                    foreignField: '_id',
                    as: 'guest_info'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'invited_by',
                    foreignField: '_id',
                    as: 'inviter_info'
                }
            }
        ];

        // Add search filter if provided
        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { 'user_info.name': { $regex: search, $options: 'i' } },
                        { 'user_info.email': { $regex: search, $options: 'i' } },
                        { 'guest_info.guest_info.name': { $regex: search, $options: 'i' } },
                        { 'guest_info.guest_info.email': { $regex: search, $options: 'i' } }
                    ]
                }
            });
        }

        // Add sorting and pagination
        pipeline.push(
            { $sort: { [sortBy]: sortDirection } },
            { $skip: skip },
            { $limit: limit }
        );

        // Execute aggregation
        const [participants, totalCount] = await Promise.all([
            EventParticipant.aggregate(pipeline),
            EventParticipant.countDocuments(query)
        ]);

        // Format participants
        const formattedParticipants = participants.map((participant: any) => {
            const userInfo = participant.user_info?.[0];
            const guestInfo = participant.guest_info?.[0];
            const inviterInfo = participant.inviter_info?.[0];

            return {
                participant_id: participant._id,
                user_id: participant.user_id,
                guest_session_id: participant.guest_session_id,
                role: participant.role,
                status: participant.status,
                join_method: participant.join_method,

                // User information
                user_info: userInfo ? {
                    name: userInfo.name,
                    email: userInfo.email,
                    profile_pic: userInfo.profile_pic
                } : null,

                // Guest information
                guest_info: guestInfo ? {
                    name: guestInfo.guest_info?.name,
                    email: guestInfo.guest_info?.email,
                    access_method: guestInfo.access_method
                } : null,

                // Inviter information
                invited_by: inviterInfo ? {
                    id: inviterInfo._id,
                    name: inviterInfo.name,
                    email: inviterInfo.email
                } : null,

                // Timestamps
                invited_at: participant.invited_at,
                joined_at: participant.joined_at,
                last_activity_at: participant.last_activity_at,
                removed_at: participant.removed_at,

                // Permissions and stats
                permissions: participant.permissions,
                stats: participant.stats
            };
        });

        return {
            status: true,
            message: 'Participants retrieved successfully',
            data: {
                participants: formattedParticipants,
                pagination: {
                    current_page: page,
                    total_pages: Math.ceil(totalCount / limit),
                    total_count: totalCount,
                    has_next: page < Math.ceil(totalCount / limit),
                    has_prev: page > 1
                },
                filters_applied: { role, status, search }
            }
        };

    } catch (error) {
        logger.error(`[getEventParticipants] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to get event participants',
            data: null,
            error
        };
    }
};

// Invite participants (bulk support)
export const inviteParticipants = async (
    eventId: string,
    invites: Array<{
        email?: string;
        phone?: string;
        name?: string;
        role?: 'co_host' | 'moderator' | 'guest' | 'viewer';
    }>,
    invitedBy: string,
    options?: {
        personalMessage?: string;
        expiresInHours?: number;
        autoApprove?: boolean;
    }
): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Validate event exists
        const event = await Event.findById(eventId).session(session);
        if (!event) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        const results = {
            successful: [] as any[],
            failed: [] as any[]
        };

        for (const invite of invites) {
            try {
                // Validate invitation data
                if (!invite.email && !invite.phone) {
                    results.failed.push({
                        invite,
                        error: 'Either email or phone is required'
                    });
                    continue;
                }

                // Check for existing participant
                let existingQuery: any = { event_id: new mongoose.Types.ObjectId(eventId) };

                if (invite.email) {
                    // Check by email in User collection first
                    const user = await User.findOne({ email: invite.email }).session(session);
                    if (user) {
                        existingQuery.user_id = user._id;
                    }
                }

                const existingParticipant = await EventParticipant.findOne(existingQuery).session(session);

                if (existingParticipant) {
                    results.failed.push({
                        invite,
                        error: 'Already a participant'
                    });
                    continue;
                }

                // Create invitation
                const invitation = await EventInvitation.create([{
                    event_id: new mongoose.Types.ObjectId(eventId),
                    invitation_type: invite.email ? 'email' : 'phone',
                    invitee_email: invite.email,
                    invitee_phone: invite.phone,
                    invitee_name: invite.name,
                    invited_by: new mongoose.Types.ObjectId(invitedBy),
                    intended_role: invite.role || 'guest',
                    expires_at: new Date(Date.now() + (options?.expiresInHours || 168) * 60 * 60 * 1000),
                    personal_message: options?.personalMessage
                }], { session });

                results.successful.push({
                    invite,
                    invitation_id: invitation[0]._id,
                    token: invitation[0].token,
                    expires_at: invitation[0].expires_at
                });

            } catch (error) {
                results.failed.push({
                    invite,
                    error: error.message
                });
            }
        }

        // Update event stats
        if (results.successful.length > 0) {
            await Event.findByIdAndUpdate(
                eventId,
                {
                    $inc: { 'stats.pending_invitations': results.successful.length },
                    $set: { updated_at: new Date() }
                },
                { session }
            );

            // Log activity
            await ActivityLog.create([{
                user_id: new mongoose.Types.ObjectId(invitedBy),
                resource_id: new mongoose.Types.ObjectId(eventId),
                resource_type: 'event',
                action: 'added',
                details: {
                    action_type: 'bulk_invite_participants',
                    invitations_sent: results.successful.length,
                    failed_invitations: results.failed.length
                }
            }], { session });
        }

        await session.commitTransaction();

        return {
            status: true,
            message: `Invitations processed: ${results.successful.length} successful, ${results.failed.length} failed`,
            data: {
                successful: results.successful,
                failed: results.failed,
                summary: {
                    total_processed: invites.length,
                    successful_count: results.successful.length,
                    failed_count: results.failed.length
                }
            }
        };

    } catch (error) {
        await session.abortTransaction();
        logger.error(`[inviteParticipants] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to send invitations',
            data: null,
            error
        };
    } finally {
        await session.endSession();
    }
};

// Update participant permissions/role
export const updateParticipant = async (
    eventId: string,
    participantId: string,
    updates: {
        role?: 'co_host' | 'moderator' | 'guest' | 'viewer';
        permissions?: Record<string, boolean>;
        status?: 'active' | 'pending' | 'blocked' | 'removed';
    },
    updatedBy: string
): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Find participant
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        }).session(session);

        if (!participant) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Participant not found',
                data: null
            };
        }

        // Store previous values for logging
        const previousRole = participant.role;
        const previousStatus = participant.status;

        const updateData: any = {};
        let statsUpdate: any = {};

        // Handle role change
        if (updates.role && updates.role !== participant.role) {
            updateData.role = updates.role;
            updateData.permissions = ROLE_PERMISSIONS[updates.role];

            // Update event stats for role changes
            if (previousRole === 'co_host' && updates.role !== 'co_host') {
                statsUpdate['stats.co_hosts_count'] = -1;
            } else if (previousRole !== 'co_host' && updates.role === 'co_host') {
                statsUpdate['stats.co_hosts_count'] = 1;
            }
        }

        // Handle custom permissions
        if (updates.permissions) {
            updateData.permissions = {
                ...participant.permissions,
                ...updates.permissions
            };
        }

        // Handle status change
        if (updates.status && updates.status !== participant.status) {
            updateData.status = updates.status;

            if (updates.status === 'removed') {
                updateData.removed_at = new Date();
                if (participant.status === 'active') {
                    statsUpdate['stats.total_participants'] = -1;
                    if (participant.role === 'co_host') {
                        statsUpdate['stats.co_hosts_count'] = -1;
                    }
                }
            } else if (updates.status === 'active' && participant.status !== 'active') {
                updateData.removed_at = null;
                statsUpdate['stats.total_participants'] = 1;
                if (participant.role === 'co_host') {
                    statsUpdate['stats.co_hosts_count'] = 1;
                }
            }
        }

        // Update participant
        await EventParticipant.findByIdAndUpdate(
            participantId,
            { ...updateData, last_activity_at: new Date() },
            { session }
        );

        // Update event stats if needed
        if (Object.keys(statsUpdate).length > 0) {
            await Event.findByIdAndUpdate(
                eventId,
                { $inc: statsUpdate, $set: { updated_at: new Date() } },
                { session }
            );
        }

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(updatedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: 'event',
            action: 'permission_changed',
            details: {
                target_participant_id: participantId,
                target_user_id: participant.user_id?.toString(),
                changes: {
                    role: { from: previousRole, to: updates.role },
                    status: { from: previousStatus, to: updates.status }
                },
                updated_permissions: updates.permissions ? Object.keys(updates.permissions) : []
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            message: 'Participant updated successfully',
            data: {
                participant_id: participantId,
                event_id: eventId,
                updates_applied: updateData
            }
        };

    } catch (error) {
        await session.abortTransaction();
        logger.error(`[updateParticipant] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to update participant',
            data: null,
            error
        };
    } finally {
        await session.endSession();
    }
};

// Remove participant from event
export const removeParticipant = async (
    eventId: string,
    participantId: string,
    removedBy: string,
    permanent: boolean = false
): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        }).session(session);

        if (!participant) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Participant not found',
                data: null
            };
        }

        // Prevent removing creator
        if (participant.role === 'creator') {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Cannot remove event creator',
                data: null
            };
        }

        let updateData: any;
        let statsUpdate: any = {};

        if (permanent) {
            // Hard delete
            await EventParticipant.findByIdAndDelete(participantId, { session });
            updateData = { deleted: true };
        } else {
            // Soft delete
            updateData = {
                status: 'removed',
                removed_at: new Date()
            };
            await EventParticipant.findByIdAndUpdate(participantId, updateData, { session });
        }

        // Update event stats
        if (participant.status === 'active') {
            statsUpdate['stats.total_participants'] = -1;
            if (participant.role === 'co_host') {
                statsUpdate['stats.co_hosts_count'] = -1;
            } else if (participant.role === 'guest') {
                statsUpdate['stats.guests_count'] = -1;
            }
        }

        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: statsUpdate,
                $set: { updated_at: new Date() }
            },
            { session }
        );

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(removedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: 'event',
            action: 'removed',
            details: {
                target_participant_id: participantId,
                target_user_id: participant.user_id?.toString(),
                target_role: participant.role,
                removal_type: permanent ? 'permanent' : 'soft',
                can_rejoin: !permanent
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            message: `Participant ${permanent ? 'permanently removed' : 'removed'} successfully`,
            data: {
                participant_id: participantId,
                event_id: eventId,
                removal_type: permanent ? 'permanent' : 'soft',
                can_rejoin: !permanent
            }
        };

    } catch (error) {
        await session.abortTransaction();
        logger.error(`[removeParticipant] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to remove participant',
            data: null,
            error
        };
    } finally {
        await session.endSession();
    }
};

// Get participant activity logs
export const getParticipantActivity = async (
    eventId: string,
    participantId: string,
    options?: {
        page?: number;
        limit?: number;
        actions?: string[];
        dateFrom?: Date;
        dateTo?: Date;
    }
): Promise<ServiceResponse<any>> => {
    try {
        const { page = 1, limit = 50, actions, dateFrom, dateTo } = options || {};

        // Find participant to get user_id
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        });

        if (!participant) {
            return {
                status: false,
                message: 'Participant not found',
                data: null
            };
        }

        // Build query for activity logs
        const query: any = {
            user_id: participant.user_id,
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: 'event'
        };

        if (actions && actions.length > 0) {
            query.action = { $in: actions };
        }

        if (dateFrom || dateTo) {
            query.timestamp = {};
            if (dateFrom) query.timestamp.$gte = dateFrom;
            if (dateTo) query.timestamp.$lte = dateTo;
        }

        const skip = (page - 1) * limit;

        const [activities, totalCount] = await Promise.all([
            ActivityLog.find(query)
                .populate('user_id', 'name email profile_pic')
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ActivityLog.countDocuments(query)
        ]);

        return {
            status: true,
            message: 'Participant activity retrieved successfully',
            data: {
                participant_id: participantId,
                activities,
                pagination: {
                    current_page: page,
                    total_pages: Math.ceil(totalCount / limit),
                    total_count: totalCount,
                    has_next: page < Math.ceil(totalCount / limit),
                    has_prev: page > 1
                }
            }
        };

    } catch (error) {
        logger.error(`[getParticipantActivity] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to get participant activity',
            data: null,
            error
        };
    }
};

// Get participant statistics
export const getParticipantStats = async (
    eventId: string,
    participantId: string
): Promise<ServiceResponse<any>> => {
    try {
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        })
            .populate('user_id', 'name email profile_pic')
            .populate('invited_by', 'name email')
            .lean();

        if (!participant) {
            return {
                status: false,
                message: 'Participant not found',
                data: null
            };
        }

        // Calculate additional stats from activity logs if needed
        const activityStats = await ActivityLog.aggregate([
            {
                $match: {
                    user_id: participant.user_id,
                    resource_id: new mongoose.Types.ObjectId(eventId),
                    resource_type: 'event'
                }
            },
            {
                $group: {
                    _id: '$action',
                    count: { $sum: 1 },
                    latest: { $max: '$timestamp' }
                }
            }
        ]);

        return {
            status: true,
            message: 'Participant statistics retrieved successfully',
            data: {
                participant_id: participantId,
                user_info: participant.user_id,
                role: participant.role,
                status: participant.status,
                join_method: participant.join_method,
                joined_at: participant.joined_at,
                last_activity_at: participant.last_activity_at,
                stats: participant.stats,
                activity_breakdown: activityStats,
                permissions: participant.permissions,
                invited_by: participant.invited_by
            }
        };

    } catch (error) {
        logger.error(`[getParticipantStats] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to get participant statistics',
            data: null,
            error
        };
    }
};
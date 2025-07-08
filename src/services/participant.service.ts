// services/participant.service.ts
// ================================================================

import { EventParticipant, EventParticipantType } from "@models/event-participant.model";
import { ShareToken, ShareTokenType } from "@models/share-token.model";
import { Event } from "@models/event.model";
import { User } from "@models/user.model";
import { ActivityLog } from "@models/activity-log.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "types/service.types";
// import { sendEmail } from "@utils/email.util";
import * as crypto from 'crypto';

// ============= PARTICIPANT MANAGEMENT SERVICES =============

export const getEventParticipantsService = async (filters: {
    eventId: string;
    requesterId: string;
    page: number;
    limit: number;
    status: string;
    role: string;
    search: string;
    sort: string;
}): Promise<ServiceResponse<any>> => {
    try {
        const { eventId, requesterId, page, limit, status, role, search, sort } = filters;

        // Build aggregation pipeline for participants
        const pipeline: any[] = [
            { $match: { event_id: new mongoose.Types.ObjectId(eventId) } }
        ];

        if (status && status !== 'all') {
            pipeline.push({ $match: { 'participation.status': status } });
        }
        if (role && role !== 'all') {
            pipeline.push({ $match: { 'participation.role': role } });
        }
        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { 'guest_info.name': { $regex: search, $options: 'i' } },
                        { 'guest_info.email': { $regex: search, $options: 'i' } }
                    ]
                }
            });
        }

        // Sorting
        if (sort) {
            const sortObj: any = {};
            const [field, direction] = sort.split(':');
            sortObj[field] = direction === 'desc' ? -1 : 1;
            pipeline.push({ $sort: sortObj });
        } else {
            pipeline.push({ $sort: { 'participation.joined_at': -1 } });
        }

        // Pagination
        pipeline.push({ $skip: (page - 1) * limit });
        pipeline.push({ $limit: limit });

        const participants = await EventParticipant.aggregate(pipeline);

        // Get summary statistics
        const statsPromise = EventParticipant.aggregate([
            { $match: { event_id: new mongoose.Types.ObjectId(eventId) } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                        $sum: {
                            $cond: [{ $eq: ["$participation.status", "active"] }, 1, 0]
                        }
                    },
                    pending: {
                        $sum: {
                            $cond: [{ $eq: ["$participation.status", "invited"] }, 1, 0]
                        }
                    },
                    owners: {
                        $sum: {
                            $cond: [{ $eq: ["$participation.role", "owner"] }, 1, 0]
                        }
                    },
                    co_hosts: {
                        $sum: {
                            $cond: [{ $eq: ["$participation.role", "co_host"] }, 1, 0]
                        }
                    },
                    guests: {
                        $sum: {
                            $cond: [{ $eq: ["$participation.role", "guest"] }, 1, 0]
                        }
                    },
                    online_now: {
                        $sum: {
                            $cond: [
                                {
                                    $gt: [
                                        "$participation.last_seen",
                                        new Date(Date.now() - 15 * 60 * 1000)
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const stats = (await statsPromise)[0] || {
            total: 0, active: 0, pending: 0, owners: 0, co_hosts: 0, guests: 0, online_now: 0
        };

        return {
            status: true,
            code: 200,
            message: "Participants fetched successfully",
            data: {
                participants,
                pagination: {
                    current_page: page,
                    total_pages: Math.ceil(stats.total / limit),
                    total_participants: stats.total,
                    has_next: page < Math.ceil(stats.total / limit),
                    has_previous: page > 1,
                    per_page: limit
                },
                stats
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[joinEventViaTokenService] Error: ${error.message}`);
        // await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to join event",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        // await session.endSession();
    }
};

export const getTokenInfoService = async (token: string): Promise<ServiceResponse<any>> => {
    try {
        const shareToken = await ShareToken.findOne({
            token,
            revoked: false
        }).populate([
            {
                path: 'event_id',
                select: 'title description cover_image location start_date privacy',
                populate: {
                    path: 'created_by',
                    select: 'name avatar_url'
                }
            },
            {
                path: 'created_by',
                select: 'name avatar_url'
            }
        ]);

        if (!shareToken) {
            return {
                status: false,
                code: 404,
                message: "Invalid invitation link",
                data: null,
                error: null,
                other: null
            };
        }

        // Check if expired
        const isExpired = shareToken.restrictions.expires_at && shareToken.restrictions.expires_at < new Date();
        const isAtCapacity = shareToken.restrictions.max_uses && shareToken.usage.count >= shareToken.restrictions.max_uses;

        if (isExpired) {
            return {
                status: false,
                code: 410,
                message: "This invitation link has expired",
                data: null,
                error: null,
                other: null
            };
        }

        if (isAtCapacity) {
            return {
                status: false,
                code: 410,
                message: "This invitation link has reached its usage limit",
                data: null,
                error: null,
                other: null
            };
        }

        return {
            status: true,
            code: 200,
            message: "Token info retrieved successfully",
            data: {
                event: shareToken.event_id,
                token_type: shareToken.token_type,
                permissions: shareToken.permissions,
                restrictions: {
                    requires_approval: shareToken.restrictions.requires_approval,
                    has_email_restrictions: shareToken.restrictions.allowed_emails.length > 0,
                    expires_at: shareToken.restrictions.expires_at,
                    max_uses: shareToken.restrictions.max_uses,
                    current_uses: shareToken.usage.count
                },
                inviter: shareToken.created_by
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getTokenInfoService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to get token info",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const updateShareTokenService = async (data: {
    eventId: string;
    tokenId: string;
    updateData: any;
    updatedBy: string;
}): Promise<ServiceResponse<ShareTokenType>> => {
    try {
        const { eventId, tokenId, updateData, updatedBy } = data;

        // Find token
        const token = await ShareToken.findOne({
            _id: new mongoose.Types.ObjectId(tokenId),
            event_id: new mongoose.Types.ObjectId(eventId),
            revoked: false
        });

        if (!token) {
            return {
                status: false,
                code: 404,
                message: "Share token not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Prepare update object
        const update: any = {};

        if (updateData.permissions) {
            update.permissions = { ...token.permissions, ...updateData.permissions };
        }

        if (updateData.restrictions) {
            update.restrictions = { ...token.restrictions, ...updateData.restrictions };
            
            // Handle date conversion
            if (updateData.restrictions.expires_at) {
                update.restrictions.expires_at = new Date(updateData.restrictions.expires_at);
            }
        }

        if (updateData.token_type) {
            update.token_type = updateData.token_type;
        }

        // Update token
        const updatedToken = await ShareToken.findByIdAndUpdate(
            tokenId,
            { $set: update },
            { new: true }
        );

        // Log activity
        await ActivityLog.create({
            user_id: new mongoose.Types.ObjectId(updatedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "share_token",
                subaction: "token_updated",
                token_id: tokenId,
                changes: Object.keys(updateData)
            }
        });

        return {
            status: true,
            code: 200,
            message: "Share token updated successfully",
            data: updatedToken,
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[updateShareTokenService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to update share token",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const revokeShareTokenService = async (data: {
    eventId: string;
    tokenId: string;
    revokedBy: string;
    reason: string;
}): Promise<ServiceResponse<{ revoked: boolean }>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { eventId, tokenId, revokedBy, reason } = data;

        // Find and revoke token
        const token = await ShareToken.findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(tokenId),
                event_id: new mongoose.Types.ObjectId(eventId),
                revoked: false
            },
            {
                $set: {
                    revoked: true,
                    revoked_at: new Date(),
                    revoked_by: new mongoose.Types.ObjectId(revokedBy)
                }
            },
            { new: true, session }
        );

        if (!token) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Share token not found or already revoked",
                data: null,
                error: null,
                other: null
            };
        }

        // Update event stats
        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: { 'stats.sharing.active_tokens': -1 },
                $set: { updated_at: new Date() }
            },
            { session }
        );

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(revokedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "share_token",
                subaction: "token_revoked",
                token_id: tokenId,
                reason,
                usage_count: token.usage.count
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: "Share token revoked successfully",
            data: { revoked: true },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[revokeShareTokenService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to revoke share token",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const getTokenAnalyticsService = async (data: {
    eventId: string;
    tokenId: string;
    requesterId: string;
    period: string;
    metrics: string;
}): Promise<ServiceResponse<any>> => {
    try {
        const { eventId, tokenId, period } = data;

        // Calculate date range based on period
        const now = new Date();
        let startDate: Date;

        switch (period) {
            case '24h':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(0); // All time
        }

        // Get token details
        const token = await ShareToken.findOne({
            _id: new mongoose.Types.ObjectId(tokenId),
            event_id: new mongoose.Types.ObjectId(eventId)
        });

        if (!token) {
            return {
                status: false,
                code: 404,
                message: "Share token not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Get participants who used this token
        const participants = await EventParticipant.find({
            share_token_used: new mongoose.Types.ObjectId(tokenId),
            created_at: { $gte: startDate }
        }).select('participation.status participation.joined_at guest_info.email created_at');

        // Get usage analytics
        const analytics = {
            token_info: {
                token_type: token.token_type,
                created_at: token.created_at,
                total_uses: token.usage.count,
                last_used: token.usage.last_used,
                is_active: !token.revoked && (!token.restrictions.expires_at || token.restrictions.expires_at > now)
            },
            usage_stats: {
                total_clicks: token.usage.count,
                successful_joins: participants.filter(p => p.participation.status === 'active').length,
                pending_approvals: participants.filter(p => p.participation.status === 'invited').length,
                conversion_rate: token.usage.count > 0 ? 
                    (participants.filter(p => p.participation.status === 'active').length / token.usage.count) * 100 : 0
            },
            time_series: generateTimeSeriesData(participants, startDate, now),
            participant_details: participants.map(p => ({
                email: p.guest_info.email,
                status: p.participation.status,
                joined_at: p.participation.joined_at || p.created_at,
                days_since_join: p.participation.joined_at ? 
                    Math.floor((now.getTime() - p.participation.joined_at.getTime()) / (1000 * 60 * 60 * 24)) : null
            }))
        };

        return {
            status: true,
            code: 200,
            message: "Token analytics retrieved successfully",
            data: analytics,
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getTokenAnalyticsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to get token analytics",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

// ============= UTILITY FUNCTIONS =============

const generateTimeSeriesData = (participants: any[], startDate: Date, endDate: Date) => {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const timeSeries = [];

    for (let i = 0; i < days; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        
        const dayParticipants = participants.filter(p => {
            const joinDate = p.participation.joined_at || p.created_at;
            return joinDate >= date && joinDate < nextDate;
        });

        timeSeries.push({
            date: date.toISOString().split('T')[0],
            joins: dayParticipants.length,
            active_joins: dayParticipants.filter(p => p.participation.status === 'active').length
        });
    }

    return timeSeries;
};

export const exportParticipantsService = async (data: {
    eventId: string;
    requesterId: string;
    format: string;
    includeActivity: boolean;
    statusFilter: string;
}): Promise<ServiceResponse<string>> => {
    try {
        const { eventId, format, includeActivity, statusFilter } = data;

        // Build query
        const query: any = { event_id: new mongoose.Types.ObjectId(eventId) };
        
        if (statusFilter !== 'all') {
            query['participation.status'] = statusFilter;
        }

        // Get participants with populated data
        const participants = await EventParticipant.find(query)
            .populate('invited_by', 'name email')
            .populate('share_token_used', 'token_type created_at')
            .sort({ 'participation.joined_at': -1 });

        if (format === 'csv') {
            let csvHeaders = [
                'Name',
                'Email',
                'Role',
                'Status',
                'Joined Date',
                'Last Seen',
                'Invited By',
                'Photos Uploaded',
                'Comments Made'
            ];

            if (includeActivity) {
                csvHeaders.push('Session Count', 'Last Upload', 'Total Views');
            }

            let csvContent = csvHeaders.join(',') + '\n';

            participants.forEach(participant => {
                const row = [
                    `"${participant.guest_info.name}"`,
                    `"${participant.guest_info.email}"`,
                    participant.participation.role,
                    participant.participation.status,
                    participant.participation.joined_at ? participant.participation.joined_at.toISOString().split('T')[0] : '',
                    participant.participation.last_seen ? participant.participation.last_seen.toISOString().split('T')[0] : '',
                    participant.invited_by ? `"${participant.invited_by}"` : '',
                    participant.activity.photos_uploaded,
                    participant.activity.comments_made
                ];

                if (includeActivity) {
                    row.push(
                        participant.activity.session_count.toString(),
                        participant.activity.last_upload ? participant.activity.last_upload.toISOString().split('T')[0] : '',
                        participant.activity.photos_viewed.toString()
                    );
                }

                csvContent += row.join(',') + '\n';
            });

            return {
                status: true,
                code: 200,
                message: "Participants exported successfully",
                data: csvContent,
                error: null,
                other: null
            };
        } else {
            throw new Error("Unsupported export format");
        }
    } catch (error) {
        logger.error(`[exportParticipantsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to export participants",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const bulkUpdateParticipantsService = async (data: {
    eventId: string;
    participantIds: string[];
    action: string;
    data: any;
    updatedBy: string;
}): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { eventId, participantIds, action, data: actionData, updatedBy } = data;

        const objectIds = participantIds.map(id => new mongoose.Types.ObjectId(id));
        let updateResult;

        switch (action) {
            case 'update_permissions':
                updateResult = await EventParticipant.updateMany(
                    {
                        _id: { $in: objectIds },
                        event_id: new mongoose.Types.ObjectId(eventId)
                    },
                    {
                        $set: {
                            permissions: { ...actionData.permissions },
                            updated_at: new Date()
                        }
                    },
                    { session }
                );
                break;

            case 'change_role':
                updateResult = await EventParticipant.updateMany(
                    {
                        _id: { $in: objectIds },
                        event_id: new mongoose.Types.ObjectId(eventId),
                        'participation.role': { $ne: 'owner' } // Cannot change owner role
                    },
                    {
                        $set: {
                            'participation.role': actionData.role,
                            updated_at: new Date()
                        }
                    },
                    { session }
                );
                break;

            case 'remove':
                updateResult = await EventParticipant.updateMany(
                    {
                        _id: { $in: objectIds },
                        event_id: new mongoose.Types.ObjectId(eventId),
                        'participation.role': { $ne: 'owner' } // Cannot remove owner
                    },
                    {
                        $set: {
                            'participation.status': 'removed',
                            'participation.left_at': new Date(),
                            updated_at: new Date()
                        }
                    },
                    { session }
                );
                break;

            default:
                throw new Error("Invalid bulk action");
        }

        // Log bulk activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(updatedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "participant",
                subaction: `bulk_${action}`,
                participant_count: updateResult.modifiedCount,
                action_data: actionData
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: `Bulk ${action} completed successfully`,
            data: {
                modified_count: updateResult.modifiedCount,
                action: action
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[bulkUpdateParticipantsService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to perform bulk update",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const getParticipantDetailsService = async (data: {
    eventId: string;
    participantId: string;
    requesterId: string;
}): Promise<ServiceResponse<any>> => {
    try {
        const { eventId, participantId } = data;

        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        }).populate([
            {
                path: 'user_id',
                select: 'name email avatar_url verified created_at'
            },
            {
                path: 'invited_by',
                select: 'name email avatar_url'
            },
            {
                path: 'share_token_used',
                select: 'token_type created_at'
            }
        ]);

        if (!participant) {
            return {
                status: false,
                code: 404,
                message: "Participant not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Get recent activity for this participant
        const recentActivity = await ActivityLog.find({
            user_id: participant.user_id,
            resource_id: new mongoose.Types.ObjectId(eventId)
        })
        .sort({ created_at: -1 })
        .limit(20)
        .select('action metadata created_at');

        return {
            status: true,
            code: 200,
            message: "Participant details retrieved successfully",
            data: {
                participant,
                recent_activity: recentActivity
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getParticipantDetailsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to get participant details",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const getParticipantActivityService = async (data: {
    eventId: string;
    participantId: string;
    requesterId: string;
    page: number;
    limit: number;
    type: string;
    dateFrom?: Date;
    dateTo?: Date;
}): Promise<ServiceResponse<any>> => {
    try {
        const { eventId, participantId, page, limit, type, dateFrom, dateTo } = data;

        // Build query
        const query: any = {
            resource_id: new mongoose.Types.ObjectId(eventId)
        };

        // Get participant to find user_id
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        });

        if (!participant) {
            return {
                status: false,
                code: 404,
                message: "Participant not found",
                data: null,
                error: null,
                other: null
            };
        }

        if (participant.user_id) {
            query.user_id = participant.user_id;
        }

        if (type !== 'all') {
            query.action = { $regex: type, $options: 'i' };
        }

        if (dateFrom || dateTo) {
            query.created_at = {};
            if (dateFrom) query.created_at.$gte = dateFrom;
            if (dateTo) query.created_at.$lte = dateTo;
        }

        // Get total count
        const total = await ActivityLog.countDocuments(query);

        // Get activities with pagination
        const activities = await ActivityLog.find(query)
            .sort({ created_at: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select('action metadata created_at');

        return {
            status: true,
            code: 200,
            message: "Participant activity retrieved successfully",
            data: {
                activities,
                pagination: {
                    current_page: page,
                    total_pages: Math.ceil(total / limit),
                    total_activities: total,
                    has_next: page < Math.ceil(total / limit),
                    has_previous: page > 1,
                    per_page: limit
                }
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getParticipantActivityService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to get participant activity",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const inviteParticipantsService = async (data: {
    eventId: string;
    invitedBy: string;
    participants: Array<{
        email: string;
        name: string;
        role?: string;
        permissions?: any;
    }>;
    message: string;
    sendImmediately: boolean;
}): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { eventId, invitedBy, participants, message, sendImmediately } = data;

        // Get event details
        const event = await Event.findById(eventId).session(session);
        if (!event) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Check for existing participants
        const existingEmails = await EventParticipant.find({
            event_id: new mongoose.Types.ObjectId(eventId),
            'guest_info.email': { $in: participants.map(p => p.email) }
        }).select('guest_info.email').session(session);

        const existingEmailSet = new Set(existingEmails.map(p => p.guest_info.email));
        const newParticipants = participants.filter(p => !existingEmailSet.has(p.email));
        const skippedCount = participants.length - newParticipants.length;

        if (newParticipants.length === 0) {
            await session.abortTransaction();
            return {
                status: false,
                code: 400,
                message: "All participants are already invited to this event",
                data: null,
                error: null,
                other: null
            };
        }

        // Create share token for invitations
        const shareToken = await createInvitationToken(eventId, invitedBy, session);

        // Create participant records
        const participantRecords = newParticipants.map(p => ({
            event_id: new mongoose.Types.ObjectId(eventId),
            user_id: null as mongoose.Types.ObjectId | null, // Will be updated when they register/login
            guest_info: {
                email: p.email,
                name: p.name,
                avatar_url: '',
                is_anonymous: false
            },
            participation: {
                status: 'invited',
                role: p.role || 'guest',
                invite_sent_at: new Date()
            },
            permissions: p.permissions || event.default_guest_permissions || {
                view: true,
                upload: false,
                download: false,
                share: false,
                comment: true,
                manage_guests: false
            },
            activity: {
                photos_uploaded: 0,
                photos_viewed: 0,
                comments_made: 0,
                session_count: 0
            },
            invited_by: new mongoose.Types.ObjectId(invitedBy),
            share_token_used: shareToken._id,
            created_at: new Date(),
            updated_at: new Date()
        }));

        const createdParticipants = await EventParticipant.create(participantRecords, { session });

        // Update event stats
        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: { 
                    'stats.participants.total': newParticipants.length,
                    'stats.participants.pending_invites': newParticipants.length
                },
                $set: { updated_at: new Date() }
            },
            { session }
        );

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(invitedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "participants",
                subaction: "participants_invited",
                invited_count: newParticipants.length,
                participant_emails: newParticipants.map(p => p.email),
                message
            }
        }], { session });

        await session.commitTransaction();

        // Send invitation emails if requested
        if (sendImmediately) {
            try {
                // Uncomment this section when email functionality is implemented
                // const emailPromises = newParticipants.map(p => 
                //     sendInvitationEmail({
                //         recipient: p,
                //         event,
                //         inviterName: 'Event Host',
                //         shareToken: shareToken.token,
                //         customMessage: message
                //     })
                // );

                // // Send emails without waiting (fire and forget)
                // Promise.all(emailPromises).catch(error => {
                //     logger.error(`[inviteParticipantsService] Email sending failed: ${error.message}`);
                // });
                console.log(`Sending ${newParticipants.length} invitations (email functionality not implemented yet)`);
            } catch (emailError) {
                // Just log the error but don't fail the overall operation
                console.error("Error sending invitation emails:", emailError);
            }
        }

        return {
            status: true,
            code: 201,
            message: `Successfully invited ${newParticipants.length} participants`,
            data: {
                invited: createdParticipants,
                skipped_existing: skippedCount,
                share_token: shareToken.token,
                invitation_link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/join/${shareToken.token}`
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[inviteParticipantsService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to invite participants",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const updateParticipantService = async (data: {
    eventId: string;
    participantId: string;
    updatedBy: string;
    updateData: any;
}): Promise<ServiceResponse<EventParticipantType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { eventId, participantId, updatedBy, updateData } = data;

        // Get current participant
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        }).session(session);

        if (!participant) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Participant not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Prepare update object
        const update: any = { updated_at: new Date() };

        // Handle permissions update
        if (updateData.permissions) {
            update.permissions = { ...participant.permissions, ...updateData.permissions };
        }

        // Handle role update
        if (updateData.role && updateData.role !== participant.participation.role) {
            update['participation.role'] = updateData.role;
            
            // Auto-adjust permissions based on role
            if (updateData.role === 'co_host') {
                update.permissions = {
                    ...update.permissions,
                    view: true,
                    upload: true,
                    download: true,
                    comment: true,
                    manage_guests: true
                };
            } else if (updateData.role === 'guest') {
                update.permissions = {
                    ...update.permissions,
                    manage_guests: false
                };
            }
        }

        // Handle status update
        if (updateData.status && updateData.status !== participant.participation.status) {
            update['participation.status'] = updateData.status;
            
            if (updateData.status === 'active' && participant.participation.status === 'invited') {
                update['participation.invite_accepted_at'] = new Date();
                update['participation.joined_at'] = new Date();
            } else if (updateData.status === 'left' || updateData.status === 'removed') {
                update['participation.left_at'] = new Date();
            }
        }

        // Update participant
        const updatedParticipant = await EventParticipant.findByIdAndUpdate(
            participantId,
            { $set: update },
            { new: true, session }
        );

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(updatedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "participant",
                subaction: "participant_updated",
                participant_email: participant.guest_info.email,
                changes: Object.keys(updateData),
                new_role: updateData.role,
                new_status: updateData.status
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: "Participant updated successfully",
            data: updatedParticipant,
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[updateParticipantService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to update participant",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const removeParticipantService = async (data: {
    eventId: string;
    participantId: string;
    removedBy: string;
    reason: string;
}): Promise<ServiceResponse<{ removed: boolean }>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { eventId, participantId, removedBy, reason } = data;

        // Get participant
        const participant = await EventParticipant.findOne({
            _id: new mongoose.Types.ObjectId(participantId),
            event_id: new mongoose.Types.ObjectId(eventId)
        }).session(session);

        if (!participant) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Participant not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Cannot remove event owner
        if (participant.participation.role === 'owner') {
            await session.abortTransaction();
            return {
                status: false,
                code: 403,
                message: "Cannot remove event owner",
                data: null,
                error: null,
                other: null
            };
        }

        // Update participant status instead of deleting
        await EventParticipant.findByIdAndUpdate(
            participantId,
            {
                $set: {
                    'participation.status': 'removed',
                    'participation.left_at': new Date(),
                    updated_at: new Date()
                }
            },
            { session }
        );

        // Update event stats
        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: { 'stats.participants.total': -1 },
                $set: { updated_at: new Date() }
            },
            { session }
        );

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(removedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "participant",
                subaction: "participant_removed",
                participant_email: participant.guest_info.email,
                participant_role: participant.participation.role,
                reason
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: "Participant removed successfully",
            data: { removed: true },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[removeParticipantService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to remove participant",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

// Helper to create invitation tokens
const createInvitationToken = async (
    eventId: string, 
    createdBy: string, 
    session?: mongoose.ClientSession
): Promise<any> => {
    try {
        // Import the ShareToken model and necessary crypto functions
        const ShareToken = mongoose.model(MODEL_NAMES.SHARE_TOKEN);
        const crypto = require('crypto');
        
        // Generate unique token
        let token: string;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            token = crypto.randomBytes(16).toString('hex');
            const existing = await ShareToken.findOne({ token }).session(session);
            if (!existing) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            throw new Error("Failed to generate unique invitation token");
        }

        // Create the share token for invitation
        const shareToken = await ShareToken.create(
            [{
                event_id: new mongoose.Types.ObjectId(eventId),
                album_id: null,
                token,
                token_type: 'invite',
                name: 'Invitation Link',
                description: 'Token for participant invitations',
                permissions: {
                    view: true,
                    upload: true,
                    download: false,
                    share: false,
                    comment: true
                },
                restrictions: {
                    max_uses: null,
                    expires_at: null,
                    allowed_emails: [],
                    requires_approval: false
                },
                usage: {
                    count: 0,
                    used_by: []
                },
                created_by: new mongoose.Types.ObjectId(createdBy),
                revoked: false,
                created_at: new Date(),
                updated_at: new Date()
            }], 
            session ? { session } : {}
        );

        return shareToken[0];
    } catch (error) {
        logger.error(`Error creating invitation token: ${error.message}`);
        throw error;
    }
};
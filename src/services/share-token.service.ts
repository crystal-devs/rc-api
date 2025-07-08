// services/share-token.service.ts

import { ServiceResponse } from "types/service.types";
import mongoose from "mongoose";
import * as crypto from 'crypto';
import { Event } from "@models/event.model";
import { ActivityLog } from "@models/activity-log.model";
import { EventParticipant } from "@models/event-participant.model";
import { logger } from "@utils/logger";
import { ShareToken, ShareTokenType } from "@models/share-token.model";
import { MODEL_NAMES } from "@models/names";

// ============= SHARE TOKEN MANAGEMENT SERVICES =============

export const getEventShareTokensService = async (filters: {
    eventId: string;
    requesterId: string;
    page: number;
    limit: number;
    type: string;
    status: string;
}): Promise<ServiceResponse<any>> => {
    try {
        const { eventId, page, limit, type, status } = filters;

        const pipeline: any[] = [
            { $match: { event_id: new mongoose.Types.ObjectId(eventId) } }
        ];

        // Apply filters
        const matchConditions: any = {};

        if (status === 'active') {
            matchConditions.revoked = false;
            matchConditions.$or = [
                { 'restrictions.expires_at': null },
                { 'restrictions.expires_at': { $gt: new Date() } }
            ];
        } else if (status === 'expired') {
            matchConditions.revoked = false;
            matchConditions['restrictions.expires_at'] = { $lt: new Date() };
        } else if (status === 'revoked') {
            matchConditions.revoked = true;
        }

        if (type !== 'all') {
            matchConditions.token_type = type;
        }

        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }

        // Add creator details
        pipeline.push(
            {
                $lookup: {
                    from: MODEL_NAMES.USER,
                    localField: "created_by",
                    foreignField: "_id",
                    as: "creator_info",
                    pipeline: [
                        { $project: { name: 1, email: 1, avatar_url: 1 } }
                    ]
                }
            },
            {
                $addFields: {
                    creator: { $arrayElemAt: ["$creator_info", 0] },
                    is_expired: {
                        $and: [
                            { $ne: ["$restrictions.expires_at", null] },
                            { $lt: ["$restrictions.expires_at", new Date()] }
                        ]
                    },
                    usage_percentage: {
                        $cond: [
                            { $eq: ["$restrictions.max_uses", null] },
                            0,
                            {
                                $multiply: [
                                    { $divide: ["$usage.count", "$restrictions.max_uses"] },
                                    100
                                ]
                            }
                        ]
                    }
                }
            },
            {
                $project: {
                    creator_info: 0
                }
            }
        );

        // Count total
        const countPipeline = [...pipeline, { $count: "total" }];
        const totalResult = await ShareToken.aggregate(countPipeline);
        const total = totalResult[0]?.total || 0;

        // Add sorting and pagination
        pipeline.push(
            { $sort: { created_at: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit }
        );

        const tokens = await ShareToken.aggregate(pipeline);

        return {
            status: true,
            code: 200,
            message: "Share tokens retrieved successfully",
            data: {
                tokens,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            },
            error: null,
            other: null
        };
    } finally {
        // await session.endSession();
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

// ============= BULK OPERATIONS =============

export const bulkRevokeTokensService = async (data: {
    eventId: string;
    tokenIds: string[];
    revokedBy: string;
    reason: string;
}): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { eventId, tokenIds, revokedBy, reason } = data;

        const objectIds = tokenIds.map(id => new mongoose.Types.ObjectId(id));

        // Bulk revoke tokens
        const revokeResult = await ShareToken.updateMany(
            {
                _id: { $in: objectIds },
                event_id: new mongoose.Types.ObjectId(eventId),
                revoked: false
            },
            {
                $set: {
                    revoked: true,
                    revoked_at: new Date(),
                    revoked_by: new mongoose.Types.ObjectId(revokedBy),
                    // revoke_reason: reason || "Bulk revocation"
                }
            },
            { session }
        );

        // Update event stats
        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: { 'stats.sharing.active_tokens': -revokeResult.modifiedCount },
                $set: { updated_at: new Date() }
            },
            { session }
        );

        // Log bulk activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(revokedBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "edited",
            details: {
                type: "share_token",
                subaction: "bulk_tokens_revoked",
                revoked_count: revokeResult.modifiedCount,
                token_ids: tokenIds,
                reason
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: `Successfully revoked ${revokeResult.modifiedCount} tokens`,
            data: {
                revoked_count: revokeResult.modifiedCount,
                total_requested: tokenIds.length
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[bulkRevokeTokensService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to bulk revoke tokens",
            data: null,
            error: { message: error.message },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const getEventSharingStatusService = async (
    eventId: string,
    userId: string
): Promise<ServiceResponse<any>> => {
    try {
        // Get event details
        const event = await Event.findById(eventId).select('privacy stats.sharing');
        if (!event) {
            return {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Get active tokens count
        const activeTokensCount = await ShareToken.countDocuments({
            event_id: new mongoose.Types.ObjectId(eventId),
            revoked: false,
            $or: [
                { 'restrictions.expires_at': null },
                { 'restrictions.expires_at': { $gt: new Date() } }
            ]
        });

        // Get recent tokens
        const recentTokens = await ShareToken.find({
            event_id: new mongoose.Types.ObjectId(eventId)
        })
            .sort({ created_at: -1 })
            .limit(5)
            .select('token_type created_at usage.count revoked')
            .populate('created_by', 'name');

        // Get sharing analytics
        const totalParticipants = await EventParticipant.countDocuments({
            event_id: new mongoose.Types.ObjectId(eventId),
            'participation.status': { $in: ['active', 'pending'] }
        });

        const invitedViaTokens = await EventParticipant.countDocuments({
            event_id: new mongoose.Types.ObjectId(eventId),
            share_token_used: { $ne: null }
        });

        return {
            status: true,
            code: 200,
            message: "Event sharing status retrieved successfully",
            data: {
                sharing_enabled: event.privacy.visibility !== 'private',
                privacy_settings: event.privacy,
                active_tokens: activeTokensCount,
                total_shares: event.stats?.sharing?.total_shares || 0,
                recent_tokens: recentTokens,
                analytics: {
                    total_participants: totalParticipants,
                    invited_via_tokens: invitedViaTokens,
                    token_conversion_rate: activeTokensCount > 0 ?
                        (invitedViaTokens / activeTokensCount) * 100 : 0
                }
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getEventSharingStatusService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to get event sharing status",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

// ============= TOKEN VALIDATION HELPERS =============

export const validateTokenAccess = async (
    token: string,
    userEmail?: string
): Promise<{ valid: boolean; reason?: string; shareToken?: any }> => {
    try {
        const shareToken = await ShareToken.findOne({
            token,
            revoked: false
        });

        if (!shareToken) {
            return { valid: false, reason: "Token not found or revoked" };
        }

        // Check expiration
        if (shareToken.restrictions.expires_at && shareToken.restrictions.expires_at < new Date()) {
            return { valid: false, reason: "Token has expired" };
        }

        // Check usage limit
        if (shareToken.restrictions.max_uses && shareToken.usage.count >= shareToken.restrictions.max_uses) {
            return { valid: false, reason: "Token usage limit reached" };
        }

        // Check email restrictions
        if (userEmail && shareToken.restrictions.allowed_emails.length > 0) {
            const emailAllowed = shareToken.restrictions.allowed_emails.some(
                allowedEmail => allowedEmail.toLowerCase() === userEmail.toLowerCase()
            );
            if (!emailAllowed) {
                return { valid: false, reason: "Email not authorized" };
            }
        }

        return { valid: true, shareToken };
    } catch (error) {
        logger.error(`[validateTokenAccess] Error: ${error.message}`);
        return { valid: false, reason: "Token validation error" };
    }
};

export const generateShareableLink = (token: string): string => {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `${baseUrl}/join/${token}`;
};

// ============= TOKEN CLEANUP UTILITIES =============

export const cleanupExpiredTokensService = async (): Promise<ServiceResponse<any>> => {
    try {
        const now = new Date();

        // Find expired tokens
        const expiredTokens = await ShareToken.find({
            revoked: false,
            'restrictions.expires_at': { $lt: now }
        });

        if (expiredTokens.length === 0) {
            return {
                status: true,
                code: 200,
                message: "No expired tokens found",
                data: { expired_count: 0 },
                error: null,
                other: null
            };
        }

        // Mark them as revoked
        const cleanupResult = await ShareToken.updateMany(
            {
                revoked: false,
                'restrictions.expires_at': { $lt: now }
            },
            {
                $set: {
                    revoked: true,
                    revoked_at: now,
                    // revoke_reason: "Automatically expired"
                }
            }
        );

        // Update event stats for affected events
        const eventIds = Array.from(new Set(expiredTokens.map(token => token.event_id.toString())));

        for (const eventId of eventIds) {
            const expiredForEvent = expiredTokens.filter(token =>
                token.event_id.toString() === eventId
            ).length;

            await Event.findByIdAndUpdate(
                eventId,
                {
                    $inc: { 'stats.sharing.active_tokens': -expiredForEvent },
                    $set: { updated_at: new Date() }
                }
            );
        }

        logger.info(`[cleanupExpiredTokensService] Cleaned up ${cleanupResult.modifiedCount} expired tokens`);

        return {
            status: true,
            code: 200,
            message: `Successfully cleaned up ${cleanupResult.modifiedCount} expired tokens`,
            data: {
                expired_count: cleanupResult.modifiedCount,
                affected_events: eventIds.length
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[cleanupExpiredTokensService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to cleanup expired tokens",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

// ============= EXPORT FUNCTIONS =============

export const exportTokenUsageService = async (data: {
    eventId: string;
    requesterId: string;
    format: string;
}): Promise<ServiceResponse<string>> => {
    try {
        const { eventId, format } = data;

        // Get tokens with usage data
        const tokens = await ShareToken.find({
            event_id: new mongoose.Types.ObjectId(eventId)
        })
            .populate('created_by', 'name email')
            .sort({ created_at: -1 });

        if (format === 'csv') {
            const csvHeaders = [
                'Token',
                'Type',
                'Name',
                'Created By',
                'Created Date',
                'Usage Count',
                'Max Uses',
                'Expires At',
                'Status',
                'Last Used'
            ];

            let csvContent = csvHeaders.join(',') + '\n';

            tokens.forEach(token => {
                const status = token.revoked ? 'Revoked' :
                    (token.restrictions.expires_at && token.restrictions.expires_at < new Date()) ? 'Expired' : 'Active';

                const row = [
                    `"${token.token}"`,
                    token.token_type,
                    `"${token.created_by || 'Unknown'}"`,
                    token.created_at.toISOString().split('T')[0],
                    token.usage.count,
                    token.restrictions.max_uses || 'Unlimited',
                    token.restrictions.expires_at ? token.restrictions.expires_at.toISOString().split('T')[0] : 'Never',
                    status,
                    token.usage.last_used ? token.usage.last_used.toISOString().split('T')[0] : 'Never'
                ];

                csvContent += row.join(',') + '\n';
            });

            return {
                status: true,
                code: 200,
                message: "Token usage exported successfully",
                data: csvContent,
                error: null,
                other: null
            };
        } else {
            throw new Error("Unsupported export format");
        }
    } catch (error) {
        logger.error(`[exportTokenUsageService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to export token usage",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const createShareTokenService = async (data: {
    eventId: string;
    albumId?: string;
    tokenType: string;
    permissions: any;
    restrictions: any;
    createdBy: string;
    name?: string;
    description?: string;
}): Promise<ServiceResponse<ShareTokenType>> => {
    try {
        const { eventId, albumId, tokenType, permissions, restrictions, createdBy, name, description } = data;

        // Verify event exists
        const event = await Event.findById(eventId);
        if (!event) {
            return {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Generate unique token
        let token: string;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            token = crypto.randomBytes(16).toString('hex');
            const existing = await ShareToken.findOne({ token });
            if (!existing) {
                isUnique = true;
            }
            attempts++;
        }

        if (!isUnique) {
            throw new Error("Failed to generate unique token");
        }

        const shareToken = await ShareToken.create({
            event_id: new mongoose.Types.ObjectId(eventId),
            album_id: albumId ? new mongoose.Types.ObjectId(albumId) : null,
            token,
            token_type: tokenType,
            name: name || `${tokenType} Token`,
            description: description || "",
            permissions: {
                view: permissions?.view ?? true,
                upload: permissions?.upload ?? false,
                download: permissions?.download ?? false,
                share: permissions?.share ?? false,
                comment: permissions?.comment ?? true
            },
            restrictions: {
                max_uses: restrictions?.max_uses || null,
                expires_at: restrictions?.expires_at ? new Date(restrictions.expires_at) : null,
                allowed_emails: restrictions?.allowed_emails || [],
                requires_approval: restrictions?.requires_approval || false
            },
            usage: {
                count: 0,
                used_by: []
            },
            created_by: new mongoose.Types.ObjectId(createdBy),
            revoked: false
        });

        // Update event sharing stats
        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: { 'stats.sharing.active_tokens': 1 },
                $set: { updated_at: new Date() }
            }
        );

        // Log activity
        await ActivityLog.create({
            user_id: new mongoose.Types.ObjectId(createdBy),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "created",
            details: {
                type: "share_token",
                subaction: "token_created",
                token_type: tokenType,
                token_id: shareToken._id,
                permissions,
                name: name || `${tokenType} Token`
            }
        });

        return {
            status: true,
            code: 201,
            message: "Share token created successfully",
            data: shareToken,
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[createShareTokenService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to create share token",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const getShareTokenDetailsService = async (data: {
    tokenId: string;
    requesterId: string;
}): Promise<ServiceResponse<any>> => {
    console.log(data, 'tokentokentoken');
    try {
        const { tokenId } = data;

        const token = await ShareToken.findOne({
            token: tokenId
        }).populate([
            {
                path: 'created_by',
                select: 'name email avatar_url'
            },
            {
                path: 'event_id',
                select: 'title description privacy'
            }
        ]);

        
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
        
        // Get usage analytics
        const participants = await EventParticipant.find({
            share_token_used: new mongoose.Types.ObjectId(token._id)
        }).select('participation.status participation.joined_at guest_info.email created_at');
        
        const analytics = {
            total_uses: token.usage.count,
            successful_joins: participants.filter(p => p.participation.status === 'active').length,
            pending_approvals: participants.filter(p => p.participation.status === 'invited').length,
            recent_users: participants.slice(-5).map(p => ({
                email: p.guest_info.email,
                status: p.participation.status,
                joined_at: p.participation.joined_at || p.created_at
            }))
        };

        return {
            status: true,
            code: 200,
            message: "Share token details retrieved successfully",
            data: {
                token,
                analytics,
                invitation_link: `${process.env.FRONTEND_URL}/join/${token.token}`
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getShareTokenDetailsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to get share token details",
            data: null,
            error: { message: error.message },
            other: null
        };
    }
};

export const updateShareTokenService = async (data: {
    tokenId: string;
    updateData: any;
    updatedBy: string;
    eventId?: string; // Make eventId optional
}): Promise<ServiceResponse<ShareTokenType>> => {
    try {
        const { tokenId, updateData, updatedBy } = data;

        // Find token directly by ID without requiring the event ID
        const token = await ShareToken.findOne({
            _id: new mongoose.Types.ObjectId(tokenId),
            revoked: false
        });

        if (!token) {
            return {
                status: false,
                code: 404,
                message: "Share token not found or already revoked",
                data: null,
                error: null,
                other: null
            };
        }

        // Get eventId from the token itself
        const eventId = token.event_id.toString();

        // Prepare update object
        const update: any = {};

        if (updateData.name !== undefined) {
            update.name = updateData.name;
        }

        if (updateData.description !== undefined) {
            update.description = updateData.description;
        }

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
                changes: Object.keys(updateData),
                updated_fields: update
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
    tokenId: string;
    revokedBy: string;
    reason: string;
    eventId?: string; // Make eventId optional
}): Promise<ServiceResponse<{ revoked: boolean }>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { tokenId, revokedBy, reason } = data;

        // Find token directly by ID without requiring the event ID
        const token = await ShareToken.findOne({
            _id: new mongoose.Types.ObjectId(tokenId),
            revoked: false
        }).session(session);

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

        // Get eventId from the token itself
        const eventId = token.event_id.toString();

        // Update token with all fields
        const tokenUpdate = {
            revoked: true,
            revoked_at: new Date(),
            revoked_by: new mongoose.Types.ObjectId(revokedBy)
        };

        // Update token using findByIdAndUpdate instead of direct property assignment
        await ShareToken.findByIdAndUpdate(
            token._id,
            {
                $set: tokenUpdate
            },
            { session }
        );

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
                usage_count: token.usage.count,
                token_type: token.token_type
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
    tokenId: string;
    requesterId: string;
    period: string;
    metrics: string;
    eventId?: string; // Make eventId optional
}): Promise<ServiceResponse<any>> => {
    try {
        const { tokenId, period } = data;

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

        // Get token details directly by ID
        const token = await ShareToken.findOne({
            _id: new mongoose.Types.ObjectId(tokenId)
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

        // Use the eventId from token
        const eventId = token.event_id.toString();

        // Get participants who used this token
        const participants = await EventParticipant.find({
            share_token_used: new mongoose.Types.ObjectId(tokenId),
            created_at: { $gte: startDate }
        }).select('participation.status participation.joined_at guest_info.email created_at');

        // Get usage analytics
        const analytics = {
            token_info: {
                token: token.token,
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
            restrictions: {
                max_uses: token.restrictions.max_uses,
                expires_at: token.restrictions.expires_at,
                allowed_emails_count: token.restrictions.allowed_emails.length,
                requires_approval: token.restrictions.requires_approval
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

// ============= PUBLIC TOKEN ACCESS SERVICES =============

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

export const joinEventViaTokenService = async (data: {
    token: string;
    guestInfo: {
        email: string;
        name: string;
        avatar_url: string;
        is_anonymous: boolean;
    };
    userId?: string;
}): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { token, guestInfo, userId } = data;

        // Find and validate token
        const shareToken = await ShareToken.findOne({
            token,
            revoked: false
        }).session(session);

        if (!shareToken) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Invalid or expired invitation link",
                data: null,
                error: null,
                other: null
            };
        }

        // Check if token is expired
        if (shareToken.restrictions.expires_at && shareToken.restrictions.expires_at < new Date()) {
            await session.abortTransaction();
            return {
                status: false,
                code: 410,
                message: "This invitation link has expired",
                data: null,
                error: null,
                other: null
            };
        }

        // Check usage limit
        if (shareToken.restrictions.max_uses && shareToken.usage.count >= shareToken.restrictions.max_uses) {
            await session.abortTransaction();
            return {
                status: false,
                code: 410,
                message: "This invitation link has reached its usage limit",
                data: null,
                error: null,
                other: null
            };
        }

        // Check email restrictions
        if (shareToken.restrictions.allowed_emails.length > 0) {
            const emailAllowed = shareToken.restrictions.allowed_emails.some(
                allowedEmail => allowedEmail.toLowerCase() === guestInfo.email.toLowerCase()
            );
            if (!emailAllowed) {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 403,
                    message: "Your email is not authorized to join this event",
                    data: null,
                    error: null,
                    other: null
                };
            }
        }

        // Check if already a participant
        const existingParticipant = await EventParticipant.findOne({
            event_id: shareToken.event_id,
            'identity.email': guestInfo.email.toLowerCase()
        }).session(session);

        if (existingParticipant) {
            if (existingParticipant.participation.status === 'active') {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 409,
                    message: "You are already a member of this event",
                    data: { participant_id: existingParticipant._id },
                    error: null,
                    other: null
                };
            } else if (existingParticipant.participation.status === 'invited') {
                // Update existing invitation to active
                const updatedParticipant = await EventParticipant.findByIdAndUpdate(
                    existingParticipant._id,
                    {
                        $set: {
                            user_id: userId ? new mongoose.Types.ObjectId(userId) : null,
                            'participation.status': 'active',
                            'participation.first_joined_at': new Date(),
                            'participation.invite_accepted_at': new Date(),
                            'participation.last_seen_at': new Date(),
                            updated_at: new Date()
                        }
                    },
                    { new: true, session }
                );

                // Update token usage
                await ShareToken.findByIdAndUpdate(
                    shareToken._id,
                    {
                        $inc: { 'usage.count': 1 },
                        $set: { 'usage.last_used_at': new Date() },
                        $push: { 'usage.used_by': updatedParticipant._id }
                    },
                    { session }
                );

                // Update event stats
                await Event.findByIdAndUpdate(
                    shareToken.event_id,
                    {
                        $inc: {
                            'stats.participants.active': 1,
                            'stats.participants.pending_invites': -1
                        },
                        $set: {
                            updated_at: new Date(),
                            'stats.engagement.last_activity': new Date()
                        }
                    },
                    { session }
                );

                await session.commitTransaction();

                return {
                    status: true,
                    code: 200,
                    message: "Successfully joined the event",
                    data: {
                        participant: updatedParticipant,
                        event_id: shareToken.event_id,
                        redirect_url: `/events/${shareToken.event_id}`
                    },
                    error: null,
                    other: null
                };
            }
        }

        // Create new participant
        const newParticipant = await EventParticipant.create([{
            event_id: shareToken.event_id,
            user_id: userId ? new mongoose.Types.ObjectId(userId) : null,
            identity: {
                email: guestInfo.email.toLowerCase(),
                name: guestInfo.name,
                avatar_url: guestInfo.avatar_url || '',
                is_registered_user: !!userId,
                is_anonymous: guestInfo.is_anonymous || false
            },
            participation: {
                status: shareToken.restrictions.requires_approval ? 'pending' : 'active',
                role: 'guest',
                invited_at: new Date(),
                first_joined_at: new Date(),
                last_seen_at: new Date(),
                total_sessions: 0
            },
            permissions: {
                view: { enabled: shareToken.permissions.view, albums: ['all'] },
                upload: { enabled: shareToken.permissions.upload, albums: ['all'] },
                download: { enabled: shareToken.permissions.download, albums: ['all'] },
                share: { enabled: shareToken.permissions.share },
                moderate: {
                    can_approve_content: false,
                    can_remove_content: false,
                    can_manage_guests: false
                }
            },
            activity: {
                photos_uploaded: 0,
                photos_viewed: 0,
                photos_downloaded: 0,
                comments_made: 0,
                shares_created: 0,
                total_time_spent_minutes: 0,
                favorite_albums: []
            },
            invitation: {
                invitation_method: 'link',
                share_token_used: shareToken._id,
                reminder_count: 0
            },
            preferences: {
                email_notifications: {
                    new_photos: true,
                    comments: false,
                    activity_digest: 'weekly'
                },
                privacy: {
                    show_in_participant_list: true,
                    allow_others_to_tag: true
                }
            },
            created_at: new Date(),
            updated_at: new Date()
        }], { session });

        // Update token usage
        await ShareToken.findByIdAndUpdate(
            shareToken._id,
            {
                $inc: { 'usage.count': 1 },
                $set: { 'usage.last_used_at': new Date() },
                $push: { 'usage.used_by': newParticipant[0]._id }
            },
            { session }
        );

        // Update event stats
        const statsUpdate = shareToken.restrictions.requires_approval ? {
            $inc: { 'stats.participants.pending_invites': 1 }
        } : {
            $inc: {
                'stats.participants.total': 1,
                'stats.participants.active': 1
            }
        };

        await Event.findByIdAndUpdate(
            shareToken.event_id,
            {
                ...statsUpdate,
                $set: {
                    updated_at: new Date(),
                    'stats.engagement.last_activity': new Date()
                }
            },
            { session }
        );

        await session.commitTransaction();

        const message = shareToken.restrictions.requires_approval
            ? "Your request to join has been sent for approval"
            : "Successfully joined the event";

        return {
            status: true,
            code: 201,
            message,
            data: {
                participant: newParticipant[0],
                event_id: shareToken.event_id,
                requires_approval: shareToken.restrictions.requires_approval,
                redirect_url: `/events/${shareToken.event_id}`
            },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[joinEventViaTokenService] Error: ${error.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Internal server error",
            data: null,
            error: error.message,
            other: null
        };
    }
};
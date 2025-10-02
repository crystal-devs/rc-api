// 3. services/event/event-query.service.ts
// Updated to use EventParticipant collection with Redis caching
// ====================================

import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import type { EventFilters, EventType, EventWithExtras } from './event.types';
import { ServiceResponse } from "@services/media";
import { getUserEventStats, recordEventActivity } from "./event-utils.service";
import { eventCacheService } from "@services/cache/event-cache.service";

export const getUserEventsService = async (
    filters: EventFilters
): Promise<ServiceResponse<{ events: EventType[]; pagination: any; stats: any }>> => {
    try {
        const { userId, page, limit, sort, status, privacy, template, search, tags } = filters;

        // Try to get from cache first
        const cachedResult = await eventCacheService.getUserEvents(userId, filters);
        if (cachedResult) {
            logger.debug(`Cache HIT: getUserEventsService for user ${userId}`);
            return {
                status: true,
                code: 200,
                message: "Events fetched successfully (cached)",
                data: cachedResult,
                error: null,
                other: null
            };
        }

        // Build aggregation pipeline starting from EventParticipant collection
        const pipeline: any[] = [
            // Match user's participations (creator, co_host, or other roles)
            {
                $match: {
                    user_id: new mongoose.Types.ObjectId(userId),
                    status: { $in: ['active', 'pending'] },
                    deleted_at: null
                }
            },
            // Lookup the Event details
            {
                $lookup: {
                    from: MODEL_NAMES.EVENT,
                    localField: 'event_id',
                    foreignField: '_id',
                    as: 'event'
                }
            },
            // Unwind event array (should always be 1 item)
            {
                $unwind: {
                    path: '$event',
                    preserveNullAndEmptyArrays: false
                }
            },
            // Add user_role from EventParticipant
            {
                $addFields: {
                    'event.user_role': '$role'
                }
            },
            // Replace root with event document + user_role
            {
                $replaceRoot: {
                    newRoot: '$event'
                }
            }
        ];

        // Apply filters on event fields
        const matchConditions = buildMatchConditions(status, privacy, template, search, tags);
        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }

        // Add sorting
        const sortStage = buildSortStage(sort);
        pipeline.push({ $sort: sortStage });

        // Count total documents
        const countPipeline = [...pipeline, { $count: "total" }];
        const totalResult = await EventParticipant.aggregate(countPipeline);
        const total = totalResult[0]?.total || 0;

        // Add pagination
        pipeline.push(
            { $skip: (page - 1) * limit },
            { $limit: limit }
        );

        // Add enrichment stages
        addEnrichmentStages(pipeline);

        const events = await EventParticipant.aggregate(pipeline);

        // Calculate pagination info
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        // Get user's event stats
        const stats = await getUserEventStats(userId);

        const response: ServiceResponse<{ events: EventType[]; pagination: any; stats: any }> = {
            status: true,
            code: 200,
            message: "Events fetched successfully",
            data: {
                events,
                pagination: {
                    current_page: page,
                    total_pages: totalPages,
                    total_events: total,
                    has_next: hasNextPage,
                    has_previous: hasPrevPage,
                    per_page: limit
                },
                stats
            },
            error: null,
            other: null
        };

        // Cache the result (short TTL handled by service)
        try {
            await eventCacheService.setUserEvents(userId, filters, response.data);
        } catch (e) {
            logger.debug('Failed to cache user events result:', e);
        }

        return response;
    } catch (error) {
        logger.error(`[getUserEventsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to fetch events",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    }
};

export const getEventDetailService = async (
    identifier: string,
    userId: string,
    tokenType?: 'share_token' | 'co_host_invite_token'
): Promise<ServiceResponse<EventWithExtras>> => {
    try {
        // Validate userId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return {
                status: false,
                code: 400,
                message: 'Invalid user ID',
                data: null,
                error: { message: 'Invalid ObjectId format' },
                other: null,
            };
        }

        // Optional cache read when identifier is event ObjectId
        if (mongoose.Types.ObjectId.isValid(identifier)) {
            try {
                const cached = await eventCacheService.getEventDetail(identifier, userId);
                if (cached) {
                    return {
                        status: true,
                        code: 200,
                        message: 'Event details fetched successfully (cached)',
                        data: cached,
                        error: null,
                        other: null,
                    };
                }
            } catch (e) {
                logger.debug('Cache read failed for event detail:', e);
            }
        }

        // Build match condition based on identifier type
        const matchCondition = buildIdentifierMatchCondition(identifier, tokenType);

        const pipeline = buildEventDetailPipeline(matchCondition, userId);
        const result = await Event.aggregate(pipeline);
        const event = result[0];

        if (!event) {
            return {
                status: false,
                code: 404,
                message: 'Event not found or access denied',
                data: null,
                error: null,
                other: null,
            };
        }

        // Record view activity
        await recordEventActivity(event._id.toString(), userId, 'viewed');

        const response: ServiceResponse<EventWithExtras> = {
            status: true,
            code: 200,
            message: 'Event details fetched successfully',
            data: event,
            error: null,
            other: null,
        };

        // Optional cache write when identifier is ObjectId
        if (mongoose.Types.ObjectId.isValid(identifier)) {
            try {
                await eventCacheService.setEventDetail(identifier, userId, event);
            } catch (e) {
                logger.debug('Cache write failed for event detail:', e);
            }
        }

        return response;
    } catch (error) {
        logger.error(`[getEventDetailService] Error: ${(error as Error).message}`);
        return {
            status: false,
            code: 500,
            message: 'Failed to fetch event details',
            data: null,
            error: {
                message: (error as Error).message,
                stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined,
            },
            other: null,
        };
    }
};

// Helper functions
const buildMatchConditions = (
    status: string,
    privacy: string,
    template?: string,
    search?: string,
    tags?: string[]
): any => {
    const matchConditions: any = {};

    // Status filter
    if (status !== 'all') {
        if (status === 'archived') {
            matchConditions.archived_at = { $ne: null };
        } else if (status === 'active') {
            matchConditions.archived_at = null;
        }
    }

    // Privacy filter
    if (privacy !== 'all') {
        matchConditions.visibility = privacy;
    }

    // Template filter
    if (template) {
        matchConditions.template = template;
    }

    // Search filter
    if (search) {
        matchConditions.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    return matchConditions;
};

const buildSortStage = (sort: string): any => {
    const sortStage: any = {};
    if (sort.startsWith('-')) {
        sortStage[sort.substring(1)] = -1;
    } else {
        sortStage[sort] = 1;
    }
    return sortStage;
};

const addEnrichmentStages = (pipeline: any[]): void => {
    pipeline.push(
        // Get all participants count grouped by role
        {
            $lookup: {
                from: MODEL_NAMES.EVENT_PARTICIPANT,
                let: { eventId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$event_id", "$$eventId"] },
                                    { $in: ["$status", ["active", "pending"]] },
                                    { $eq: ["$deleted_at", null] }
                                ]
                            }
                        }
                    },
                    {
                        $group: {
                            _id: "$role",
                            count: { $sum: 1 }
                        }
                    }
                ],
                as: "participant_stats"
            }
        },
        // Get recent activity from EventParticipant
        {
            $lookup: {
                from: MODEL_NAMES.EVENT_PARTICIPANT,
                let: { eventId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$event_id", "$$eventId"] },
                                    { $ne: ["$last_activity_at", null] }
                                ]
                            }
                        }
                    },
                    { $sort: { last_activity_at: -1 } },
                    { $limit: 1 }
                ],
                as: "recent_activity"
            }
        },
        // Add computed fields
        {
            $addFields: {
                participant_count: {
                    $sum: "$participant_stats.count"
                },
                active_participants: {
                    $let: {
                        vars: {
                            activeRole: {
                                $arrayElemAt: [
                                    {
                                        $filter: {
                                            input: "$participant_stats",
                                            cond: { $eq: ["$$this._id", "active"] }
                                        }
                                    },
                                    0
                                ]
                            }
                        },
                        in: { $ifNull: ["$$activeRole.count", 0] }
                    }
                },
                last_activity: {
                    $arrayElemAt: ["$recent_activity.last_activity_at", 0]
                }
            }
        },
        // Remove unnecessary fields
        {
            $project: {
                participant_stats: 0,
                recent_activity: 0
            }
        }
    );
};

const buildIdentifierMatchCondition = (
    identifier: string,
    tokenType?: 'share_token' | 'co_host_invite_token'
): any => {
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        return { _id: new mongoose.Types.ObjectId(identifier) };
    } else if (identifier.startsWith('evt_')) {
        return { share_token: identifier };
    } else {
        // Default to share_token for backward compatibility
        return { share_token: identifier };
    }
};

const buildEventDetailPipeline = (matchCondition: any, userId: string): mongoose.PipelineStage[] => {
    return [
        { $match: matchCondition },

        // Lookup user's participation to determine role
        {
            $lookup: {
                from: MODEL_NAMES.EVENT_PARTICIPANT,
                let: { eventId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$event_id", "$$eventId"] },
                                    { $eq: ["$user_id", new mongoose.Types.ObjectId(userId)] },
                                    { $eq: ["$deleted_at", null] }
                                ]
                            }
                        }
                    }
                ],
                as: "user_participation"
            }
        },

        // Add user_role from participation
        {
            $addFields: {
                user_role: {
                    $ifNull: [
                        { $arrayElemAt: ["$user_participation.role", 0] },
                        "viewer" // Default role if no participation found
                    ]
                },
                user_permissions: {
                    $ifNull: [
                        { $arrayElemAt: ["$user_participation.permissions", 0] },
                        null
                    ]
                }
            }
        },

        // Access control validation
        {
            $match: {
                $or: [
                    // User is creator
                    { created_by: new mongoose.Types.ObjectId(userId) },
                    // User has active/pending participation
                    { "user_participation.0": { $exists: true } },
                    // Event has public visibility with active share settings
                    {
                        $and: [
                            { visibility: "anyone_with_link" },
                            { "share_settings.is_active": true },
                            {
                                $or: [
                                    { "share_settings.expires_at": null },
                                    { "share_settings.expires_at": { $gt: new Date() } }
                                ]
                            }
                        ]
                    }
                ]
            }
        },

        // Lookup creator details
        {
            $lookup: {
                from: MODEL_NAMES.USER,
                localField: "created_by",
                foreignField: "_id",
                as: "creator"
            }
        },

        // Lookup all participants with their details
        {
            $lookup: {
                from: MODEL_NAMES.EVENT_PARTICIPANT,
                let: { eventId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$event_id", "$$eventId"] },
                                    { $in: ["$status", ["active", "pending"]] },
                                    { $eq: ["$deleted_at", null] }
                                ]
                            }
                        }
                    },
                    // Lookup user details for each participant
                    {
                        $lookup: {
                            from: MODEL_NAMES.USER,
                            localField: "user_id",
                            foreignField: "_id",
                            as: "user_details"
                        }
                    },
                    {
                        $unwind: {
                            path: "$user_details",
                            preserveNullAndEmptyArrays: true
                        }
                    },
                    {
                        $project: {
                            user_id: 1,
                            role: 1,
                            status: 1,
                            permissions: 1,
                            joined_at: 1,
                            last_activity_at: 1,
                            "user_details.name": 1,
                            "user_details.email": 1,
                            "user_details.profile_picture": 1
                        }
                    }
                ],
                as: "participants"
            }
        },

        // Add computed stats
        {
            $addFields: {
                "stats.total_participants": { $size: "$participants" },
                "stats.creators_count": {
                    $size: {
                        $filter: {
                            input: "$participants",
                            cond: { $eq: ["$$this.role", "creator"] }
                        }
                    }
                },
                "stats.co_hosts_count": {
                    $size: {
                        $filter: {
                            input: "$participants",
                            cond: { $eq: ["$$this.role", "co_host"] }
                        }
                    }
                },
                "stats.guests_count": {
                    $size: {
                        $filter: {
                            input: "$participants",
                            cond: { $in: ["$$this.role", ["guest", "viewer"]] }
                        }
                    }
                }
            }
        },

        // Format creator
        {
            $addFields: {
                creator: { $arrayElemAt: ["$creator", 0] }
            }
        },

        // Clean up
        {
            $project: {
                user_participation: 0
            }
        }
    ];
};
// 3. services/event/event-query.service.ts
// ====================================

import { Event } from "@models/event.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import type { EventFilters, EventType, EventWithExtras } from './event.types';
import { ServiceResponse } from "@services/media";
import { getUserEventStats, recordEventActivity } from "./event-utils.service";

export const getUserEventsService = async (
    filters: EventFilters
): Promise<ServiceResponse<{ events: EventType[]; pagination: any; stats: any }>> => {
    try {
        const { userId, page, limit, sort, status, privacy, template, search, tags } = filters;

        // Build aggregation pipeline starting from Event collection
        const pipeline: any[] = [
            // Match events where user is creator or approved co-host
            {
                $match: {
                    $or: [
                        { created_by: new mongoose.Types.ObjectId(userId) },
                        {
                            "co_hosts.user_id": new mongoose.Types.ObjectId(userId),
                            "co_hosts.status": "approved"
                        }
                    ]
                }
            },
            // Lookup AccessControl permissions (optional, for additional roles)
            {
                $lookup: {
                    from: MODEL_NAMES.ACCESS_CONTROL,
                    let: { eventId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$resource_id", "$$eventId"] },
                                        { $eq: ["$resource_type", "event"] },
                                        { $eq: ["$user_id", new mongoose.Types.ObjectId(userId)] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "permissions"
                }
            },
            // Add user role
            {
                $addFields: {
                    user_role: {
                        $cond: {
                            if: { $eq: ["$created_by", new mongoose.Types.ObjectId(userId)] },
                            then: "creator",
                            else: {
                                $cond: {
                                    if: {
                                        $and: [
                                            { $in: [new mongoose.Types.ObjectId(userId), "$co_hosts.user_id"] },
                                            {
                                                $eq: [
                                                    {
                                                        $arrayElemAt: [
                                                            "$co_hosts.status",
                                                            {
                                                                $indexOfArray: [
                                                                    "$co_hosts.user_id",
                                                                    new mongoose.Types.ObjectId(userId)
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    "approved"
                                                ]
                                            }
                                        ]
                                    },
                                    then: "co-host",
                                    else: { $arrayElemAt: ["$permissions.role", 0] }
                                }
                            }
                        }
                    }
                }
            }
        ];

        // Apply filters
        const matchConditions = buildMatchConditions(status, privacy, template, search, tags);
        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }

        // Add sorting
        const sortStage = buildSortStage(sort);
        pipeline.push({ $sort: sortStage });

        // Count total documents
        const countPipeline = [...pipeline, { $count: "total" }];
        const totalResult = await Event.aggregate(countPipeline);
        const total = totalResult[0]?.total || 0;

        // Add pagination
        pipeline.push(
            { $skip: (page - 1) * limit },
            { $limit: limit }
        );

        // Add enrichment stages
        addEnrichmentStages(pipeline);

        const events = await Event.aggregate(pipeline);

        // Calculate pagination info
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        // Get user's event stats
        const stats = await getUserEventStats(userId);

        return {
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

        // Handle co-host invite token usage
        if (identifier.startsWith('coh_') && event.user_role === 'co_host_invite') {
            await handleCoHostInviteTokenUsage(event, userId);
        }

        // Record view activity
        await recordEventActivity(event._id.toString(), userId, 'viewed');

        return {
            status: true,
            code: 200,
            message: 'Event details fetched successfully',
            data: event,
            error: null,
            other: null,
        };
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
        matchConditions['privacy.visibility'] = privacy;
    }

    // Template filter
    if (template) {
        matchConditions.template = template;
    }

    // Search filter
    if (search) {
        matchConditions.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { tags: { $in: [new RegExp(search, 'i')] } }
        ];
    }

    // Tags filter
    if (tags && tags.length > 0) {
        matchConditions.tags = { $in: tags };
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
        // Get participant count
        {
            $lookup: {
                from: MODEL_NAMES.EVENT_PARTICIPANT,
                localField: "_id",
                foreignField: "event_id",
                as: "participants"
            }
        },
        // Get recent activity
        {
            $lookup: {
                from: MODEL_NAMES.EVENT_SESSION,
                let: { eventId: "$_id" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$event_id", "$$eventId"] } } },
                    { $sort: { "session.last_activity_at": -1 } },
                    { $limit: 5 }
                ],
                as: "recent_activity"
            }
        },
        // Add computed fields
        {
            $addFields: {
                participant_count: { $size: "$participants" },
                active_participants: {
                    $size: {
                        $filter: {
                            input: "$participants",
                            cond: { $eq: ["$this.participation.status", "active"] }
                        }
                    }
                },
                last_activity: {
                    $max: "$recent_activity.session.last_activity_at"
                }
            }
        },
        // Remove unnecessary fields
        {
            $project: {
                participants: 0,
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
    } else if (identifier.startsWith('coh_')) {
        return { 'co_host_invite_token.token': identifier };
    } else {
        if (tokenType === 'co_host_invite_token') {
            return { 'co_host_invite_token.token': identifier };
        } else {
            return { share_token: identifier };
        }
    }
};

const buildEventDetailPipeline = (matchCondition: any, userId: string): mongoose.PipelineStage[] => {
    return [
        { $match: matchCondition },
        // Token access validation stage
        {
            $addFields: {
                token_access: {
                    $cond: {
                        if: { $ne: ['$share_token', matchCondition.share_token] },
                        then: {
                            $cond: {
                                if: {
                                    $and: [
                                        { $eq: ['$co_host_invite_token.token', matchCondition['co_host_invite_token.token']] },
                                        { $eq: ['$co_host_invite_token.is_active', true] },
                                        { $gt: ['$co_host_invite_token.expires_at', new Date()] },
                                    ],
                                },
                                then: 'co_host_invite',
                                else: 'none',
                            },
                        },
                        else: {
                            $cond: {
                                if: {
                                    $and: [
                                        { $eq: ['$share_settings.is_active', true] },
                                        {
                                            $or: [
                                                { $eq: ['$share_settings.expires_at', null] },
                                                { $gt: ['$share_settings.expires_at', new Date()] },
                                            ],
                                        },
                                    ],
                                },
                                then: 'share_token',
                                else: 'expired',
                            },
                        },
                    },
                },
            },
        },
        // Access control filter
        {
            $match: {
                $or: [
                    { created_by: new mongoose.Types.ObjectId(userId) },
                    { 'co_hosts.user_id': new mongoose.Types.ObjectId(userId) },
                    { token_access: { $in: ['share_token', 'co_host_invite'] } },
                ],
            },
        },
        // Additional enrichment stages would go here...
        // (Creator lookup, co-hosts lookup, albums lookup, etc.)
    ];
};

const handleCoHostInviteTokenUsage = async (event: any, userId: string): Promise<void> => {
    const existingCoHost = event.co_hosts?.find(
        (coHost: any) => coHost.user_id.toString() === userId
    );

    if (!existingCoHost) {
        await Event.findByIdAndUpdate(
            event._id,
            {
                $push: {
                    co_hosts: {
                        user_id: new mongoose.Types.ObjectId(userId),
                        invited_by: event.co_host_invite_token.created_by,
                        status: 'pending',
                        permissions: {
                            manage_content: true,
                            manage_guests: true,
                            manage_settings: true,
                            approve_content: true,
                        },
                        invited_at: new Date(),
                    },
                },
                $inc: {
                    'co_host_invite_token.used_count': 1,
                },
            }
        );

        event.user_role = 'co_host_pending';
    }
};

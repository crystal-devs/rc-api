// services/event.service.ts
import { ActivityLog } from "@models/activity-log.model";
import { Event } from "@models/event.model";
import { User } from "@models/user.model";
import { MODEL_NAMES } from "@models/names";
import { updateUsageForEventCreation, updateUsageForEventDeletion } from "@models/user-usage.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "types/service.types";

// Type aliases for event creation and event type
export type EventCreationData = typeof Event.schema extends mongoose.Schema<infer T> ? Omit<T, '_id'> : never;
export type EventType = typeof Event.schema extends mongoose.Schema<infer T> ? T : never;

// ============= CORE EVENT OPERATIONS =============

export const createEventService = async (
    eventData: Partial<EventType>
): Promise<ServiceResponse<EventType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info(`[createEventService] Creating event: ${eventData.title}`);

        // Ensure created_by is set
        if (!eventData.created_by) {
            logger.error('[createEventService] created_by is undefined');
            throw new Error('created_by is required');
        }

        logger.info(`[createEventService] eventData.created_by = ${eventData.created_by.toString()}`);

        // Create the event
        const event = await Event.create([eventData], { session });
        if (!event[0]?._id) {
            throw new Error('Invalid event creation result');
        }

        const eventId = event[0]._id;
        const creatorId = eventData.created_by;

        // Create activity log
        await ActivityLog.create(
            [
                {
                    user_id: creatorId,
                    resource_id: eventId,
                    resource_type: 'event',
                    action: 'created',
                    details: {
                        event_title: eventData.title,
                        template: eventData.template,
                        visibility: event[0].visibility, // Use created event's visibility (default: 'private')
                    },
                },
            ],
            { session }
        );

        // Update user usage statistics
        await updateUsageForEventCreation(creatorId.toString(), eventId.toString(), session);

        await session.commitTransaction();
        logger.info(`[createEventService] Successfully created event: ${eventId}`);

        return {
            status: true,
            code: 201,
            message: 'Event created successfully',
            data: event[0] as EventType,
            error: null,
            other: null,
        };
    } catch (error) {
        logger.error(`[createEventService] Error: ${error.message}`);
        await session.abortTransaction();

        return {
            status: false,
            code: 500,
            message: 'Failed to create event',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            },
            other: null,
        };
    } finally {
        await session.endSession();
    }
};



export const getUserEventsService = async (filters: {
    userId: string;
    page: number;
    limit: number;
    sort: string;
    status: string;
    privacy: string;
    template?: string;
    search?: string;
    tags?: string[];
}): Promise<ServiceResponse<{ events: EventType[]; pagination: any; stats: any }>> => {
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
                                    else: { $arrayElemAt: ["$permissions.role", 0] } // Fallback to AccessControl role or null
                                }
                            }
                        }
                    }
                }
            }
        ];

        // Apply filters
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

        // Add match stage if we have conditions
        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }

        // Add sorting
        const sortStage: any = {};
        if (sort.startsWith('-')) {
            sortStage[sort.substring(1)] = -1;
        } else {
            sortStage[sort] = 1;
        }
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

        // Lookup additional data for each event
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

        const events = await Event.aggregate(pipeline);

        // Calculate pagination info
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        // Get user's event stats
        const statsPromise = getUserEventStats(userId);
        const stats = await statsPromise;

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
    identifier: string, // Can be eventId, share_token, or co_host_invite_token
    userId: string,
    tokenType?: 'share_token' | 'co_host_invite_token' // Optional hint about token type
): Promise<ServiceResponse<EventType & { user_role?: string; user_permissions?: Record<string, boolean> | null }>> => {
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
        let matchCondition: any;

        if (mongoose.Types.ObjectId.isValid(identifier)) {
            // It's a valid ObjectId, treat as eventId
            matchCondition = { _id: new mongoose.Types.ObjectId(identifier) };
        } else if (identifier.startsWith('evt_')) {
            // It's a share token
            matchCondition = { share_token: identifier };
        } else if (identifier.startsWith('coh_')) {
            // It's a co-host invite token
            matchCondition = { 'co_host_invite_token.token': identifier };
        } else {
            // Try to determine by tokenType hint or default to share_token
            if (tokenType === 'co_host_invite_token') {
                matchCondition = { 'co_host_invite_token.token': identifier };
            } else {
                matchCondition = { share_token: identifier };
            }
        }

        const pipeline: mongoose.PipelineStage[] = [
            { $match: matchCondition },

            // Check token validity and access permissions
            {
                $addFields: {
                    token_access: {
                        $cond: {
                            if: { $ne: ['$share_token', identifier] },
                            then: {
                                // Check co-host invite token
                                $cond: {
                                    if: {
                                        $and: [
                                            { $eq: ['$co_host_invite_token.token', identifier] },
                                            { $eq: ['$co_host_invite_token.is_active', true] },
                                            { $gt: ['$co_host_invite_token.expires_at', new Date()] },
                                        ],
                                    },
                                    then: 'co_host_invite',
                                    else: 'none',
                                },
                            },
                            else: {
                                // Check share token access
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

            // Filter out events with invalid token access (unless user is owner/co-host)
            {
                $match: {
                    $or: [
                        { created_by: new mongoose.Types.ObjectId(userId) }, // Owner access
                        { 'co_hosts.user_id': new mongoose.Types.ObjectId(userId) }, // Co-host access
                        { token_access: { $in: ['share_token', 'co_host_invite'] } }, // Valid token access
                    ],
                },
            },

            // Get creator details
            {
                $lookup: {
                    from: MODEL_NAMES.USER,
                    localField: 'created_by',
                    foreignField: '_id',
                    as: 'creator_info',
                    pipeline: [{ $project: { name: 1, email: 1, avatar_url: 1 } }],
                },
            },

            // Get co-hosts details (only approved ones for non-owners)
            {
                $lookup: {
                    from: MODEL_NAMES.USER,
                    let: {
                        coHostUserIds: '$co_hosts.user_id',
                        isOwner: { $eq: ['$created_by', new mongoose.Types.ObjectId(userId)] }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $in: ['$_id', '$$coHostUserIds'] }
                            }
                        },
                        { $project: { name: 1, email: 1, avatar_url: 1 } }
                    ],
                    as: 'co_hosts_info',
                },
            },



            // Get albums (respect privacy settings)
            {
                $lookup: {
                    from: MODEL_NAMES.ALBUM,
                    let: {
                        eventId: '$_id',
                        isOwnerOrCoHost: {
                            $or: [
                                { $eq: ['$created_by', new mongoose.Types.ObjectId(userId)] },
                                {
                                    $and: [
                                        { $in: [new mongoose.Types.ObjectId(userId), '$co_hosts.user_id'] },
                                        {
                                            $eq: [
                                                {
                                                    $arrayElemAt: [
                                                        '$co_hosts.status',
                                                        {
                                                            $indexOfArray: [
                                                                '$co_hosts.user_id',
                                                                new mongoose.Types.ObjectId(userId),
                                                            ],
                                                        },
                                                    ],
                                                },
                                                'approved',
                                            ],
                                        },
                                    ],
                                },
                            ],
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$event_id', '$$eventId'] },
                                        {
                                            $or: [
                                                '$$isOwnerOrCoHost', // Owner/co-host can see all albums
                                                { $eq: ['$is_private', false] }, // Others can see public albums
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                        {
                            $project: {
                                name: 1,
                                description: 1,
                                cover_photo: 1,
                                photo_count: 1,
                                created_at: 1,
                            },
                        },
                        { $sort: { created_at: 1 } },
                    ],
                    as: 'albums_detail',
                },
            },

            // Format the response with proper role and permissions
            {
                $addFields: {
                    creator: { $arrayElemAt: ['$creator_info', 0] },
                    co_hosts: {
                        $map: {
                            input: {
                                $filter: {
                                    input: {
                                        $zip: {
                                            inputs: ['$co_hosts', '$co_hosts_info'],
                                        },
                                    },
                                    cond: {
                                        $or: [
                                            { $eq: ['$created_by', new mongoose.Types.ObjectId(userId)] }, // Owner sees all
                                            {
                                                $eq: [
                                                    { $getField: { field: 'status', input: { $arrayElemAt: ['$this', 0] } } },
                                                    'approved'
                                                ]
                                            }, // Others see only approved
                                        ],
                                    },
                                },
                            },
                            as: 'coHostPair',
                            in: {
                                $mergeObjects: [
                                    { $arrayElemAt: ['$coHostPair', 0] }, // co-host data
                                    { $arrayElemAt: ['$coHostPair', 1] }, // user info
                                ],
                            },
                        },
                    },
                    albums: '$albums_detail',

                    // Determine user role based on new logic
                    user_role: {
                        $cond: {
                            if: { $eq: ['$created_by', new mongoose.Types.ObjectId(userId)] },
                            then: 'owner',
                            else: {
                                $cond: {
                                    if: {
                                        $and: [
                                            {
                                                $in: [
                                                    new mongoose.Types.ObjectId(userId),
                                                    '$co_hosts.user_id',
                                                ],
                                            },
                                            {
                                                $eq: [
                                                    {
                                                        $arrayElemAt: [
                                                            '$co_hosts.status',
                                                            {
                                                                $indexOfArray: [
                                                                    '$co_hosts.user_id',
                                                                    new mongoose.Types.ObjectId(userId),
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                    'approved',
                                                ],
                                            },
                                        ],
                                    },
                                    then: 'co_host',
                                    else: {
                                        $cond: {
                                            if: { $eq: ['$token_access', 'co_host_invite'] },
                                            then: 'co_host_invite',
                                            else: {
                                                $cond: {
                                                    if: { $eq: ['$token_access', 'share_token'] },
                                                    then: 'participant',
                                                    else: 'guest',
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },

                    // Set user permissions based on role and event permissions
                    user_permissions: {
                        $cond: {
                            if: { $eq: ['$created_by', new mongoose.Types.ObjectId(userId)] },
                            then: {
                                manage_content: true,
                                manage_guests: true,
                                manage_settings: true,
                                approve_content: true,
                                can_view: true,
                                can_upload: true,
                                can_download: true,
                            },
                            else: {
                                $cond: {
                                    if: {
                                        $and: [
                                            {
                                                $in: [
                                                    new mongoose.Types.ObjectId(userId),
                                                    '$co_hosts.user_id',
                                                ],
                                            },
                                            {
                                                $eq: [
                                                    {
                                                        $arrayElemAt: [
                                                            '$co_hosts.status',
                                                            {
                                                                $indexOfArray: [
                                                                    '$co_hosts.user_id',
                                                                    new mongoose.Types.ObjectId(userId),
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                    'approved',
                                                ],
                                            },
                                        ],
                                    },
                                    then: {
                                        $mergeObjects: [
                                            {
                                                $arrayElemAt: [
                                                    '$co_hosts.permissions',
                                                    {
                                                        $indexOfArray: [
                                                            '$co_hosts.user_id',
                                                            new mongoose.Types.ObjectId(userId),
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                can_view: true,
                                                can_upload: true,
                                                can_download: true,
                                            },
                                        ],
                                    },
                                    else: {
                                        $cond: {
                                            if: { $eq: ['$token_access', 'co_host_invite'] },
                                            then: {
                                                manage_content: false,
                                                manage_guests: false,
                                                manage_settings: false,
                                                approve_content: false,
                                                can_view: true,
                                                can_upload: false,
                                                can_download: false,
                                            },
                                            else: '$permissions', // Use event's default permissions for participants
                                        },
                                    },
                                },
                            },
                        },
                    },

                    // Participant statistics
                    participants_stats: {
                        $arrayToObject: {
                            $map: {
                                input: '$participants_summary',
                                as: 'stat',
                                in: {
                                    k: '$$stat._id',
                                    v: '$$stat.count',
                                },
                            },
                        },
                    },

                    // Recent joiners (only non-null entries)
                    recent_joiners: {
                        $reduce: {
                            input: '$participants_summary.recent_participants',
                            initialValue: [],
                            in: {
                                $concatArrays: [
                                    '$$value',
                                    {
                                        $filter: {
                                            input: ['$$this'],
                                            cond: { $ne: ['$$this', null] },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },

            // Clean up temporary fields
            {
                $project: {
                    creator_info: 0,
                    co_hosts_info: 0,
                    albums_detail: 0,
                    participants_summary: 0,
                    token_access: 0,
                },
            },
        ];

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
            // Check if user is already a co-host
            const existingCoHost = event.co_hosts?.find(
                (coHost: any) => coHost.user_id.toString() === userId
            );

            if (!existingCoHost) {
                // Add user as pending co-host
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

                // Update user role to reflect pending status
                event.user_role = 'co_host_pending';
            }
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

export const deleteEventService = async (
    eventId: string,
    userId: string
): Promise<ServiceResponse<{ deleted: boolean }>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info(`[deleteEventService] Starting deletion for event: ${eventId} by user: ${userId}`);

        // Check if event exists
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

        // Delete event and related data
        await Promise.all([
            // Delete the event
            Event.findOneAndDelete({ _id: new mongoose.Types.ObjectId(eventId) }, { session }),
        ]);

        // Log deletion activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(userId),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "deleted",
            details: {
                event_title: event.title,
                deleted_at: new Date()
            }
        }], { session });

        // Update user usage statistics
        await updateUsageForEventDeletion(userId, eventId, session);

        await session.commitTransaction();
        logger.info(`[deleteEventService] Successfully deleted event: ${eventId}`);

        return {
            status: true,
            code: 200,
            message: "Event deleted successfully",
            data: { deleted: true },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[deleteEventService] Error: ${error.message}`);
        await session.abortTransaction();

        return {
            status: false,
            code: 500,
            message: "Failed to delete event",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

// ============= UTILITY FUNCTIONS =============

export const generateUniqueSlug = async (baseSlug: string): Promise<string> => {
    let slug = baseSlug;
    let counter = 1;

    while (await Event.exists({ slug })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
    }

    return slug;
};

export const processLocationData = (
    location: any
): { name: string; address: string; coordinates: number[] } => {
    const defaultCoordinates: number[] = [];

    const defaultObj = {
        name: '',
        address: '',
        coordinates: defaultCoordinates,
    };

    if (!location) return defaultObj;

    if (typeof location === 'string') {
        return {
            name: location,
            address: '',
            coordinates: [],
        };
    }

    return {
        name: location.name || '',
        address: location.address || '',
        coordinates: Array.isArray(location.coordinates) ? location.coordinates : [],
    };
};

const processCoverImageData = (coverImageData: any): any => {
    if (!coverImageData || typeof coverImageData !== 'object') {
        return { url: '', public_id: '', uploaded_by: null, thumbnail_url: '' };
    }

    // Validate URL if provided
    if (coverImageData.url && typeof coverImageData.url !== 'string') {
        throw new Error('Cover image URL must be a string');
    }

    return {
        url: coverImageData.url?.trim() || '',
        public_id: coverImageData.public_id?.trim() || '',
        uploaded_by: coverImageData.uploaded_by || null,
        thumbnail_url: coverImageData.thumbnail_url?.trim() || ''
    };
};

const processPermissionsData = (permissionsData: any): any => {
    if (!permissionsData || typeof permissionsData !== 'object') {
        throw new Error('Invalid permissions data');
    }

    const processed: any = {};

    if (permissionsData.can_view !== undefined) {
        processed.can_view = Boolean(permissionsData.can_view);
    }
    if (permissionsData.can_upload !== undefined) {
        processed.can_upload = Boolean(permissionsData.can_upload);
    }
    if (permissionsData.can_download !== undefined) {
        processed.can_download = Boolean(permissionsData.can_download);
    }
    if (permissionsData.require_approval !== undefined) {
        processed.require_approval = Boolean(permissionsData.require_approval);
    }

    if (permissionsData.allowed_media_types !== undefined) {
        if (typeof permissionsData.allowed_media_types !== 'object') {
            throw new Error('Invalid allowed_media_types format');
        }
        processed.allowed_media_types = {
            images: Boolean(permissionsData.allowed_media_types.images),
            videos: Boolean(permissionsData.allowed_media_types.videos)
        };
    }

    return processed;
};

const processShareSettingsData = (shareSettingsData: any): any => {
    if (!shareSettingsData || typeof shareSettingsData !== 'object') {
        return { is_active: true, password: null, expires_at: null };
    }

    const processed: any = {};

    if (shareSettingsData.is_active !== undefined) {
        processed.is_active = Boolean(shareSettingsData.is_active);
    }

    if (shareSettingsData.password !== undefined) {
        processed.password = shareSettingsData.password ? shareSettingsData.password.trim() : null;
    }

    if (shareSettingsData.expires_at !== undefined) {
        if (shareSettingsData.expires_at) {
            const expiresDate = new Date(shareSettingsData.expires_at);
            if (isNaN(expiresDate.getTime())) {
                throw new Error('Invalid expires_at date format');
            }
            if (expiresDate <= new Date()) {
                throw new Error('Expiration date must be in the future');
            }
            processed.expires_at = expiresDate;
        } else {
            processed.expires_at = null;
        }
    }

    return processed;
};

const processCoHostInviteTokenData = (tokenData: any): any => {
    if (!tokenData || typeof tokenData !== 'object') {
        throw new Error('Invalid co-host invite token data');
    }

    const processed: any = {};

    // Usually token shouldn't be manually updated, but including for completeness
    if (tokenData.token !== undefined) {
        if (tokenData.token && !/^coh_[a-zA-Z0-9]{24}_[a-zA-Z0-9]{6}$/.test(tokenData.token)) {
            throw new Error('Invalid co-host invite token format');
        }
        processed.token = tokenData.token;
    }

    if (tokenData.expires_at !== undefined) {
        if (tokenData.expires_at) {
            const expiresDate = new Date(tokenData.expires_at);
            if (isNaN(expiresDate.getTime())) {
                throw new Error('Invalid token expires_at date format');
            }
            processed.expires_at = expiresDate;
        }
    }

    if (tokenData.is_active !== undefined) {
        processed.is_active = Boolean(tokenData.is_active);
    }

    if (tokenData.max_uses !== undefined) {
        const maxUses = Number(tokenData.max_uses);
        if (isNaN(maxUses) || maxUses < 1) {
            throw new Error('max_uses must be a positive number');
        }
        processed.max_uses = maxUses;
    }

    return processed;
};

export const validateCoHosts = async (coHosts: string[]): Promise<mongoose.Types.ObjectId[]> => {
    if (!Array.isArray(coHosts) || coHosts.length === 0) {
        return [];
    }

    const validObjectIds = coHosts
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

    // Verify users exist
    const existingUsers = await User.find({
        _id: { $in: validObjectIds }
    }).select('_id');

    return existingUsers.map(user => user._id);
};

export const addCreatorAsParticipant = async (
    eventId: string,
    userId: string,
    session?: mongoose.ClientSession
): Promise<void> => {
    try {
        await Event.updateOne(
            { _id: new mongoose.Types.ObjectId(eventId) },
            { $inc: { 'stats.participants': 1 } },
            { session }
        );
    } catch (error) {
        logger.error(`[addCreatorAsParticipant] Error: ${error.message}`);
        throw error;
    }
};

export const checkUpdatePermission = async (eventId: string, userId: string): Promise<boolean> => {
    try {
        const event = await Event.findById(eventId);

        if (!event) {
            return false;
        }

        // Check if user is the event owner (created_by)
        if (event.created_by && event.created_by.toString() === userId) {
            return true;
        }

        // Check if user is an approved co-host
        const isCoHost = event.co_hosts.some(coHost =>
            coHost.user_id.toString() === userId &&
            coHost.status === 'approved'
        );

        return isCoHost;
    } catch (error) {
        console.error('Error checking update permission:', error);
        return false;
    }
};

export const processEventUpdateData = async (
    updateData: any,
    currentEvent: any
): Promise<Record<string, any>> => {
    const processed: Record<string, any> = {};

    try {
        // Basic event information
        if (updateData.title !== undefined) {
            if (!updateData.title || typeof updateData.title !== 'string' || !updateData.title.trim()) {
                throw new Error('Title is required and must be a valid string');
            }
            if (updateData.title.length > 100) {
                throw new Error('Title must be less than 100 characters');
            }
            processed.title = updateData.title.trim();
        }

        if (updateData.description !== undefined) {
            if (updateData.description && updateData.description.length > 1000) {
                throw new Error('Description must be less than 1000 characters');
            }
            processed.description = updateData.description?.trim() || '';
        }

        if (updateData.template !== undefined) {
            const validTemplates = ['wedding', 'birthday', 'concert', 'corporate', 'vacation', 'custom'];
            if (!validTemplates.includes(updateData.template)) {
                throw new Error('Invalid template type');
            }
            processed.template = updateData.template;
        }

        // Date handling
        if (updateData.start_date !== undefined) {
            if (updateData.start_date) {
                const startDate = new Date(updateData.start_date);
                if (isNaN(startDate.getTime())) {
                    throw new Error('Invalid start date format');
                }
                processed.start_date = startDate;
            }
        }

        if (updateData.end_date !== undefined) {
            if (updateData.end_date) {
                const endDate = new Date(updateData.end_date);
                if (isNaN(endDate.getTime())) {
                    throw new Error('Invalid end date format');
                }
                processed.end_date = endDate;
            } else {
                // Explicitly set to null if provided as null
                processed.end_date = null;
            }
        }

        // Validate date logic if both dates are being updated
        const finalStartDate = processed.start_date || currentEvent.start_date;
        const finalEndDate = processed.end_date !== undefined ? processed.end_date : currentEvent.end_date;

        if (finalStartDate && finalEndDate && finalStartDate >= finalEndDate) {
            throw new Error('End date must be after start date');
        }

        // Location handling
        if (updateData.location !== undefined) {
            processed.location = processLocationData(updateData.location);
        }

        // Cover image handling
        if (updateData.cover_image !== undefined) {
            processed.cover_image = processCoverImageData(updateData.cover_image);
        }

        // Visibility and permissions
        if (updateData.visibility !== undefined) {
            const validVisibility = ['anyone_with_link', 'invited_only', 'private'];
            if (!validVisibility.includes(updateData.visibility)) {
                throw new Error('Invalid visibility type');
            }
            processed.visibility = updateData.visibility;
        }

        if (updateData.permissions !== undefined) {
            processed.permissions = processPermissionsData(updateData.permissions);
        }

        // Share settings
        if (updateData.share_settings !== undefined) {
            processed.share_settings = processShareSettingsData(updateData.share_settings);
        }

        // Share token (usually shouldn't be updated manually, but including for completeness)
        if (updateData.share_token !== undefined && updateData.share_token !== currentEvent.share_token) {
            // Validate share token format
            if (updateData.share_token && !/^evt_[a-zA-Z0-9]{6}$/.test(updateData.share_token)) {
                throw new Error('Invalid share token format');
            }
            processed.share_token = updateData.share_token;
        }

        // Co-host invite token handling (usually shouldn't be updated manually)
        if (updateData.co_host_invite_token !== undefined) {
            processed.co_host_invite_token = processCoHostInviteTokenData(updateData.co_host_invite_token);
        }

        // Always update the timestamp
        processed.updated_at = new Date();

        return processed;
    } catch (error: any) {
        throw new Error(`Data processing failed: ${error.message}`);
    }
};

const processGuestPermissions = (permissions: any): any => {
    return {
        view: Boolean(permissions.view ?? true),
        upload: Boolean(permissions.upload ?? false),
        download: Boolean(permissions.download ?? false),
        comment: Boolean(permissions.comment ?? true),
        share: Boolean(permissions.share ?? false),
        create_albums: Boolean(permissions.create_albums ?? false)
    };
};

// Handle visibility transitions
export const handleVisibilityTransition = async (
    eventId: string,
    oldVisibility: string,
    newVisibility: string,
    userId: string
): Promise<any> => {
    const event = await Event.findById(eventId);
    if (!event) {
        throw new Error('Event not found');
    }

    const result = {
        from: oldVisibility,
        to: newVisibility,
        anonymous_users_affected: 0,
        actions_taken: [] as any
    };

    // Handle transitions involving anonymous users
    // if (oldVisibility === 'unlisted' && (newVisibility === 'private' || newVisibility === 'restricted')) {
    //     const anonymousCount = event.anonymous_sessions.length;
    //     result.anonymous_users_affected = anonymousCount;

    //     if (anonymousCount > 0) {
    //         const policy = event.privacy.guest_management.anonymous_transition_policy;
    //         const graceHours = event.privacy.guest_management.grace_period_hours;

    //         switch (policy) {
    //             case 'block_all':
    //                 // Expire all sessions immediately
    //                 await Event.updateOne(
    //                     { _id: eventId },
    //                     {
    //                         $set: {
    //                             'anonymous_sessions.$[].grace_period_expires': new Date()
    //                         }
    //                     }
    //                 );
    //                 result.actions_taken.push('All anonymous users blocked immediately');
    //                 break;

    //             case 'grace_period':
    //                 // Set grace period for all sessions
    //                 const graceExpiry = new Date(Date.now() + (graceHours * 60 * 60 * 1000));
    //                 await Event.updateOne(
    //                     { _id: eventId },
    //                     {
    //                         $set: {
    //                             'anonymous_sessions.$[elem].grace_period_expires': graceExpiry
    //                         }
    //                     },
    //                     {
    //                         arrayFilters: [{ 'elem.grace_period_expires': { $exists: false } }]
    //                     }
    //                 );
    //                 result.actions_taken.push(`${graceHours}h grace period set for ${anonymousCount} anonymous users`);
    //                 break;

    //             case 'force_login':
    //                 // Set 1 hour grace period and mark for notification
    //                 const loginExpiry = new Date(Date.now() + (1 * 60 * 60 * 1000));
    //                 await Event.updateOne(
    //                     { _id: eventId },
    //                     {
    //                         $set: {
    //                             'anonymous_sessions.$[].grace_period_expires': loginExpiry,
    //                             'anonymous_sessions.$[].transition_notified': true
    //                         }
    //                     }
    //                 );
    //                 result.actions_taken.push(`Force login notification sent to ${anonymousCount} anonymous users`);
    //                 break;
    //         }

    //         // Update stats
    //         await Event.updateOne(
    //             { _id: eventId },
    //             {
    //                 $set: {
    //                     'privacy.previous_visibility': oldVisibility,
    //                     'privacy.visibility_changed_at': new Date()
    //                 }
    //             }
    //         );
    //     }
    // }

    // Handle other transition scenarios
    // if (newVisibility === 'unlisted' && oldVisibility !== 'unlisted') {
    //     result.actions_taken.push('Event is now accessible via link without login');
    // }

    // if (newVisibility === 'restricted' && oldVisibility !== 'restricted') {
    //     result.actions_taken.push('Event now requires approval for new guests');
    // }

    // if (newVisibility === 'private' && oldVisibility !== 'private') {
    //     result.actions_taken.push('Event is now invitation-only');
    // }

    return result;
};

// Update the main service method
export const updateEventService = async (
    eventId: string,
    updateData: any,
    userId: string
): Promise<any> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            { $set: updateData },
            {
                new: true,
                runValidators: true,
                session
            }
        ).populate('created_by', 'name email avatar')
            .populate('co_hosts.user_id', 'name email avatar');

        if (!updatedEvent) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: 'Event not found',
                data: null,
                error: null,
                other: null
            };
        }

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: 'Event updated successfully',
            data: updatedEvent,
            error: null,
            other: null
        };
    } catch (error: any) {
        await session.abortTransaction();
        console.error('Error in updateEventService:', error);

        return {
            status: false,
            code: 500,
            message: error.message || 'Failed to update event',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const getUserEventStats = async (userId: string) => {
    try {
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // Get owned events
        const ownedEvents = await Event.find({ created_by: userObjectId });

        // Get co-hosted events (approved only)
        const coHostedEvents = await Event.find({
            created_by: { $ne: userObjectId },
            "co_hosts.user_id": userObjectId,
            "co_hosts.status": "approved"
        });

        const allUserEvents = [...ownedEvents, ...coHostedEvents];

        const stats = {
            total_events: allUserEvents.length,
            active_events: allUserEvents.filter(event => !event.archived_at).length,
            archived_events: allUserEvents.filter(event => event.archived_at).length,
            owned_events: ownedEvents.length,
            co_hosted_events: coHostedEvents.length
        };

        return stats;
    } catch (error) {
        console.error('Error getting user event stats:', error);
        return {
            total_events: 0,
            active_events: 0,
            archived_events: 0,
            owned_events: 0,
            co_hosted_events: 0
        };
    }
};

export const recordEventActivity = async (eventId: string, userId: string, action: string, additionalDetails: any = {}) => {
    try {
        await ActivityLog.create({
            user_id: new mongoose.Types.ObjectId(userId),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action,
            details: {
                timestamp: new Date(),
                ...additionalDetails
            }
        });
    } catch (error) {
        logger.error(`[recordEventActivity] Error: ${error.message}`);
    }
};


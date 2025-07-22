// services/event.service.ts
import { AccessControl } from "@models/access.model";
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

        // Create access control for owner
        await AccessControl.create(
            [
                {
                    resource_id: eventId,
                    resource_type: 'event',
                    permissions: [{ user_id: creatorId, role: 'owner' }],
                },
            ],
            { session }
        );

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

        // Check if user is owner
        const accessControl = await AccessControl.findOne({
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            "permissions.user_id": new mongoose.Types.ObjectId(userId),
            "permissions.role": "owner"
        }).session(session);

        if (!accessControl) {
            await session.abortTransaction();
            return {
                status: false,
                code: 403,
                message: "You don't have permission to delete this event",
                data: null,
                error: null,
                other: null
            };
        }

        // Delete event and related data
        await Promise.all([
            // Delete the event
            Event.findOneAndDelete({ _id: new mongoose.Types.ObjectId(eventId) }, { session }),

            // Delete access controls
            AccessControl.deleteMany({
                resource_id: new mongoose.Types.ObjectId(eventId),
                resource_type: "event"
            }, { session }),
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


export const processCoverImageData = (
    coverImage: any,
    userId: string
): { url: string; public_id: string; uploaded_by: mongoose.Types.ObjectId } => {
    const defaultObj = {
        url: '',
        public_id: '',
        uploaded_by: new mongoose.Types.ObjectId(userId),
    };

    if (!coverImage) return defaultObj;

    if (typeof coverImage === 'string') {
        return {
            url: coverImage,
            public_id: '',
            uploaded_by: new mongoose.Types.ObjectId(userId),
        };
    }

    return {
        url: coverImage.url || '',
        public_id: coverImage.public_id || '',
        uploaded_by: new mongoose.Types.ObjectId(userId),
    };
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

export const checkEventAccess = async (eventId: string, userId: string): Promise<boolean> => {
    const access = await AccessControl.findOne({
        resource_id: new mongoose.Types.ObjectId(eventId),
        resource_type: "event",
        "permissions.user_id": new mongoose.Types.ObjectId(userId)
    });

    return !!access;
};

export const checkUpdatePermission = async (eventId: string, userId: string): Promise<boolean> => {
    const access = await AccessControl.findOne({
        resource_id: new mongoose.Types.ObjectId(eventId),
        resource_type: "event",
        "permissions.user_id": new mongoose.Types.ObjectId(userId),
        "permissions.role": { $in: ["owner", "co_host"] }
    });

    return !!access;
};

export const processEventUpdateData = async (
    updateData: any,
    processFields: string[] = [
        'title',
        'description',
        'start_date',
        'end_date',
        'location',
        'visibility',
        'default_guest_permissions'
    ]
): Promise<Record<string, any>> => {
    const processed: Record<string, any> = {};

    // Process specified fields
    if (processFields.includes('title') && updateData.title) {
        if (typeof updateData.title !== 'string' || !updateData.title.trim()) {
            throw new Error('Invalid title');
        }
        if (updateData.title.length > 100) {
            throw new Error('Title must be less than 100 characters');
        }
        processed.title = updateData.title.trim();
    }

    if (processFields.includes('description') && updateData.description !== undefined) {
        if (updateData.description && updateData.description.length > 1000) {
            throw new Error('Description must be less than 1000 characters');
        }
        processed.description = updateData.description?.trim() || '';
    }

    if (processFields.includes('start_date') && updateData.start_date) {
        const startDate = new Date(updateData.start_date);
        if (isNaN(startDate.getTime())) throw new Error('Invalid start date');
        processed.start_date = startDate;
    }

    if (processFields.includes('end_date') && updateData.end_date) {
        const endDate = new Date(updateData.end_date);
        if (isNaN(endDate.getTime())) throw new Error('Invalid end date');
        processed.end_date = endDate;
    }

    // Validate date logic
    if (processed.start_date && processed.end_date && processed.start_date >= processed.end_date) {
        throw new Error('End date must be after start date');
    }

    if (processFields.includes('location') && updateData.location) {
        processed.location = processLocationData(updateData.location);
    }

    if (processFields.includes('visibility') && updateData.visibility) {
        processed.visibility = updateData.visibility;
    }

    if (processFields.includes('default_guest_permissions') && updateData.default_guest_permissions) {
        processed.default_guest_permissions = processGuestPermissions(updateData.default_guest_permissions);
    }

    // Always update the updated_at timestamp
    processed.updated_at = new Date();

    return processed;
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
    try {
        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            { $set: updateData },
            {
                new: true,
                runValidators: true
            }
        ).populate('created_by', 'name email avatar')
            .populate('co_hosts.user_id', 'name email avatar');

        if (!updatedEvent) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        return {
            status: true,
            message: 'Event updated successfully',
            data: updatedEvent
        };
    } catch (error) {
        return {
            status: false,
            message: error.message || 'Failed to update event',
            data: null
        };
    }
};

export const getUserEventStats = async (userId: string) => {
    const stats = await AccessControl.aggregate([
        {
            $match: {
                "permissions.user_id": new mongoose.Types.ObjectId(userId),
                resource_type: "event"
            }
        },
        {
            $lookup: {
                from: MODEL_NAMES.EVENT,
                localField: "resource_id",
                foreignField: "_id",
                as: "event"
            }
        },
        { $unwind: "$event" },
        {
            $group: {
                _id: null,
                total_events: { $sum: 1 },
                active_events: {
                    $sum: {
                        $cond: [{ $eq: ["$event.archived_at", null] }, 1, 0]
                    }
                },
                archived_events: {
                    $sum: {
                        $cond: [{ $ne: ["$event.archived_at", null] }, 1, 0]
                    }
                },
                owned_events: {
                    $sum: {
                        $cond: [
                            {
                                $in: ["owner", "$permissions.role"]
                            },
                            1,
                            0
                        ]
                    }
                },
                co_hosted_events: {
                    $sum: {
                        $cond: [
                            {
                                $in: ["co_host", "$permissions.role"]
                            },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    return stats[0] || {
        total_events: 0,
        active_events: 0,
        archived_events: 0,
        owned_events: 0,
        co_hosted_events: 0
    };
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


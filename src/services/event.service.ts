// services/event.service.ts
import { AccessControl } from "@models/access.model";
import { ActivityLog } from "@models/activity-log.model";
import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participant.model";
import { EventSession } from "@models/event-session.model";
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

export const createEventService = async (eventData: EventCreationData): Promise<ServiceResponse<EventType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info(`[createEventService] Creating event: ${eventData.title}`);

        // Create the event
        const event = await Event.create([eventData], { session });
        if (!event[0]?._id || !eventData?.created_by) {
            throw new Error("Invalid event creation result");
        }

        const eventId = event[0]._id;
        const creatorId = eventData.created_by;

        // Create access control for owner
        await AccessControl.create([{
            resource_id: eventId,
            resource_type: "event",
            permissions: [{
                user_id: creatorId,
                role: "owner",
            }],
        }], { session });

        // Add co-hosts to access control
        if (eventData.co_hosts && eventData.co_hosts.length > 0) {
            const coHostIds: mongoose.Types.ObjectId[] = eventData.co_hosts.map((id: any) =>
                mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
            );
            const coHostPermissions = coHostIds.map((coHostId: mongoose.Types.ObjectId) => ({
                resource_id: eventId,
                resource_type: "event",
                permissions: [{
                    user_id: coHostId,
                    role: "co_host",
                }],
            }));
            await AccessControl.create(coHostPermissions, { session });
        }

        // Create activity log
        await ActivityLog.create([{
            user_id: creatorId,
            resource_id: eventId,
            resource_type: "event",
            action: "created",
            details: {
                event_title: eventData.title,
                template: eventData.template,
                privacy: eventData.privacy?.visibility
            }
        }], { session });

        // Update user usage statistics
        await updateUsageForEventCreation(creatorId.toString(), eventId.toString(), session);

        await session.commitTransaction();
        logger.info(`[createEventService] Successfully created event: ${eventId}`);

        return {
            status: true,
            code: 201,
            message: "Event created successfully",
            data: event[0],
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[createEventService] Error: ${error.message}`);
        await session.abortTransaction();

        return {
            status: false,
            code: 500,
            message: "Failed to create event",
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

        // Build aggregation pipeline
        const pipeline: any[] = [
            // Match user's accessible events
            {
                $match: {
                    "permissions.user_id": new mongoose.Types.ObjectId(userId),
                    resource_type: "event"
                }
            },
            // Lookup event details
            {
                $lookup: {
                    from: MODEL_NAMES.EVENT,
                    localField: "resource_id",
                    foreignField: "_id",
                    as: "eventData"
                }
            },
            { $unwind: "$eventData" },

            // Add user role to event data
            {
                $addFields: {
                    "eventData.user_role": {
                        $arrayElemAt: [
                            {
                                $filter: {
                                    input: "$permissions",
                                    cond: { $eq: ["$$this.user_id", new mongoose.Types.ObjectId(userId)] }
                                }
                            },
                            0
                        ]
                    }
                }
            },
            { $replaceRoot: { newRoot: "$eventData" } }
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
        const totalResult = await AccessControl.aggregate(countPipeline);
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
                        { $match: { $expr: { $eq: ["$event_id", "$eventId"] } } },
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

        const events = await AccessControl.aggregate(pipeline);

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

export const getEventDetailService = async (eventId: string, userId: string): Promise<ServiceResponse<EventType>> => {
    try {
        // Check user access to event
        const hasAccess = await checkEventAccess(eventId, userId);
        if (!hasAccess) {
            return {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: null,
                other: null
            };
        }

        const pipeline = [
            { $match: { _id: new mongoose.Types.ObjectId(eventId) } },

            // Get creator details
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

            // Get co-hosts details
            {
                $lookup: {
                    from: MODEL_NAMES.USER,
                    localField: "co_hosts",
                    foreignField: "_id",
                    as: "co_hosts_info",
                    pipeline: [
                        { $project: { name: 1, email: 1, avatar_url: 1 } }
                    ]
                }
            },

            // Get participants summary
            {
                $lookup: {
                    from: MODEL_NAMES.EVENT_PARTICIPANT,
                    localField: "_id",
                    foreignField: "event_id",
                    as: "participants_summary",
                    pipeline: [
                        {
                            $group: {
                                _id: "$participation.status",
                                count: { $sum: 1 },
                                recent_participants: {
                                    $push: {
                                        $cond: [
                                            { $lt: ["$participation.joined_at", new Date(Date.now() - 24 * 60 * 60 * 1000)] },
                                            null,
                                            {
                                                name: "$identity.name",
                                                avatar: "$identity.avatar_url",
                                                joined_at: "$participation.joined_at"
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    ]
                }
            },

            // Get albums
            {
                $lookup: {
                    from: MODEL_NAMES.ALBUM,
                    localField: "_id",
                    foreignField: "event_id",
                    as: "albums_detail",
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                description: 1,
                                cover_photo: 1,
                                photo_count: 1,
                                is_private: 1,
                                created_at: 1
                            }
                        },
                        { $sort: { created_at: 1 } }
                    ]
                }
            },

            // Get user's role and permissions
            {
                $lookup: {
                    from: MODEL_NAMES.ACCESS_CONTROL,
                    let: { eventId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$resource_id", "$eventId"] },
                                resource_type: "event",
                                "permissions.user_id": new mongoose.Types.ObjectId(userId)
                            }
                        },
                        {
                            $project: {
                                role: {
                                    $arrayElemAt: [
                                        {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: "$permissions",
                                                        cond: { $eq: ["$this.user_id", new mongoose.Types.ObjectId(userId)] }
                                                    }
                                                },
                                                as: "perm",
                                                in: "$perm.role"
                                            }
                                        },
                                        0
                                    ]
                                }
                            }
                        }
                    ],
                    as: "user_access"
                }
            },

            // Format the response
            {
                $addFields: {
                    creator: { $arrayElemAt: ["$creator_info", 0] },
                    co_hosts: "$co_hosts_info",
                    albums: "$albums_detail",
                    user_role: {
                        $arrayElemAt: ["$user_access.role", 0]
                    },
                    participants_stats: {
                        $arrayToObject: {
                            $map: {
                                input: "$participants_summary",
                                as: "stat",
                                in: {
                                    k: "$stat._id",
                                    v: "$stat.count"
                                }
                            }
                        }
                    },
                    recent_joiners: {
                        $reduce: {
                            input: "$participants_summary.recent_participants",
                            initialValue: [] as any[],
                            in: { $concatArrays: ["$value", "$this"] }
                        }
                    }
                }
            },

            // Clean up temporary fields
            {
                $project: {
                    creator_info: 0,
                    co_hosts_info: 0,
                    albums_detail: 0,
                    participants_summary: 0,
                    user_access: 0
                }
            }
        ];

        const result = await Event.aggregate(pipeline as mongoose.PipelineStage[]);
        const event = result[0];

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

        // Record view activity
        await recordEventActivity(eventId, userId, 'viewed');

        return {
            status: true,
            code: 200,
            message: "Event details fetched successfully",
            data: event,
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[getEventDetailService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: "Failed to fetch event details",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
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

            // Delete participants
            EventParticipant.deleteMany({ event_id: new mongoose.Types.ObjectId(eventId) }, { session }),

            // Delete sessions
            EventSession.deleteMany({ event_id: new mongoose.Types.ObjectId(eventId) }, { session })
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

export const addCreatorAsParticipant = async (eventId: string, userId: string): Promise<void> => {
    try {
        await EventParticipant.create({
            event_id: new mongoose.Types.ObjectId(eventId),
            user_id: new mongoose.Types.ObjectId(userId),
            identity: {
                is_registered_user: true,
                is_anonymous: false
            },
            participation: {
                status: 'active',
                role: 'owner',
                invited_at: new Date(),
                first_joined_at: new Date(),
                last_seen_at: new Date(),
                total_sessions: 0
            },
            permissions: {
                view: { enabled: true, albums: ['all'] },
                upload: { enabled: true, albums: ['all'] },
                download: { enabled: true, albums: ['all'] },
                comment: { enabled: true },
                share: { enabled: true, can_create_tokens: true },
                moderate: {
                    can_approve_content: true,
                    can_remove_content: true,
                    can_manage_guests: true
                }
            }
        });
    } catch (error) {
        logger.error(`[addCreatorAsParticipant] Error: ${error.message}`);
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
        'privacy',
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

    if (processFields.includes('privacy') && updateData.privacy) {
        processed.privacy = await processPrivacyUpdateData(updateData.privacy);
    }

    if (processFields.includes('default_guest_permissions') && updateData.default_guest_permissions) {
        processed.default_guest_permissions = processGuestPermissions(updateData.default_guest_permissions);
    }

    // Always update the updated_at timestamp
    processed.updated_at = new Date();

    return processed;
};

const processPrivacyUpdateData = async (privacyData: any): Promise<any> => {
    const processed: any = {};

    // Validate visibility
    if (privacyData.visibility) {
        const validVisibilities = ['unlisted', 'restricted', 'private'];
        if (!validVisibilities.includes(privacyData.visibility)) {
            throw new Error('Invalid visibility setting');
        }
        processed.visibility = privacyData.visibility;
    }

    // Process guest management settings
    if (privacyData.guest_management) {
        processed.guest_management = {};
        const gm = privacyData.guest_management;

        if (gm.require_approval !== undefined) {
            processed.guest_management.require_approval = Boolean(gm.require_approval);
        }
        if (gm.max_guests !== undefined) {
            const maxGuests = parseInt(gm.max_guests);
            if (maxGuests < 1 || maxGuests > 10000) {
                throw new Error('Max guests must be between 1 and 10000');
            }
            processed.guest_management.max_guests = maxGuests;
        }
        if (gm.allow_anonymous !== undefined) {
            processed.guest_management.allow_anonymous = Boolean(gm.allow_anonymous);
        }
        if (gm.auto_approve_invited !== undefined) {
            processed.guest_management.auto_approve_invited = Boolean(gm.auto_approve_invited);
        }
        if (gm.anonymous_transition_policy) {
            const validPolicies = ['block_all', 'grace_period', 'force_login'];
            if (!validPolicies.includes(gm.anonymous_transition_policy)) {
                throw new Error('Invalid anonymous transition policy');
            }
            processed.guest_management.anonymous_transition_policy = gm.anonymous_transition_policy;
        }
        if (gm.grace_period_hours !== undefined) {
            const hours = parseInt(gm.grace_period_hours);
            if (hours < 1 || hours > 168) { // 1 hour to 1 week
                throw new Error('Grace period must be between 1 and 168 hours');
            }
            processed.guest_management.grace_period_hours = hours;
        }
        if (gm.anonymous_content_policy) {
            const validPolicies = ['preserve_and_transfer', 'preserve_as_anonymous', 'delete_on_expire'];
            if (!validPolicies.includes(gm.anonymous_content_policy)) {
                throw new Error('Invalid anonymous content policy');
            }
            processed.guest_management.anonymous_content_policy = gm.anonymous_content_policy;
        }
    }

    // Process content controls
    if (privacyData.content_controls) {
        processed.content_controls = {};
        const cc = privacyData.content_controls;

        if (cc.allow_downloads !== undefined) {
            processed.content_controls.allow_downloads = Boolean(cc.allow_downloads);
        }
        if (cc.allow_sharing !== undefined) {
            processed.content_controls.allow_sharing = Boolean(cc.allow_sharing);
        }
        if (cc.require_watermark !== undefined) {
            processed.content_controls.require_watermark = Boolean(cc.require_watermark);
        }
        if (cc.approval_mode) {
            const validModes = ['auto', 'manual', 'ai_assisted'];
            if (!validModes.includes(cc.approval_mode)) {
                throw new Error('Invalid approval mode');
            }
            processed.content_controls.approval_mode = cc.approval_mode;
        }
        if (cc.max_file_size_mb !== undefined) {
            const size = parseInt(cc.max_file_size_mb);
            if (size < 1 || size > 500) {
                throw new Error('File size limit must be between 1 and 500 MB');
            }
            processed.content_controls.max_file_size_mb = size;
        }
        if (cc.auto_compress_uploads !== undefined) {
            processed.content_controls.auto_compress_uploads = Boolean(cc.auto_compress_uploads);
        }
        if (cc.allowed_media_types) {
            processed.content_controls.allowed_media_types = {
                images: Boolean(cc.allowed_media_types.images ?? true),
                videos: Boolean(cc.allowed_media_types.videos ?? true)
            };
        }
    }

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
    if (oldVisibility === 'unlisted' && (newVisibility === 'private' || newVisibility === 'restricted')) {
        const anonymousCount = event.anonymous_sessions.length;
        result.anonymous_users_affected = anonymousCount;

        if (anonymousCount > 0) {
            const policy = event.privacy.guest_management.anonymous_transition_policy;
            const graceHours = event.privacy.guest_management.grace_period_hours;

            switch (policy) {
                case 'block_all':
                    // Expire all sessions immediately
                    await Event.updateOne(
                        { _id: eventId },
                        {
                            $set: {
                                'anonymous_sessions.$[].grace_period_expires': new Date()
                            }
                        }
                    );
                    result.actions_taken.push('All anonymous users blocked immediately');
                    break;

                case 'grace_period':
                    // Set grace period for all sessions
                    const graceExpiry = new Date(Date.now() + (graceHours * 60 * 60 * 1000));
                    await Event.updateOne(
                        { _id: eventId },
                        {
                            $set: {
                                'anonymous_sessions.$[elem].grace_period_expires': graceExpiry
                            }
                        },
                        {
                            arrayFilters: [{ 'elem.grace_period_expires': { $exists: false } }]
                        }
                    );
                    result.actions_taken.push(`${graceHours}h grace period set for ${anonymousCount} anonymous users`);
                    break;

                case 'force_login':
                    // Set 1 hour grace period and mark for notification
                    const loginExpiry = new Date(Date.now() + (1 * 60 * 60 * 1000));
                    await Event.updateOne(
                        { _id: eventId },
                        {
                            $set: {
                                'anonymous_sessions.$[].grace_period_expires': loginExpiry,
                                'anonymous_sessions.$[].transition_notified': true
                            }
                        }
                    );
                    result.actions_taken.push(`Force login notification sent to ${anonymousCount} anonymous users`);
                    break;
            }

            // Update stats
            await Event.updateOne(
                { _id: eventId },
                {
                    $set: {
                        'privacy.previous_visibility': oldVisibility,
                        'privacy.visibility_changed_at': new Date()
                    }
                }
            );
        }
    }

    // Handle other transition scenarios
    if (newVisibility === 'unlisted' && oldVisibility !== 'unlisted') {
        result.actions_taken.push('Event is now accessible via link without login');
    }

    if (newVisibility === 'restricted' && oldVisibility !== 'restricted') {
        result.actions_taken.push('Event now requires approval for new guests');
    }

    if (newVisibility === 'private' && oldVisibility !== 'private') {
        result.actions_taken.push('Event is now invitation-only');
    }

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


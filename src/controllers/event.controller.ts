// controllers/event.controller.ts


import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { Event, EventType } from "@models/event.model";
import {
    addCreatorAsParticipant,
    createEventService,
    deleteEventService,
    getEventDetailService,
    getUserEventsService,
    processEventUpdateData,
    updateEventService,
    toggleEventArchiveService,
    listSubEvents,
    addSubEvent,
    updateSubEvent,
    deleteSubEvent
} from "@services/event";
import { createDefaultAlbumForEvent } from "@services/album";
import { eventCacheService } from "@services/cache/event-cache.service";
import { getTemplateDefaults } from "@services/event/template-defaults";

interface InjectedRequest extends Request {
    user: {
        _id: string;
        [key: string]: any;
    };
}

interface EventCreationInput {
    title: string;
    description?: string;
    start_date?: string | Date;
    end_date?: string | Date;
    timezone?: string;
    location?: {
        name?: string;
        address?: string;
        coordinates?: [number, number];
    };
    cover_image?: {
        url?: string;
        public_id?: string;
        thumbnail_url?: string;
    };
    template?: 'wedding' | 'birthday' | 'concert' | 'corporate' | 'vacation' | 'custom';
    visibility?: 'anyone_with_link' | 'invited_only' | 'private';
    permissions?: {
        can_view?: boolean;
        can_upload?: boolean;
        can_download?: boolean;
        allowed_media_types?: {
            images?: boolean;
            videos?: boolean;
        };
        require_approval?: boolean;
    };
    share_settings?: {
        is_active?: boolean;
        password?: string;
        expires_at?: string | Date;
    };
    face_recognition?: {
        enabled?: boolean;
    };
    co_hosts?: Array<{
        user_id: string | mongoose.Types.ObjectId;
        invited_by: string | mongoose.Types.ObjectId;
        status?: 'pending' | 'approved' | 'rejected';
        permissions?: {
            manage_content?: boolean;
            manage_guests?: boolean;
            manage_settings?: boolean;
            approve_content?: boolean;
        };
    }>;
}

export const createEventController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Validate req.user._id
        if (!req.user || !req.user._id) {
            console.error('createEventController: req.user or req.user._id is undefined');
            throw new Error('User authentication required');
        }

        const { title, template, start_date, end_date, face_recognition } = trimObject(req.body) as EventCreationInput;

        // Validation
        if (!title?.trim()) throw new Error('Event title is required');
        if (title.length > 100) throw new Error('Event title must be less than 100 characters');

        // Validate template
        const validTemplates = ['wedding', 'birthday', 'concert', 'corporate', 'vacation', 'custom'];
        if (!validTemplates.includes(template)) throw new Error('Invalid template type');

        // Date validation
        const startDate = start_date ? new Date(start_date) : new Date();
        const endDate = end_date ? new Date(end_date) : null;

        if (isNaN(startDate.getTime())) throw new Error('Invalid start date');
        if (endDate && isNaN(endDate.getTime())) throw new Error('Invalid end date');
        if (startDate && endDate && startDate >= endDate)
            throw new Error('End date must be after start date');

        // Template-driven defaults (Phase 1.1): the server applies visibility
        // and permissions per template so clients can't skip policy. Biometrics
        // (face_recognition) are enabled only on an explicit boolean opt-in.
        const templateDefaults = getTemplateDefaults(template);

        const eventData: Partial<EventType> = {
            title: title.trim(),
            template,
            created_by: new mongoose.Types.ObjectId(req.user._id), // Set created_by explicitly
            start_date: startDate,
            end_date: endDate,
            visibility: templateDefaults.visibility,
            permissions: templateDefaults.permissions,
            face_recognition: {
                enabled: face_recognition?.enabled === true,
            },
            // Other fields (description, timezone, location, cover_image, share_settings, co_hosts, stats)
            // are omitted to use schema defaults
        } as Partial<EventType>;

        const response = await createEventService(eventData);

        if (!response || typeof response.status === 'undefined') {
            console.error('Invalid response from createEventService:', response);
            res.status(500).json({
                status: false,
                message: 'Internal server error - invalid service response',
                data: null,
            });
            return;
        }

        // Create default album and add creator as participant
        if (response.status && response.data?._id) {
            try {
                await Promise.all([
                    createDefaultAlbumForEvent(response.data._id.toString(), req.user._id.toString()),
                ]);
            } catch (albumError) {
                console.error('Error creating default album:', albumError);
                // Continue even if album creation fails
            }
        }

        // Send response
        res.status(response.status ? 201 : 400).json(response);
    } catch (error) {
        console.error('Error in createEventController:', error);
        res.status(500).json({
            status: false,
            message: error.message || 'Internal server error',
            data: null,
        });
    }
};

// // Helper function to generate unique event code
const generateUniqueEventCode = async (template: string): Promise<string> => {
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        const code = `${template.toUpperCase()}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

        // Check if code already exists
        const existingEvent = await Event.findOne({ event_code: code });
        if (!existingEvent) {
            return code;
        }
        attempts++;
    }

    // Fallback with timestamp if all attempts fail
    return `${template.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
};


export const getUserEventsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user._id.toString();
        const {
            page = 1,
            limit = 10,
            sort = '-created_at',
            status = 'all', // 'active', 'archived', 'all'
            privacy = 'all', // 'public', 'private', 'all'
            template,
            search,
            tags
        } = trimObject(req.query);

        const filters = {
            userId,
            page: Math.max(1, parseInt(page as string)),
            limit: Math.min(50, Math.max(1, parseInt(limit as string))),
            sort: sort as string,
            status: status as string,
            privacy: privacy as string,
            template: template as string,
            search: search as string,
            tags: tags ? (tags as string).split(',') : undefined
        };

        const response = await getUserEventsService(filters);
        console.log('===== GET USER EVENTS REQUEST =====', response);
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        const response = await getEventDetailService(event_id, userId);
        console.log('===== GET EVENT DETAIL REQUEST =====', response);
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /event/:event_id/my-access
 * The client's single source of truth for role-based UI. Returns the caller's
 * role and computed permission set for this event — resolved by the exact same
 * policy the authorize() middleware enforces, so client and server can never
 * disagree. See rc-frontend/docs/RBAC_DESIGN.md.
 */
export const getMyAccessController = async (req: injectedRequest, res: Response): Promise<void> => {
    const access = req.eventAccess;

    if (!access) {
        res.status(500).json({
            status: false,
            message: 'Access context missing — eventAccessMiddleware must run first',
            data: null
        });
        return;
    }

    res.status(200).json({
        status: true,
        message: 'Access resolved',
        data: {
            event_id: access.eventId,
            role: access.role,
            permissions: Array.from(access.permissions ?? [])
        }
    });
};

export const updateEventController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const updateData = trimObject(req.body);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            res.status(400).json({
                status: false,
                message: 'Valid event ID is required',
                data: null
            });
            return;
        }

        // Define fields that can be updated (including photowall)
        const fieldsToProcess = [
            'title',
            'description',
            'start_date',
            'end_date',
            'location',
            'visibility',
            'default_guest_permissions',
            'cover_image',
            'photowall_settings',
            'styling_config'
        ];

        // Process and validate update data. Closing/reopening the event
        // (share_settings.is_active) is NOT handled here — it is a creator-only
        // action owned by PATCH /:event_id/archive, and processShareSettingsData
        // ignores is_active — so the generic update no longer needs to special-
        // case it or re-fetch the event to detect a flip.
        const currentEvent = await Event.findById(event_id);
        const processedUpdateData = await processEventUpdateData(updateData, currentEvent);
        const response = await updateEventService(event_id, processedUpdateData, userId);

        if (response.status) {
            // Invalidate caches related to this event and user
            try {
                await Promise.all([
                    eventCacheService.invalidateEventCaches(event_id),
                    eventCacheService.invalidateUserCaches(userId)
                ]);
            } catch (e) {
                console.warn('Cache invalidation failed after update:', e);
            }
            res.status(200).json(response);
        } else {
            res.status(response.code).json(response);
        }
    } catch (error) {
        console.error('Error in updateEventController:', error);
        res.status(500).json({
            status: false,
            message: error.message || 'Internal server error',
            data: null
        });
    }
};


export const deleteEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // Route-level authorize('event.delete') gates this to the creator;
        // deleteEventService keeps its own owner check as defense in depth.
        const response = await deleteEventService(event_id, userId);
        // Invalidate caches regardless of response status to be safe
        try {
            await Promise.all([
                eventCacheService.invalidateEventCaches(event_id),
                eventCacheService.invalidateUserCaches(userId)
            ]);
        } catch (e) {
            console.warn('Cache invalidation failed after delete:', e);
        }
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// ============= SEARCH & DISCOVERY =============

export const searchEventsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user._id.toString();
        const searchFilters = {
            ...trimObject(req.query),
            userId
        };

        // const response = await eventService.searchEventsService(searchFilters);
        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getEventsByTagController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { tag } = trimObject(req.params);
        const userId = req.user._id.toString();
        const { page = 1, limit = 10 } = trimObject(req.query);

        if (!tag) throw new Error("Tag is required");

        // const response = await eventService.getEventsByTagService({
        //     tag,
        //     userId,
        //     page: parseInt(page as string),
        //     limit: parseInt(limit as string)
        // });

        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getFeaturedEventsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { page = 1, limit = 10 } = trimObject(req.query);

        // const response = await eventService.getFeaturedEventsService({
        //     page: parseInt(page as string),
        //     limit: parseInt(limit as string)
        // });

        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// ============= ANALYTICS & ACTIVITY =============

export const getEventAnalyticsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const {
            period = '7d', // '24h', '7d', '30d', '90d', 'all'
            metrics = 'all' // 'engagement', 'content', 'participants', 'all'
        } = trimObject(req.query);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // const response = await eventService.getEventAnalyticsService({
        //     eventId: event_id,
        //     userId,
        //     period: period as string,
        //     metrics: metrics as string
        // });

        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const getEventActivityController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const {
            page = 1,
            limit = 20,
            type = 'all' // 'upload', 'view', 'comment', 'join', 'all'
        } = trimObject(req.query);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // const response = await eventService.getEventActivityService({
        //     eventId: event_id,
        //     userId,
        //     page: parseInt(page as string),
        //     limit: parseInt(limit as string),
        //     type: type as string
        // });

        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// ============= ALBUMS MANAGEMENT =============

export const getEventAlbumsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // const response = await eventService.getEventAlbumsService(event_id, userId);
        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const createEventAlbumController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const { name, description, is_private = false } = trimObject(req.body);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }
        if (!name?.trim()) throw new Error("Album name is required");

        // const response = await eventService.createEventAlbumService({
        //     eventId: event_id,
        //     userId,
        //     name: name.trim(),
        //     description: description?.trim() || "",
        //     isPrivate: is_private
        // });

        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// ============= SETTINGS & PREFERENCES =============

export const updateEventPrivacyController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const privacySettings = trimObject(req.body);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // const response = await eventService.updateEventPrivacyService(event_id, userId, privacySettings);
        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const updateDefaultPermissionsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const permissions = trimObject(req.body);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // const response = await eventService.updateDefaultPermissionsService(event_id, userId, permissions);
        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const toggleEventArchiveController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const { archive = true } = trimObject(req.body);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // Route-level authorize('event.archive') already gated this to the creator.
        const response = await toggleEventArchiveService(event_id, userId, Boolean(archive));

        if (response.status) {
            try {
                await Promise.all([
                    eventCacheService.invalidateEventCaches(event_id),
                    eventCacheService.invalidateUserCaches(userId)
                ]);
            } catch (e) {
                console.warn('Cache invalidation failed after archive toggle:', e);
            }
        }
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

// ============= SUB-EVENTS (multi-function structure) =============

const invalidateEventCachesQuietly = async (eventId: string, userId: string) => {
    try {
        await Promise.all([
            eventCacheService.invalidateEventCaches(eventId),
            eventCacheService.invalidateUserCaches(userId)
        ]);
    } catch (e) {
        console.warn('Cache invalidation failed after sub-event change:', e);
    }
};

export const getSubEventsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }
        sendResponse(res, await listSubEvents(event_id));
    } catch (error) {
        next(error);
    }
};

export const createSubEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const { name, date, order } = trimObject(req.body);
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }
        const response = await addSubEvent(event_id, { name, date, order });
        if (response.status) await invalidateEventCachesQuietly(event_id, req.user._id.toString());
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const updateSubEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, sub_event_id } = trimObject(req.params);
        const { name, date, order } = trimObject(req.body);
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }
        const response = await updateSubEvent(event_id, sub_event_id, { name, date, order });
        if (response.status) await invalidateEventCachesQuietly(event_id, req.user._id.toString());
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};

export const deleteSubEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, sub_event_id } = trimObject(req.params);
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }
        const response = await deleteSubEvent(event_id, sub_event_id);
        if (response.status) await invalidateEventCachesQuietly(event_id, req.user._id.toString());
        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};


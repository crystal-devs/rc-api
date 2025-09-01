// controllers/event.controller.ts


import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { Event, EventType } from "@models/event.model";
import {
    addCreatorAsParticipant,
    checkUpdatePermission,
    createEventService,
    deleteEventService,
    getEventDetailService,
    getUserEventsService,
    processEventUpdateData,
    updateEventService
} from "@services/event";
import { createDefaultAlbumForEvent } from "@services/album";

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

        const { title, template, start_date, end_date } = trimObject(req.body) as EventCreationInput;

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

        // Prepare event data (minimal, relying on schema defaults)
        const eventData: Partial<EventType> = {
            title: title.trim(),
            template,
            created_by: new mongoose.Types.ObjectId(req.user._id), // Set created_by explicitly
            start_date: startDate,
            end_date: endDate,
            // Other fields (description, timezone, location, cover_image, visibility, permissions, share_settings, co_hosts, stats)
            // are omitted to use schema defaults
        };

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
                    addCreatorAsParticipant(response.data._id.toString(), req.user._id.toString()),
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

        // Validate update permissions
        const hasPermission = await checkUpdatePermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to update this event",
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

        // Process and validate update data
        const processedUpdateData = await processEventUpdateData(updateData, fieldsToProcess);

        const response = await updateEventService(event_id, processedUpdateData, userId);

        if (response.status) {
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

        const response = await deleteEventService(event_id, userId);
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

        // const response = await eventService.toggleEventArchiveService(event_id, userId, archive);
        // sendResponse(res, response);
    } catch (error) {
        next(error);
    }
};


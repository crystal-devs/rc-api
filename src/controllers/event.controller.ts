// controllers/event.controller.ts


import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import * as eventService from "@services/event.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { createDefaultAlbumForEvent } from "@services/album.service";
import { Event } from "@models/event.model";

// ============= CORE EVENT OPERATIONS =============

export const createEventController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const {
            title,
            description,
            start_date,
            end_date,
            timezone = "Asia/Kolkata",
            location,
            cover_image,
            template = "custom",
            privacy,
            default_guest_permissions
        } = trimObject(req.body);

        // Enhanced validation
        if (!title?.trim()) throw new Error("Event title is required");
        if (title.length > 100) throw new Error("Event title must be less than 100 characters");
        if (description && description.length > 1000) throw new Error("Description must be less than 1000 characters");

        // Advanced date validation
        const startDate = start_date ? new Date(start_date) : new Date();
        const endDate = end_date ? new Date(end_date) : null;

        if (startDate && isNaN(startDate.getTime())) throw new Error("Invalid start date");
        if (endDate && isNaN(endDate.getTime())) throw new Error("Invalid end date");
        if (startDate && endDate && startDate >= endDate) throw new Error("End date must be after start date");

        // Generate unique event_code for easier sharing
        const eventCode = await generateUniqueEventCode(template);

        // Enhanced location processing
        const locationObj = eventService.processLocationData(location);

        // Enhanced cover image processing
        const coverImageObj = eventService.processCoverImageData(cover_image, req.user._id.toString());

        const eventData: eventService.EventCreationData = {
            title: title.trim(),
            description: description?.trim() || "",
            event_code: eventCode,
            created_by: new mongoose.Types.ObjectId(req.user._id),

            // Initialize empty co-hosts array
            co_hosts: [] as any,
            co_host_invite: null,

            start_date: startDate,
            end_date: endDate,
            timezone,

            location: locationObj ? {
                name: locationObj.name ?? "",
                address: locationObj.address ?? "",
                coordinates: locationObj.coordinates ?? []
            } : {
                name: "",
                address: "",
                coordinates: []
            },

            cover_image: coverImageObj ? {
                url: coverImageObj.url ?? "",
                public_id: coverImageObj.public_id ?? "",
                uploaded_by: coverImageObj.uploaded_by ?? req.user._id,
                thumbnail_url: (coverImageObj as any).thumbnail_url ?? "",
                compressed_url: (coverImageObj as any).compressed_url ?? ""
            } : {
                url: "",
                public_id: "",
                uploaded_by: null,
                thumbnail_url: "",
                compressed_url: ""
            },

            template,

            // Simplified privacy settings
            privacy: {
                visibility: privacy?.visibility || 'private',
                guest_management: {
                    require_approval: privacy?.guest_management?.require_approval ?? true,
                    max_guests: privacy?.guest_management?.max_guests ?? 500,
                    allow_anonymous: privacy?.guest_management?.allow_anonymous ?? (privacy?.visibility === 'unlisted'),
                    auto_approve_invited: privacy?.guest_management?.auto_approve_invited ?? true,
                    anonymous_transition_policy: privacy?.guest_management?.anonymous_transition_policy || 'grace_period',
                    grace_period_hours: privacy?.guest_management?.grace_period_hours ?? 24,
                    anonymous_content_policy: privacy?.guest_management?.anonymous_content_policy || 'preserve_and_transfer'
                },
                content_controls: {
                    allow_downloads: privacy?.content_controls?.allow_downloads ?? true,
                    allow_sharing: privacy?.content_controls?.allow_sharing ?? false,
                    require_watermark: privacy?.content_controls?.require_watermark ?? false,
                    approval_mode: privacy?.content_controls?.approval_mode || 'auto',
                    auto_compress_uploads: privacy?.content_controls?.auto_compress_uploads ?? true,
                    max_file_size_mb: privacy?.content_controls?.max_file_size_mb ?? 50,
                    allowed_media_types: {
                        images: privacy?.content_controls?.allowed_media_types?.images ?? true,
                        videos: privacy?.content_controls?.allowed_media_types?.videos ?? true
                    }
                }
            },

            default_guest_permissions: {
                view: default_guest_permissions?.view ?? true,
                upload: default_guest_permissions?.upload ?? false,
                download: default_guest_permissions?.download ?? false,
                share: default_guest_permissions?.share ?? false,
                create_albums: default_guest_permissions?.create_albums ?? false
            },

            anonymous_sessions: [] as any,

            stats: {
                participants: {
                    total: 1,
                    co_hosts: 0,
                    anonymous_sessions: 0,
                    registered_users: 1
                },
                content: {
                    photos: 0,
                    videos: 0,
                    total_size_mb: 0,
                    comments: 0,
                    pending_approval: 0
                },
                engagement: {
                    total_views: 0,
                    unique_viewers: 0,
                    average_session_duration: 0,
                    last_activity: new Date()
                },
                sharing: {
                    total_shares: 0,
                    qr_scans: 0
                }
            },

            created_at: new Date(),
            updated_at: new Date(),
            archived_at: null,
            featured: false
        };

        const response = await eventService.createEventService(eventData);

        // Check if response has proper structure
        if (!response || typeof response.status === 'undefined') {
            console.error('Invalid response from createEventService:', response);
            res.status(500).json({
                status: false,
                message: 'Internal server error - invalid service response',
                data: null
            });
            return;
        }

        // Create default album and add creator as participant
        if (response.status && response.data?._id) {
            try {
                await Promise.all([
                    createDefaultAlbumForEvent(response.data._id.toString(), req.user._id.toString()),
                    eventService.addCreatorAsParticipant(response.data._id.toString(), req.user._id.toString())
                ]);
            } catch (albumError) {
                console.error('Error creating default album:', albumError);
                // Continue even if album creation fails
            }
        }

        // Send proper response
        if (response.status) {
            res.status(201).json(response);
        } else {
            res.status(400).json(response);
        }
    } catch (error) {
        console.error('Error in createEventController:', error);
        res.status(500).json({
            status: false,
            message: error.message || 'Internal server error',
            data: null
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

        const response = await eventService.getUserEventsService(filters);
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

        const response = await eventService.getEventDetailService(event_id, userId);
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
        const hasPermission = await eventService.checkUpdatePermission(event_id, userId);
        if (!hasPermission) {
            res.status(403).json({
                status: false,
                message: "You don't have permission to update this event",
                data: null
            });
            return;
        }

        // Get current event for visibility transition handling
        const currentEvent = await Event.findById(event_id);
        if (!currentEvent) {
            res.status(404).json({
                status: false,
                message: 'Event not found',
                data: null
            });
            return;
        }

        // Define fields that can be updated
        const fieldsToProcess = [
            'title',
            'description',
            'start_date',
            'end_date',
            'location',
            'privacy',
            'default_guest_permissions'
        ];

        // Process and validate update data
        const processedUpdateData = await eventService.processEventUpdateData(updateData, fieldsToProcess);

        // Handle visibility transitions if privacy is being updated
        let transitionResult = null;
        if (processedUpdateData.privacy?.visibility &&
            processedUpdateData.privacy.visibility !== currentEvent.privacy.visibility) {

            try {
                transitionResult = await eventService.handleVisibilityTransition(
                    event_id,
                    currentEvent.privacy.visibility,
                    processedUpdateData.privacy.visibility,
                    userId
                );
            } catch (transitionError) {
                console.error('Error handling visibility transition:', transitionError);
                // Continue with update even if transition handling fails
            }
        }

        const response = await eventService.updateEventService(event_id, processedUpdateData, userId);

        // Check if response has proper structure
        if (!response || typeof response.status === 'undefined') {
            console.error('Invalid response from updateEventService:', response);
            res.status(500).json({
                status: false,
                message: 'Internal server error - invalid service response',
                data: null
            });
            return;
        }

        // Include transition result in response if applicable
        if (transitionResult) {
            response.visibility_transition = transitionResult;
        }

        // Send proper response
        if (response.status) {
            res.status(200).json(response);
        } else {
            res.status(400).json(response);
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

        const response = await eventService.deleteEventService(event_id, userId);
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


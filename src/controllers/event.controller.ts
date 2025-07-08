// ================================================================
// controllers/event.controller.ts
// ================================================================

import { trimObject } from "@utils/sanitizers.util";
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import * as eventService from "@services/event.service";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { createDefaultAlbumForEvent } from "@services/album.service";

// ============= CORE EVENT OPERATIONS =============

export const createEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { 
            title, 
            description, 
            start_date, 
            end_date, 
            timezone = "UTC",
            location,
            cover_image,
            template = "custom",
            tags = [],
            privacy,
            default_guest_permissions,
            co_hosts = []
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

        // Generate unique slug with better collision handling
        const baseSlug = title
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 50);
        
        const slug = await eventService.generateUniqueSlug(baseSlug);
        
        // Enhanced location processing
        const locationObj = eventService.processLocationData(location);
        
        // Enhanced cover image processing
        const coverImageObj = eventService.processCoverImageData(cover_image, req.user._id.toString());

        // Validate co-hosts
        const validCoHosts = await eventService.validateCoHosts(co_hosts);

        const eventData: eventService.EventCreationData = {
            title: title.trim(),
            description: description?.trim() || "",
            slug,
            created_by: new mongoose.Types.ObjectId(req.user._id),
            co_hosts: validCoHosts,
            start_date: startDate,
            end_date: endDate,
            timezone,
            location: locationObj || null,
            cover_image: coverImageObj,
            template,
            tags: Array.isArray(tags) ? tags.filter(tag => tag && tag.trim()) : [],
            
            // Enhanced privacy settings
            privacy: {
                visibility: privacy?.visibility || 'private',
                discoverable: privacy?.discoverable || false,
                guest_management: {
                    anyone_can_invite: privacy?.guest_management?.anyone_can_invite || false,
                    require_approval: privacy?.guest_management?.require_approval || true,
                    auto_approve_domains: privacy?.guest_management?.auto_approve_domains || [],
                    max_guests: privacy?.guest_management?.max_guests || 500,
                    allow_anonymous: privacy?.guest_management?.allow_anonymous || false
                },
                content_controls: {
                    allow_downloads: privacy?.content_controls?.allow_downloads || true,
                    allow_sharing: privacy?.content_controls?.allow_sharing || false,
                    require_watermark: privacy?.content_controls?.require_watermark || false,
                    content_moderation: privacy?.content_controls?.content_moderation || 'auto'
                }
            },
            
            // Enhanced default permissions
            default_guest_permissions: {
                view: default_guest_permissions?.view ?? true,
                upload: default_guest_permissions?.upload ?? false,
                download: default_guest_permissions?.download ?? false,
                comment: default_guest_permissions?.comment ?? true,
                share: default_guest_permissions?.share ?? false,
                create_albums: default_guest_permissions?.create_albums ?? false
            },
            
            // Initialize stats
            stats: {
                participants: { 
                    total: 1, // Creator is first participant
                    active: 0, 
                    pending_invites: 0, 
                    co_hosts: validCoHosts.length 
                },
                content: { 
                    photos: 0, 
                    videos: 0, 
                    total_size_mb: 0, 
                    comments: 0 
                },
                engagement: { 
                    total_views: 0, 
                    unique_viewers: 0, 
                    average_session_duration: 0,
                    last_activity: new Date()
                },
                sharing: { 
                    active_tokens: 0, 
                    total_shares: 0, 
                    external_shares: 0 
                }
            },

            // Add missing required fields for EventCreationType
            // albums: [],
            is_private: privacy?.visibility === 'private',
            is_shared: false,
            
            // Metadata
            created_at: new Date(),
            updated_at: new Date(),
            archived_at: null,
            featured: false
        };
        
        const response = await eventService.createEventService(eventData);

        // Create default album and add creator as participant
        if (response.status && response.data?._id) {
            await Promise.all([
                createDefaultAlbumForEvent(response.data._id.toString(), req.user._id.toString()),
                eventService.addCreatorAsParticipant(response.data._id.toString(), req.user._id.toString())
            ]);
        }

        sendResponse(res, response);
    } catch (error) {
        next(error);
    }
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

export const updateEventController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        const userId = req.user._id.toString();
        const updateData = trimObject(req.body);

        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            throw new Error("Valid event ID is required");
        }

        // Validate update permissions
        const hasPermission = await eventService.checkUpdatePermission(event_id, userId);
        if (!hasPermission) {
            throw new Error("You don't have permission to update this event");
        }

        // Process and validate update data
        const processedUpdateData = await eventService.processEventUpdateData(updateData);

        const response = await eventService.updateEventService(event_id, processedUpdateData, userId);
        sendResponse(res, response);
    } catch (error) {
        next(error);
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


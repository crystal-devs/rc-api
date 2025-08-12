// ====================================
// 4. services/event/event-utils.service.ts
// ====================================

import { Event } from "@models/event.model";
import { User } from "@models/user.model";
import { ActivityLog } from "@models/activity-log.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import type { 
    EventStats, 
    LocationData, 
    CoverImageData, 
    PermissionsData, 
    ShareSettingsData,
    VisibilityTransitionResult 
} from './event.types';

export const generateUniqueSlug = async (baseSlug: string): Promise<string> => {
    let slug = baseSlug;
    let counter = 1;

    while (await Event.exists({ slug })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
    }

    return slug;
};

export const processLocationData = (location: any): LocationData => {
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

export const processCoverImageData = (coverImageData: any): CoverImageData => {
    if (!coverImageData || typeof coverImageData !== 'object') {
        return { url: '', public_id: '', uploaded_by: null, thumbnail_url: '' };
    }

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

export const processPermissionsData = (permissionsData: any): PermissionsData => {
    if (!permissionsData || typeof permissionsData !== 'object') {
        throw new Error('Invalid permissions data');
    }

    const processed: PermissionsData = {};

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

export const processShareSettingsData = (shareSettingsData: any): ShareSettingsData => {
    if (!shareSettingsData || typeof shareSettingsData !== 'object') {
        return { is_active: true, password: null, expires_at: null };
    }

    const processed: ShareSettingsData = {};

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

export const validateCoHosts = async (coHosts: string[]): Promise<mongoose.Types.ObjectId[]> => {
    if (!Array.isArray(coHosts) || coHosts.length === 0) {
        return [];
    }

    const validObjectIds = coHosts
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

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

        // Check if user is the event owner
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
        logger.error('Error checking update permission:', error);
        return false;
    }
};

export const getUserEventStats = async (userId: string): Promise<EventStats> => {
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

        return {
            total_events: allUserEvents.length,
            active_events: allUserEvents.filter(event => !event.archived_at).length,
            archived_events: allUserEvents.filter(event => event.archived_at).length,
            owned_events: ownedEvents.length,
            co_hosted_events: coHostedEvents.length
        };
    } catch (error) {
        logger.error('Error getting user event stats:', error);
        return {
            total_events: 0,
            active_events: 0,
            archived_events: 0,
            owned_events: 0,
            co_hosted_events: 0
        };
    }
};

export const recordEventActivity = async (
    eventId: string, 
    userId: string, 
    action: string, 
    additionalDetails: any = {}
): Promise<void> => {
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

export const handleVisibilityTransition = async (
    eventId: string,
    oldVisibility: string,
    newVisibility: string,
    userId: string
): Promise<VisibilityTransitionResult> => {
    const event = await Event.findById(eventId);
    if (!event) {
        throw new Error('Event not found');
    }

    const result: VisibilityTransitionResult = {
        from: oldVisibility,
        to: newVisibility,
        anonymous_users_affected: 0,
        actions_taken: []
    };

    // Handle transitions involving anonymous users
    // Implementation would go here based on your business logic

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

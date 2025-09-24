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
    VisibilityTransitionResult,
    StylingConfig
} from './event.types';
import { EventParticipant } from "@models/event-participants.model";

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

export const processStylingData = (stylingData: any): StylingConfig => {
    if (!stylingData || typeof stylingData !== 'object') {
        // Return default values matching your schema
        return {
            cover: {
                template_id: 0,
                type: 0
            },
            gallery: {
                layout_id: 1,
                grid_spacing: 0,
                thumbnail_size: 1
            },
            theme: {
                theme_id: 8,
                fontset_id: 0
            },
            navigation: {
                style_id: 0
            },
            language: 'en'
        };
    }

    // Validate and process cover settings
    const cover = {
        template_id: 0,
        type: 0
    };

    if (stylingData.cover) {
        if (stylingData.cover.template_id !== undefined) {
            const templateId = parseInt(stylingData.cover.template_id);
            if (isNaN(templateId) || templateId < 0 || templateId > 10) {
                throw new Error('Cover template_id must be a number between 0 and 10');
            }
            cover.template_id = templateId;
        }

        if (stylingData.cover.type !== undefined) {
            const type = parseInt(stylingData.cover.type);
            if (isNaN(type) || type < 0 || type > 5) {
                throw new Error('Cover type must be a number between 0 and 5');
            }
            cover.type = type;
        }
    }

    // Validate and process gallery settings
    const gallery = {
        layout_id: 1,
        grid_spacing: 0,
        thumbnail_size: 1
    };

    if (stylingData.gallery) {
        if (stylingData.gallery.layout_id !== undefined) {
            const layoutId = parseInt(stylingData.gallery.layout_id);
            if (isNaN(layoutId) || layoutId < 0 || layoutId > 5) {
                throw new Error('Gallery layout_id must be a number between 0 and 5');
            }
            gallery.layout_id = layoutId;
        }

        if (stylingData.gallery.grid_spacing !== undefined) {
            const spacing = parseInt(stylingData.gallery.grid_spacing);
            if (isNaN(spacing) || spacing < 0 || spacing > 3) {
                throw new Error('Gallery grid_spacing must be a number between 0 and 2');
            }
            gallery.grid_spacing = spacing;
        }

        if (stylingData.gallery.thumbnail_size !== undefined) {
            const thumbSize = parseInt(stylingData.gallery.thumbnail_size);
            if (isNaN(thumbSize) || thumbSize < 0 || thumbSize > 2) {
                throw new Error('Gallery thumbnail_size must be a number between 0 and 2');
            }
            gallery.thumbnail_size = thumbSize;
        }
    }

    // Validate and process theme settings
    const theme = {
        theme_id: 8,
        fontset_id: 0
    };

    if (stylingData.theme) {
        if (stylingData.theme.theme_id !== undefined) {
            const themeId = parseInt(stylingData.theme.theme_id);
            if (isNaN(themeId) || themeId < 0 || themeId > 10) {
                throw new Error('Theme theme_id must be a number between 0 and 10');
            }
            theme.theme_id = themeId;
        }

        if (stylingData.theme.fontset_id !== undefined) {
            const fontsetId = parseInt(stylingData.theme.fontset_id);
            if (isNaN(fontsetId) || fontsetId < 0 || fontsetId > 5) {
                throw new Error('Theme fontset_id must be a number between 0 and 5');
            }
            theme.fontset_id = fontsetId;
        }
    }

    // Validate and process navigation settings
    const navigation = {
        style_id: 0
    };

    if (stylingData.navigation) {
        if (stylingData.navigation.style_id !== undefined) {
            const styleId = parseInt(stylingData.navigation.style_id);
            if (isNaN(styleId) || styleId < 0 || styleId > 5) {
                throw new Error('Navigation style_id must be a number between 0 and 5');
            }
            navigation.style_id = styleId;
        }
    }

    // Validate language setting
    let language = 'en';
    if (stylingData.language !== undefined) {
        if (typeof stylingData.language !== 'string') {
            throw new Error('Language must be a string');
        }
        // Basic language code validation (can be expanded)
        const validLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'];
        if (!validLanguages.includes(stylingData.language)) {
            throw new Error('Invalid language code');
        }
        language = stylingData.language;
    }

    return {
        cover,
        gallery,
        theme,
        navigation,
        language
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
        // This function is now redundant since createEventService handles it
        // But keeping for backward compatibility
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            role: 'creator'
        }).session(session);

        if (!participant) {
            // Create participant if not exists
            await EventParticipant.create([{
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: new mongoose.Types.ObjectId(eventId),
                role: 'creator',
                join_method: 'created_event',
                status: 'active',
                joined_at: new Date(),
                last_activity_at: new Date()
            }], { session });

            // Update event stats
            await Event.updateOne(
                { _id: new mongoose.Types.ObjectId(eventId) },
                {
                    $inc: {
                        'stats.total_participants': 1,
                        'stats.creators_count': 1
                    }
                },
                { session }
            );
        }
    } catch (error) {
        logger.error(`[addCreatorAsParticipant] Error: ${error.message}`);
        throw error;
    }
};

export const checkUpdatePermission = async (
    eventId: string,
    userId: string
): Promise<boolean> => {
    try {
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        });

        if (!participant) {
            return false;
        }

        // Check if user has edit permissions based on their role and permissions
        return participant.permissions?.can_edit_event === true;
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

// export const getUserEventRole = async (
//     userId: string,
//     eventId: string
// ): Promise<{
//     role?: string;
//     permissions?: any;
//     status?: string;
//     participant?: any;
// } | null> => {
//     try {
//         const participant = await EventParticipant.findOne({
//             user_id: new mongoose.Types.ObjectId(userId),
//             event_id: new mongoose.Types.ObjectId(eventId),
//             status: 'active'
//         });

//         if (!participant) {
//             return null;
//         }

//         return {
//             role: participant.role,
//             permissions: participant.effective_permissions, // Use virtual field
//             status: participant.status,
//             participant: participant
//         };
//     } catch (error) {
//         logger.error('Error getting user event role:', error);
//         return null;
//     }
// };

// /**
//  * NEW: Check if user has specific permission for an event
//  */
// export const checkEventPermission = async (
//     userId: string,
//     eventId: string,
//     permission: string
// ): Promise<boolean> => {
//     try {
//         const roleInfo = await getUserEventRole(userId, eventId);

//         if (!roleInfo || !roleInfo.permissions) {
//             return false;
//         }

//         return roleInfo.permissions[permission] === true;
//     } catch (error) {
//         logger.error('Error checking event permission:', error);
//         return false;
//     }
// };
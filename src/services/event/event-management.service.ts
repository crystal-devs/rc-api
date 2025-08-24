// ====================================
// 5. services/event/event-management.service.ts
// ====================================

import {
    processLocationData,
    processCoverImageData,
    processPermissionsData,
    processShareSettingsData,
    handleVisibilityTransition
} from './event-utils.service';

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

        // Share token validation
        if (updateData.share_token !== undefined && updateData.share_token !== currentEvent.share_token) {
            if (updateData.share_token && !/^evt_[a-zA-Z0-9]{6}$/.test(updateData.share_token)) {
                throw new Error('Invalid share token format');
            }
            processed.share_token = updateData.share_token;
        }

        // Co-host invite token handling
        if (updateData.co_host_invite_token !== undefined) {
            processed.co_host_invite_token = processCoHostInviteTokenData(updateData.co_host_invite_token);
        }

        // PhotoWall settings processing
        if (updateData.photowall_settings !== undefined) {
            const photowallSettings = processPhotowallSettings(updateData.photowall_settings);
            if (photowallSettings) {
                // Use dot notation for nested updates
                Object.keys(photowallSettings).forEach(key => {
                    processed[`photowall_settings.${key}`] = photowallSettings[key];
                });
            }
        }

        // Always update the timestamp
        processed.updated_at = new Date();

        return processed;
    } catch (error: any) {
        throw new Error(`Data processing failed: ${error.message}`);
    }
};

const processCoHostInviteTokenData = (tokenData: any): any => {
    if (!tokenData || typeof tokenData !== 'object') {
        throw new Error('Invalid co-host invite token data');
    }

    const processed: any = {};

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

export const processPhotowallSettings = (photowallData: any): any => {
    if (!photowallData || typeof photowallData !== 'object') {
        return null; // Let schema defaults handle it
    }

    const processed: any = {};
    const allowedFields = [
        'isEnabled', 'displayMode', 'transitionDuration', 
        'showUploaderNames', 'autoAdvance', 'newImageInsertion'
    ];

    allowedFields.forEach(field => {
        if (photowallData[field] !== undefined) {
            switch (field) {
                case 'isEnabled':
                case 'showUploaderNames':
                case 'autoAdvance':
                    processed[field] = Boolean(photowallData[field]);
                    break;
                
                case 'displayMode':
                    const validModes = ['slideshow', 'grid', 'mosaic'];
                    if (validModes.includes(photowallData[field])) {
                        processed[field] = photowallData[field];
                    }
                    break;
                
                case 'transitionDuration':
                    const duration = Number(photowallData[field]);
                    if (duration >= 2000 && duration <= 30000) {
                        processed[field] = duration;
                    }
                    break;
                
                case 'newImageInsertion':
                    const validStrategies = ['immediate', 'after_current', 'end_of_queue', 'smart_priority'];
                    if (validStrategies.includes(photowallData[field])) {
                        processed[field] = photowallData[field];
                    }
                    break;
            }
        }
    });

    return Object.keys(processed).length > 0 ? processed : null;
};
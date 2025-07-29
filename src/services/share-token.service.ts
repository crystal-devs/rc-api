// services/share-token.service.ts

import mongoose from "mongoose";
import { Event } from "@models/event.model";
import { logger } from "@utils/logger";

// ============= TYPES =============
type UserRole = 'guest' | 'owner' | 'co_host';
type EventVisibility = 'anyone_with_link' | 'invited_only' | 'private';

interface UserAccess {
    canJoin: boolean;
    requiresAuth: boolean;
    role: UserRole;
    isOwner: boolean;
    isCoHost: boolean;
}

interface EventResponse {
    _id: string;
    title: string;
    description: string;
    start_date: string;
    visibility: EventVisibility;
    cover_image?: { url: string } | null;
    location?: { name: string } | null;
    permissions?: {
        can_upload: boolean;
        can_download: boolean;
        require_approval: boolean;
    };
}

// ============= MAIN SERVICE FUNCTIONS =============

export const getShareTokenDetailsService = async ({
    tokenId,
    requesterId,
}: {
    tokenId: string;
    requesterId?: string;
}) => {
    try {
        // Find event by share_token - only select necessary fields
        const event = await Event.findOne({ 
            share_token: tokenId 
        })
        .select('_id title description start_date location cover_image visibility share_settings permissions created_by co_hosts')
        .lean();

        if (!event) {
            return {
                status: false,
                code: 404,
                message: 'Share token not found',
                data: null,
                error: { message: 'Invalid share token' },
                other: null,
            };
        }

        // Validate share settings
        const validationError = validateShareSettings(event.share_settings);
        if (validationError) {
            return validationError;
        }

        // Determine user access level for response
        const userAccess = determineUserAccess(event, requesterId);

        // Build clean response based on visibility and user access
        const eventResponse = buildEventResponse(event, userAccess);

        return {
            status: true,
            code: 200,
            message: 'Event details retrieved successfully',
            data: {
                event: eventResponse,
                access: {
                    canJoin: userAccess.canJoin,
                    requiresAuth: userAccess.requiresAuth,
                    role: userAccess.role
                }
            },
            error: null,
            other: null,
        };

    } catch (error: any) {
        logger.error(`[getShareTokenDetailsService] Error: ${error.message}`);
        return {
            status: false,
            code: 500,
            message: 'Failed to retrieve event details',
            data: null as any,
            error: { message: error.message },
            other: null as any,
        };
    }
};

export const validateGuestShareToken = async (
    shareToken: string,
    userEmail?: string,
    authToken?: string
): Promise<{
    valid: boolean;
    reason?: string;
    event_id?: string;
    permissions?: any;
    eventData?: any;
    requiresAuth?: boolean;
    visibility?: EventVisibility;
}> => {
    try {
        // Find event by share_token
        const event = await Event.findOne({ share_token: shareToken })
            .populate([
                {
                    path: 'created_by',
                    select: 'name email avatar_url',
                },
                {
                    path: 'co_hosts.user_id',
                    select: 'name email avatar_url',
                }
            ])
            .lean();

        if (!event) {
            return { valid: false, reason: "Share token not found" };
        }

        // Validate share settings
        const validationError = validateShareSettings(event.share_settings);
        if (validationError) {
            return { valid: false, reason: validationError.message };
        }

        const visibility = event.visibility as EventVisibility;

        // Handle different visibility levels
        const accessCheck = checkVisibilityAccess(visibility, authToken, userEmail);
        if (!accessCheck.valid) {
            return {
                valid: false,
                reason: accessCheck.reason,
                requiresAuth: accessCheck.requiresAuth,
                visibility
            };
        }

        // Set guest permissions
        const permissions = {
            view: event.permissions?.can_view ?? true,
            upload: event.permissions?.can_upload ?? false,
            download: event.permissions?.can_download ?? true,
            moderate: false, // Guests can't moderate
            delete: false,   // Guests can't delete
            requireApproval: event.permissions?.require_approval ?? false
        };

        return {
            valid: true,
            event_id: event._id.toString(),
            permissions,
            visibility,
            eventData: {
                _id: event._id.toString(),
                title: event.title,
                description: event.description,
                cover_image: event.cover_image,
                location: event.location,
                start_date: event.start_date,
                end_date: event.end_date,
                template: event.template,
                permissions: event.permissions,
                share_settings: event.share_settings,
                created_by: event.created_by
            }
        };
    } catch (error: any) {
        logger.error('validateGuestShareToken error:', error);
        return { valid: false, reason: "Token validation error" };
    }
};

// ============= HELPER FUNCTIONS =============

function validateShareSettings(shareSettings: any) {
    if (!shareSettings?.is_active) {
        return {
            status: false,
            code: 403,
            message: 'Share link is inactive',
            data: null as any,
            error: { message: 'This share link has been deactivated' },
            other: null as any,
        };
    }

    if (shareSettings?.expires_at && new Date(shareSettings.expires_at) < new Date()) {
        return {
            status: false,
            code: 403,
            message: 'Share link has expired',
            data: null,
            error: { message: 'This invitation has expired' },
            other: null,
        };
    }

    return null;
}

function determineUserAccess(event: any, requesterId?: string): UserAccess {
    const access: UserAccess = {
        canJoin: false,
        requiresAuth: false,
        role: 'guest',
        isOwner: false,
        isCoHost: false
    };

    // Check if user is owner or co-host
    if (requesterId) {
        if (event.created_by && event.created_by.toString() === requesterId) {
            access.isOwner = true;
            access.role = 'owner';
        } else if (event.co_hosts && event.co_hosts.length > 0) {
            const coHost = event.co_hosts.find(
                (ch: any) => ch.user_id.toString() === requesterId && ch.status === 'approved'
            );
            if (coHost) {
                access.isCoHost = true;
                access.role = 'co_host';
            }
        }
    }

    // Determine access based on visibility
    switch (event.visibility) {
        case 'anyone_with_link':
            access.canJoin = true;
            access.requiresAuth = false;
            break;

        case 'invited_only':
            access.canJoin = !!requesterId; // Can join if authenticated
            access.requiresAuth = !requesterId; // Requires auth if not authenticated
            break;

        case 'private':
            access.canJoin = access.isOwner || access.isCoHost;
            access.requiresAuth = !requesterId;
            break;
    }

    return access;
}

function buildEventResponse(event: any, userAccess: UserAccess): EventResponse {
    // Base event info that's always safe to share
    const baseResponse: EventResponse = {
        _id: event._id,
        title: event.title,
        description: event.description || '',
        start_date: event.start_date,
        visibility: event.visibility,
        cover_image: event.cover_image?.url ? {
            url: event.cover_image.url
        } : null,
        location: event.location?.name ? {
            name: event.location.name
        } : null,
    };

    // Add permissions only if user can join
    if (userAccess.canJoin) {
        baseResponse.permissions = {
            can_upload: event.permissions?.can_upload || false,
            can_download: event.permissions?.can_download || false,
            require_approval: event.permissions?.require_approval || false
        };
    }

    return baseResponse;
}

function checkVisibilityAccess(
    visibility: EventVisibility, 
    authToken?: string, 
    userEmail?: string
): { valid: boolean; reason?: string; requiresAuth?: boolean } {
    switch (visibility) {
        case 'private':
            // Private events should not be accessible via share token for guests
            return {
                valid: false,
                reason: "This is a private event. Please use the direct event link if you're an owner or co-host."
            };

        case 'invited_only':
            // Invite-only requires authentication
            if (!authToken || !userEmail) {
                return {
                    valid: false,
                    reason: "This event requires you to log in to access.",
                    requiresAuth: true
                };
            }

            // Check if user is invited (simplified - returns true for now)
            const isInvited = checkIfUserIsInvited(userEmail);
            if (!isInvited) {
                return {
                    valid: false,
                    reason: "You are not invited to this event. Please contact the event host for access."
                };
            }
            break;

        case 'anyone_with_link':
        default:
            // Anyone with link can access without authentication
            break;
    }

    return { valid: true };
}

// Simplified function - returns true for now as mentioned
function checkIfUserIsInvited(userEmail: string): boolean {
    // TODO: Add invited user logic later
    // For now, any authenticated user can access invited_only events
    return true;
}

// ============= LEGACY SUPPORT (if needed) =============

export const validateShareToken = async (shareToken: string): Promise<{
    valid: boolean;
    reason?: string;
    event_id?: string;
    permissions?: any;
    shareToken?: any;
}> => {
    try {
        const event = await Event.findOne({ share_token: shareToken })
            .populate([
                {
                    path: 'created_by',
                    select: 'name email avatar_url',
                }
            ])
            .lean();

        if (!event) {
            return { valid: false, reason: "Share token not found" };
        }

        const validationError = validateShareSettings(event.share_settings);
        if (validationError) {
            return { valid: false, reason: validationError.message };
        }

        if (!event.permissions?.can_view) {
            return { valid: false, reason: "Viewing this event is not allowed" };
        }

        return {
            valid: true,
            event_id: event._id.toString(),
            permissions: {
                view: event.permissions.can_view,
                upload: event.permissions.can_upload,
                download: event.permissions.can_download,
                moderate: false,
                delete: false,
                requireApproval: event.permissions.require_approval
            },
            shareToken: {
                token: shareToken,
                event_id: event._id,
                permissions: event.permissions,
                share_settings: event.share_settings
            }
        };
    } catch (error: any) {
        logger.error('validateShareToken error:', error);
        return { valid: false, reason: "Token validation error" };
    }
};
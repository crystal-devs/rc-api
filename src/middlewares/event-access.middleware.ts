// middlewares/event-access.middleware.ts
import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";
import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
import { EventInvitation } from "@models/event-invitations.model";
import { User } from "@models/user.model";
import { normalizeRole } from "@utils/role.utils";
import bcrypt from "bcryptjs";
import {
    Action,
    EventGuestSettings,
    PolicyRole,
    effectivePermissions
} from "@configs/permissions.policy";

// Clean role types — three canonical roles plus the synthetic token-access role
export type EventRole = 'creator' | 'co_host' | 'guest' | 'authenticated_guest';

// FIXED: Updated EventAccess interface to match actual usage
export interface EventAccess {
    eventId: string;
    role: EventRole;
    participantId?: string; // Made optional since token access won't have this
    canView: boolean;
    canUpload: boolean;
    canDownload: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canManageParticipants: boolean;
    canInviteOthers: boolean;
    canModerateContent: boolean;
    canApproveContent: boolean;
    canExportData: boolean;
    canManageSettings: boolean;
    canViewAnalytics: boolean;
    canTransferOwnership: boolean;
    // Legacy aliases
    canManageGuests: boolean;
    canManageContent: boolean;
    // Context - made optional for token access
    joinMethod?: string;
    joinedAt?: Date;
    lastActivity?: Date;
    // RBAC (computed per request from ROLE_POLICY — see configs/permissions.policy.ts
    // and rc-frontend/docs/RBAC_DESIGN.md). Attached by attachPolicy(); the
    // legacy boolean fields above are deprecated in favour of can().
    permissions?: ReadonlySet<Action>;
    can?: (action: Action) => boolean;
}

/**
 * Attach the computed permission set for this role (and, for guests, this
 * event's host-configured toggles) to an access object. Single place where
 * role → permissions is resolved on the request path.
 */
export function attachPolicy(
    access: EventAccess,
    guestSettings?: EventGuestSettings | null
): EventAccess {
    const permissions = effectivePermissions(access.role as PolicyRole, guestSettings);
    access.permissions = permissions;
    access.can = (action: Action) => permissions.has(action);

    // Overwrite the legacy boolean fields from the computed policy so the
    // stored per-participant permission blob (drift-prone, being removed —
    // see rc-frontend/docs/RBAC_DESIGN.md Phase 3) no longer influences any
    // request-path decision. Prefer access.can(action) in new code.
    access.canView = permissions.has('event.view');
    access.canUpload = permissions.has('media.upload');
    access.canDownload = permissions.has('media.download');
    access.canEdit = permissions.has('event.update');
    access.canDelete = permissions.has('event.delete');
    access.canManageParticipants = permissions.has('participants.manage');
    access.canInviteOthers = permissions.has('participants.invite');
    access.canModerateContent = permissions.has('media.approve');
    access.canApproveContent = permissions.has('media.approve');
    access.canExportData = permissions.has('data.export');
    access.canManageSettings = permissions.has('event.update');
    access.canViewAnalytics = permissions.has('analytics.view');
    access.canTransferOwnership = permissions.has('event.transfer');
    access.canManageGuests = permissions.has('participants.manage');
    access.canManageContent = permissions.has('media.approve');

    return access;
}

/** Coerce a lean Mongo date field (Date | string | number) to a Date. */
function toDate(value: unknown): Date | undefined {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return undefined;
}

/**
 * Build an EventAccess shell for a role. Every capability boolean starts false;
 * attachPolicy() is the only thing that sets them (from the RBAC policy), so
 * callers MUST run attachPolicy() before the object drives any decision. This
 * keeps the deprecated per-participant permission blob off the request path.
 */
function baseEventAccess(
    eventId: string,
    role: EventRole,
    extra?: Pick<Partial<EventAccess>, 'participantId' | 'joinMethod' | 'joinedAt' | 'lastActivity'>
): EventAccess {
    return {
        eventId,
        role,
        participantId: extra?.participantId,
        canView: false,
        canUpload: false,
        canDownload: false,
        canEdit: false,
        canDelete: false,
        canManageParticipants: false,
        canInviteOthers: false,
        canModerateContent: false,
        canApproveContent: false,
        canExportData: false,
        canManageSettings: false,
        canViewAnalytics: false,
        canTransferOwnership: false,
        canManageGuests: false,
        canManageContent: false,
        joinMethod: extra?.joinMethod,
        joinedAt: extra?.joinedAt,
        lastActivity: extra?.lastActivity,
    };
}

/**
 * Middleware to check if user has access to an event
 * Adds event access info to req.eventAccess
 */
export const eventAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        // Get event_id from params - handle different route patterns
        const event_id = req.params.event_id || req.params.eventId || req.params.id;
        const userId = req.user._id.toString();

        // Validate event_id
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Valid event ID is required",
                data: null,
                error: { message: "Missing or invalid event ID in request params" },
                other: null
            });
        }

        // Only the guest-settings subdocument is consulted here (attachPolicy →
        // effectivePermissions). Project to it so this per-request fetch stays
        // cheap; routes that need the full event fetch it themselves.
        const event = await Event.findById(event_id).select('permissions').lean();

        if (!event) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: { message: "Event not found" },
                other: null
            });
        }

        // Get user's active participant record. Role is all we need — capabilities
        // come from the policy, not the stored permission blob (RBAC Phase 3).
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(event_id),
            status: 'active'
        }).select('role join_method joined_at last_activity_at').lean();

        if (!participant) {
            return sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have access to this event",
                data: null,
                error: { message: "Access denied - not an active participant" },
                other: null
            });
        }

        req.eventAccess = attachPolicy(
            baseEventAccess(event_id, normalizeRole(participant.role), {
                participantId: participant._id?.toString(),
                joinMethod: typeof participant.join_method === 'string' ? participant.join_method : undefined,
                // Fall back to now (matches prior behavior); both fields are
                // schema-required with Date.now defaults, so this is defensive.
                joinedAt: toDate(participant.joined_at) ?? new Date(),
                lastActivity: toDate(participant.last_activity_at) ?? new Date(),
            }),
            event.permissions as EventGuestSettings
        );
        next();
    } catch (error: any) {
        logger.error(`[eventAccessMiddleware] ${error.message}`, { stack: error.stack });
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Error checking event access",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        });
    }
};

/**
 * Token access middleware for guest pages
 * Handles both authenticated and unauthenticated users
 */
export const tokenAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { token_id } = req.params;

        if (!token_id || typeof token_id !== 'string') {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Valid token ID is required',
                data: null,
                error: { message: 'Invalid or missing token ID' },
                other: null,
            });
        }

        // Find event by share_token
        const event = await Event.findOne({ share_token: token_id })
            // share_settings subfields listed explicitly: selecting the parent
            // path together with +share_settings.password is a Mongo path
            // collision; the PIN hash must be opted into for the compare below.
            .select('_id title visibility permissions created_by share_settings.is_active share_settings.expires_at share_settings.has_password +share_settings.password')
            .lean();

        if (!event) {
            logger.warn(`[tokenAccessMiddleware] Share token ${token_id} not found`);
            return sendResponse(res, {
                status: false,
                code: 404,
                message: 'Share token not found',
                data: null,
                error: { message: 'Token not found' },
                other: null,
            });
        }

        const eventId = event._id.toString();

        // Validate share settings
        const validationError = validateShareSettings(event.share_settings, token_id, eventId);
        if (validationError) {
            return sendResponse(res, validationError);
        }

        // Check password if required
        const passwordError = checkEventPassword(event.share_settings, req.headers['x-event-password'], token_id);
        if (passwordError) {
            return sendResponse(res, passwordError);
        }

        // Get user ID if authenticated (optional)
        const userId = req.user?._id?.toString();

        // Handle visibility-based access with optional user
        const accessResult = await handleEventVisibility(event, userId);
        if (!accessResult.success) {
            return sendResponse(res, accessResult.error);
        }

        // Set clean event access
        req.eventAccess = attachPolicy(
            accessResult.eventAccess!,
            event.permissions as EventGuestSettings
        );
        logger.info(`[tokenAccessMiddleware] Access granted: ${accessResult.eventAccess!.role} for token ${token_id}`);

        next();
    } catch (error: any) {
        logger.error(`[tokenAccessMiddleware] Error: ${error.message}`);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: 'Error checking token access',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};

// ============= HELPER FUNCTIONS =============

function validateShareSettings(shareSettings: any, tokenId: string, eventId: string): any {
    if (!shareSettings?.is_active) {
        logger.warn(`[tokenAccessMiddleware] Share token ${tokenId} is inactive for event ${eventId}`);
        return {
            status: false,
            code: 403,
            message: 'Share token is inactive',
            data: null as any,
            error: { message: 'Token is inactive' },
            other: null as any,
        };
    }

    if (shareSettings?.expires_at && new Date(shareSettings.expires_at) < new Date()) {
        logger.warn(`[tokenAccessMiddleware] Share token ${tokenId} has expired for event ${eventId}`);
        return {
            status: false,
            code: 403,
            message: 'Share token has expired',
            data: null as any,
            error: { message: 'Token has expired' },
            other: null as any,
        };
    }

    return null;
}

function checkEventPassword(shareSettings: any, providedPassword: any, tokenId: string): any {
    if (shareSettings?.password) {
        const matches = typeof providedPassword === 'string'
            && bcrypt.compareSync(providedPassword, shareSettings.password);
        if (!matches) {
            logger.warn(`[tokenAccessMiddleware] Password required for token ${tokenId}`);
            return {
                status: false,
                code: 401,
                message: 'Password required',
                data: null as any,
                error: { message: 'password_required' },
                other: null as any,
            };
        }
    }
    return null;
}

async function handleEventVisibility(event: any, userId?: string): Promise<{
    success: boolean;
    eventAccess?: EventAccess;
    error?: any;
}> {
    const eventId = event._id.toString();

    // Capability booleans are set by attachPolicy() at the call site — these
    // branches only resolve the role (and, for private events, the participant).
    switch (event.visibility) {
        case 'anyone_with_link':
            return {
                success: true,
                eventAccess: baseEventAccess(eventId, 'guest')
            };

        case 'invited_only':
            if (!userId) {
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 401,
                        message: 'Authentication required',
                        data: null as any,
                        error: { message: 'You must be logged in to access this event' },
                        other: null as any,
                    }
                };
            }

            // Check if user is invited or already a participant
            try {
                const user = await User.findById(userId).select('email').lean();
                if (!user?.email) {
                    return {
                        success: false,
                        error: {
                            status: false,
                            code: 403,
                            message: 'Access denied',
                            data: null as any,
                            error: { message: 'Unable to verify user identity' },
                            other: null as any,
                        }
                    };
                }

                // Check if user is already a participant
                const existingParticipant = await EventParticipant.findOne({
                    user_id: new mongoose.Types.ObjectId(userId),
                    event_id: new mongoose.Types.ObjectId(eventId),
                    status: 'active'
                }).lean();

                let isInvited = false;
                if (existingParticipant) {
                    isInvited = true;
                } else {
                    // Check for pending/accepted invitations
                    const invitation = await EventInvitation.findOne({
                        event_id: new mongoose.Types.ObjectId(eventId),
                        invitee_email: user.email,
                        status: { $in: ['pending', 'accepted'] },
                        expires_at: { $gt: new Date() }
                    }).lean();

                    isInvited = !!invitation;
                }

                if (!isInvited) {
                    return {
                        success: false,
                        error: {
                            status: false,
                            code: 403,
                            message: 'Access denied',
                            data: null as any,
                            error: { message: 'You are not invited to this event' },
                            other: null as any,
                        }
                    };
                }

                return {
                    success: true,
                    eventAccess: baseEventAccess(eventId, 'authenticated_guest')
                };
            } catch (error) {
                logger.error(`[handleEventVisibility] Error checking invitation: ${(error as Error).message}`);
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 500,
                        message: 'Error checking access',
                        data: null as any,
                        error: { message: 'Internal server error' },
                        other: null as any,
                    }
                };
            }

        case 'private':
            if (!userId) {
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 403,
                        message: 'This event is private',
                        data: null as any,
                        error: { message: 'This event is private and not accessible' },
                        other: null as any,
                    }
                };
            }

            // For private events, check via EventParticipant model
            const participant = await EventParticipant.findOne({
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: new mongoose.Types.ObjectId(eventId),
                status: 'active'
            }).select('role join_method joined_at last_activity_at').lean();

            if (
                !participant ||
                typeof participant.role !== 'string' ||
                !['creator', 'co_host'].includes(participant.role)
            ) {
                return {
                    success: false,
                    error: {
                        status: false,
                        code: 403,
                        message: 'Access denied to private event',
                        data: null as any,
                        error: { message: 'This event is private and you don\'t have access' },
                        other: null as any,
                    }
                };
            }

            return {
                success: true,
                eventAccess: baseEventAccess(eventId, normalizeRole(participant.role), {
                    participantId: participant._id?.toString(),
                    joinMethod: typeof participant.join_method === 'string' ? participant.join_method : undefined,
                    joinedAt: toDate(participant.joined_at),
                    lastActivity: toDate(participant.last_activity_at),
                })
            };

        default:
            return {
                success: false,
                error: {
                    status: false,
                    code: 400,
                    message: 'Invalid event configuration',
                    data: null as any,
                    error: { message: 'Unknown event visibility type' },
                    other: null as any,
                }
            };
    }
}

// Update your injectedRequest type
declare module "types/injected-types" {
    interface injectedRequest {
        eventAccess?: EventAccess;
    }
}
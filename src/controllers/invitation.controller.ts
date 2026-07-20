// =================================================================
// controllers/invitation.controller.ts - Invitation Management
// =================================================================

import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { sendResponse, handleControllerError } from "@utils/express.util";
import { normalizeRole } from "@utils/role.utils";
import { EventInvitation } from "@models/event-invitations.model";
import { Event } from "@models/event.model";

// Input validation helper
const validateObjectId = (id: string, fieldName: string) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Valid ${fieldName} is required`);
    }
};

// Send invitations (simple format)
export const sendInvitationsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const { emails, role = 'guest', personalMessage, expiresInHours = 168 } = req.body;
        const invitedBy = req.user._id.toString();

        validateObjectId(event_id, 'event ID');

        // Validate emails array
        if (!Array.isArray(emails) || emails.length === 0) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Emails array is required and cannot be empty',
                data: null
            });
        }

        if (emails.length > 50) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Cannot invite more than 50 people at once',
                data: null
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        for (const email of emails) {
            if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
                return sendResponse(res, {
                    status: false,
                    code: 400,
                    message: `Invalid email format: ${email}`,
                    data: null
                });
            }
        }

        // Validate role (legacy values accepted, normalized to co_host/guest below)
        if (!['co_host', 'moderator', 'guest', 'viewer'].includes(role)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Invalid role. Use: co_host, guest',
                data: null
            });
        }

        // Validate expiresInHours
        const parsedHours = parseInt(expiresInHours, 10);
        if (isNaN(parsedHours) || parsedHours < 1 || parsedHours > 8760) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'expiresInHours must be between 1 and 8760 (1 year)',
                data: null
            });
        }

        // Check if event exists and user has permission
        const event = await Event.findById(event_id);
        if (!event) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: 'Event not found',
                data: null
            });
        }

        // Create invitations
        const expiresAt = new Date(Date.now() + parsedHours * 60 * 60 * 1000);
        const invitations = [];

        for (const email of emails) {
            const invitation = await EventInvitation.create({
                event_id: new mongoose.Types.ObjectId(event_id),
                invitation_type: 'email',
                invitee_email: email,
                invited_by: new mongoose.Types.ObjectId(invitedBy),
                intended_role: normalizeRole(role),
                expires_at: expiresAt,
                personal_message: personalMessage || null
            });
            invitations.push(invitation);
        }

        sendResponse(res, {
            status: true,
            code: 201,
            message: `Successfully sent ${invitations.length} invitation(s)`,
            data: {
                invitations: invitations.map(inv => ({
                    id: inv._id,
                    email: inv.invitee_email,
                    role: inv.intended_role,
                    status: inv.status,
                    expires_at: inv.expires_at,
                    sent_at: inv.sent_at
                }))
            }
        });

    } catch (error) {
        logger.error('Error in sendInvitationsController:', error);
        handleControllerError(res, error, 'sendInvitationsController');
    }
};

// Get event invitations
export const getEventInvitationsController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id } = req.params;
        const { status, page = '1', limit = '20' } = req.query;

        validateObjectId(event_id, 'event ID');

        // Parse pagination
        const parsedPage = parseInt(page as string, 10);
        const parsedLimit = Math.min(parseInt(limit as string, 10), 100);

        if (isNaN(parsedPage) || parsedPage < 1) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Page must be a positive integer',
                data: null
            });
        }

        // Build query
        const query: any = { event_id: new mongoose.Types.ObjectId(event_id) };

        if (status) {
            if (Array.isArray(status)) {
                query.status = { $in: status };
            } else {
                query.status = status;
            }
        }

        // Get invitations with pagination
        const invitations = await EventInvitation.find(query)
            .populate('invited_by', 'name email')
            .sort({ sent_at: -1 })
            .skip((parsedPage - 1) * parsedLimit)
            .limit(parsedLimit)
            .lean();

        const total = await EventInvitation.countDocuments(query);

        sendResponse(res, {
            status: true,
            code: 200,
            message: 'Invitations retrieved successfully',
            data: {
                invitations: invitations.map(inv => ({
                    id: inv._id,
                    email: inv.invitee_email,
                    role: inv.intended_role,
                    status: inv.status,
                    sent_at: inv.sent_at,
                    expires_at: inv.expires_at,
                    invited_by: inv.invited_by,
                    personal_message: inv.personal_message
                })),
                pagination: {
                    page: parsedPage,
                    limit: parsedLimit,
                    total,
                    pages: Math.ceil(total / parsedLimit)
                }
            }
        });

    } catch (error) {
        logger.error('Error in getEventInvitationsController:', error);
        handleControllerError(res, error, 'getEventInvitationsController');
    }
};

// Revoke invitation
export const revokeInvitationController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { event_id, invitation_id } = req.params;

        validateObjectId(event_id, 'event ID');
        validateObjectId(invitation_id, 'invitation ID');

        const invitation = await EventInvitation.findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(invitation_id),
                event_id: new mongoose.Types.ObjectId(event_id),
                status: { $in: ['pending', 'accepted'] }
            },
            { status: 'revoked' },
            { new: true }
        );

        if (!invitation) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: 'Invitation not found or already processed',
                data: null
            });
        }

        sendResponse(res, {
            status: true,
            code: 200,
            message: 'Invitation revoked successfully',
            data: {
                invitation: {
                    id: invitation._id,
                    email: invitation.invitee_email,
                    status: invitation.status
                }
            }
        });

    } catch (error) {
        logger.error('Error in revokeInvitationController:', error);
        handleControllerError(res, error, 'revokeInvitationController');
    }
};
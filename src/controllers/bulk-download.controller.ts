import { Request, Response, NextFunction } from "express";
import { sendResponse } from "@utils/express.util";
import { trimObject } from "@utils/sanitizers.util";
import { injectedRequest } from "types/injected-types";
import { createBulkDownloadService, getBulkDownloadStatusService } from "@services/media/bulk-download.service";
import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
import { isAdminRole } from "@utils/role.utils";
import mongoose from "mongoose";
import { logger } from "@utils/logger";

// Per-role download quality (Phase 3). Hosts (creator/co-host) get originals;
// everyone else is capped to the ~1600px "large" tier. Enforced server-side so a
// guest can't request 'original'.
const GUEST_MAX_QUALITY = 'large';
const capQualityForRole = (requested: string, isHost: boolean): string => {
    const q = requested || 'original';
    if (isHost) return q;
    // Non-hosts never receive originals.
    return q === 'original' ? GUEST_MAX_QUALITY : q;
};

export const createBulkDownloadController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        // Extract parameters from body or URL params
        const shareTokenFromUrl = req.params.shareToken;
        const { eventId, shareToken: shareTokenFromBody, quality = "original" } = trimObject(req.body);

        // Use share token from URL if available (guest route), otherwise from body
        const shareToken = shareTokenFromUrl || shareTokenFromBody;

        console.info(`[createBulkDownloadController] Creating bulk download for event ${eventId}`);

        // Validate required fields
        if (!eventId) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Event ID is required',
                data: null,
                error: { message: 'eventId is required' },
                other: null,
            });
        }

        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: 'Invalid event ID format',
                data: null,
                error: { message: 'Invalid ObjectId format' },
                other: null,
            });
        }

        // Get event details to check permissions
        const event = await Event.findById(eventId).select('permissions visibility share_token').lean();
        if (!event) {
            return sendResponse(res, {
                status: false,
                code: 404,
                message: 'Event not found',
                data: null,
                error: { message: 'Event does not exist' },
                other: null,
            });
        }

        // Check if bulk download is allowed for this event
        if (!event.permissions?.can_download) {
            return sendResponse(res, {
                status: false,
                code: 403,
                message: 'Bulk download not allowed for this event',
                data: null,
                error: { message: 'Event permissions do not allow downloads' },
                other: null,
            });
        }

        // Determine requester type and validate access
        let requestedById: string;
        let requestedByType: string;

        // Check if user is authenticated
        const userId = req.user?._id?.toString();

        // Is the requester a host (creator/co-host)? Determines download quality.
        let isHost = false;

        if (userId) {
            // Authenticated user - check if they have access to this event
            requestedById = userId;
            requestedByType = 'authenticated_user';

            const participant = await EventParticipant.findOne({
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: new mongoose.Types.ObjectId(eventId),
                status: 'active'
            }).select('role').lean();
            isHost = !!participant && isAdminRole(participant.role);

            // For private events, verify user has access
            if (event.visibility === 'private') {
                // Additional participant check would go here if needed
                logger.info(`[createBulkDownloadController] Authenticated user ${userId} requesting download for private event ${eventId}`);
            }
        } else {
            // Guest user - validate share token
            if (!shareToken) {
                return sendResponse(res, {
                    status: false,
                    code: 401,
                    message: 'Authentication required',
                    data: null,
                    error: { message: 'Share token required for guest downloads' },
                    other: null,
                });
            }

            // Validate share token matches event
            if (event.share_token !== shareToken) {
                return sendResponse(res, {
                    status: false,
                    code: 403,
                    message: 'Invalid share token',
                    data: null,
                    error: { message: 'Share token does not match event' },
                    other: null,
                });
            }

            // For invited_only events, guests must be authenticated
            if (event.visibility === 'invited_only') {
                return sendResponse(res, {
                    status: false,
                    code: 401,
                    message: 'Authentication required',
                    data: null,
                    error: { message: 'This event requires authentication' },
                    other: null,
                });
            }

            requestedById = `guest_${shareToken}`;
            requestedByType = 'guest';
        }

        // Cap the requested quality by role (guests never get originals).
        const effectiveQuality = capQualityForRole(quality, isHost);
        if (effectiveQuality !== quality) {
            logger.info(`[createBulkDownloadController] Capped download quality '${quality}' -> '${effectiveQuality}' for non-host requester`);
        }

        const response = await createBulkDownloadService({
            eventId,
            shareToken,
            requestedById,
            requestedByType,
            quality: effectiveQuality
        });

        sendResponse(res, response);
    } catch (error) {
        console.error(`[createBulkDownloadController] Error: ${error.message}`);
        sendResponse(res, {
            status: false,
            code: 500,
            message: 'Failed to create bulk download',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};

export const getBulkDownloadStatusController = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { jobId } = trimObject(req.params);

        console.info(`[getBulkDownloadStatusController] Fetching status for job ${jobId}`);

        if (!jobId) {
            throw new Error('Valid job ID is required');
        }

        const response = await getBulkDownloadStatusService({ jobId });

        sendResponse(res, response);
    } catch (error) {
        console.error(`[getBulkDownloadStatusController] Error: ${error.message}`);
        sendResponse(res, {
            status: false,
            code: 500,
            message: 'Failed to get bulk download status',
            data: null,
            error: { message: error.message },
            other: null,
        });
    }
};
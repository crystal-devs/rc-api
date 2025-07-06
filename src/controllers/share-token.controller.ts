import { Request, Response, NextFunction } from "express";
import * as shareTokenService from "@services/share-token.service";
import { sendResponse } from "@utils/express.util";
import { trimObject } from "@utils/sanitizers.util";
import mongoose from "mongoose";
import { injectedRequest } from "types/injected-types";

// Create a new share token
export const createShareTokenController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id, album_id, permissions, expires_at, password } = trimObject(req.body);
        
        // Validate event_id
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid event ID",
                data: null,
                error: { message: "A valid event ID is required" },
                other: null
            });
        }
        
        // Validate album_id if provided
        if (album_id && !mongoose.Types.ObjectId.isValid(album_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid album ID",
                data: null,
                error: { message: "A valid album ID is required" },
                other: null
            });
        }
        
        // Validate permissions
        if (!permissions || typeof permissions !== 'object') {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid permissions",
                data: null,
                error: { message: "Valid permissions object is required" },
                other: null
            });
        }
        
        // Parse expires_at if provided
        let expirationDate = undefined;
        if (expires_at) {
            expirationDate = new Date(expires_at);
            if (isNaN(expirationDate.getTime())) {
                return sendResponse(res, {
                    status: false,
                    code: 400,
                    message: "Invalid expiration date",
                    data: null,
                    error: { message: "A valid date is required for expires_at" },
                    other: null
                });
            }
        }
        
        const response = await shareTokenService.createShareTokenService({
            event_id,
            album_id,
            permissions,
            expires_at: expirationDate,
            password
        }, req.user._id.toString());
        
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Validate a share token
export const validateShareTokenController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token, password } = trimObject(req.body);
        
        if (!token) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Token is required",
                data: null,
                error: { message: "Share token is required" },
                other: null
            });
        }
        
        // Get user_id from authenticated user if available
        const user_id = (req as any).user?._id?.toString();
        
        const response = await shareTokenService.validateShareTokenService(token, password, user_id);
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Get shared event content
export const getSharedEventController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = trimObject(req.params);
        const { password } = trimObject(req.body);
        
        if (!token) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Token is required",
                data: null,
                error: { message: "Share token is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.getSharedEventService(token, password);
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Revoke a share token
export const revokeShareTokenController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        
        if (!token_id || !mongoose.Types.ObjectId.isValid(token_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.revokeShareTokenService(
            token_id,
            req.user._id.toString()
        );
        
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Get all share tokens for an event
export const getEventShareTokensController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { event_id } = trimObject(req.params);
        
        if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid event ID",
                data: null,
                error: { message: "A valid event ID is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.getEventShareTokensService(
            event_id,
            req.user._id.toString()
        );
        
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Get shared album media
export const getSharedAlbumMediaController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { album_id, token } = trimObject(req.params);
        const { password } = trimObject(req.body);
        
        if (!album_id || !mongoose.Types.ObjectId.isValid(album_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid album ID",
                data: null,
                error: { message: "A valid album ID is required" },
                other: null
            });
        }
        
        if (!token) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Token is required",
                data: null,
                error: { message: "Share token is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.getSharedAlbumMediaService(
            album_id,
            token,
            password
        );
        
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Create share token for an event (frontend compatibility)
export const createEventShareTokenController = async (req: injectedRequest, res: Response, next: NextFunction): Promise<any> => {
    try {
        console.log("Create event share token request received:", {
            params: req.params,
            body: req.body
        });
        
        // Get eventId from either params or body to support all frontend endpoints
        const eventId = req.params.eventId || req.body.eventId || req.body.event_id;
        const { type, albumId, permissions, expiresAt, password, isRestrictedToGuests, invitedGuests } = req.body;
        
        console.log("Using eventId:", eventId);
        
        // Validate event_id
        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                status: false,
                message: "Invalid event ID",
                error: { message: "A valid event ID is required" }
            });
        }
        
        // Map frontend permission format to backend format
        const mappedPermissions = {
            view: permissions?.canView ?? true,
            upload: permissions?.canUpload ?? false,
            download: permissions?.canDownload ?? true,
            share: permissions?.canShare ?? false
        };
        
        console.log("Mapped permissions:", mappedPermissions);
        
        // Call the service
        const response = await shareTokenService.createShareTokenService({
            event_id: eventId,
            album_id: albumId,
            permissions: mappedPermissions,
            expires_at: expiresAt ? new Date(expiresAt) : undefined,
            password,
            is_restricted_to_guests: isRestrictedToGuests === true,
            invited_guests: Array.isArray(invitedGuests) ? invitedGuests : undefined
        }, req.user._id.toString());
        
        console.log("Share token created:", response.status);
        
        // Transform response to match frontend expectations
        if (response.status && response.data) {
            const data = response.data;
            return res.json({
                status: true,
                data: {
                    id: data.id,
                    token: data.token,
                    eventId: data.eventId,
                    albumId: data.albumId,
                    permissions: {
                        canView: data.permissions.view,
                        canUpload: data.permissions.upload,
                        canDownload: data.permissions.download,
                        canShare: data.permissions.share
                    },
                    createdAt: data.createdAt,
                    expiresAt: data.expiresAt,
                    createdById: data.createdById,
                    usageCount: data.usageCount
                }
            });
        }
        
        // If there was an error, format it the way frontend expects
        if (!response.status) {
            return res.status(response.code || 500).json({
                status: false,
                message: response.message,
                error: response.error
            });
        }
        
        // Default response if we reach here
        return sendResponse(res, response);
    } catch (err) {
        console.error("Error creating event share token:", err);
        return res.status(500).json({
            status: false,
            message: "Failed to create share token",
            error: err instanceof Error ? err.message : "Unknown error"
        });
    }
};

// Add invited guests to a share token
export const addInvitedGuestsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        const { guests } = trimObject(req.body);
        
        if (!token_id || !mongoose.Types.ObjectId.isValid(token_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null
            });
        }
        
        if (!Array.isArray(guests) || guests.length === 0) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid guests list",
                data: null,
                error: { message: "A valid list of guest emails is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.addInvitedGuestsToShareTokenService(
            token_id,
            req.user._id.toString(),
            guests
        );
        
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Remove invited guests from a share token
export const removeInvitedGuestsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        const { guests } = trimObject(req.body);
        
        if (!token_id || !mongoose.Types.ObjectId.isValid(token_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null
            });
        }
        
        if (!Array.isArray(guests) || guests.length === 0) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid guests list",
                data: null,
                error: { message: "A valid list of guest emails is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.removeInvitedGuestsFromShareTokenService(
            token_id,
            req.user._id.toString(),
            guests
        );
        
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

// Check if a guest has access to a share token
export const checkGuestAccessController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token_id } = trimObject(req.params);
        const { email } = trimObject(req.body);
        
        if (!token_id || !mongoose.Types.ObjectId.isValid(token_id)) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null
            });
        }
        
        if (!email || typeof email !== 'string') {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Invalid email",
                data: null,
                error: { message: "A valid email address is required" },
                other: null
            });
        }
        
        const response = await shareTokenService.checkGuestAccessToShareTokenService(token_id, email);
        sendResponse(res, response);
    } catch (err) {
        next(err);
    }
};

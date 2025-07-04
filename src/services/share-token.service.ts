import { ShareToken, ShareTokenCreationType } from "@models/share-token.model";
import { ServiceResponse } from "types/service.types";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";

/**
 * Create a new share token for an event or album
 */
export const createShareTokenService = async (
    tokenData: {
        event_id: string;
        album_id?: string;
        permissions: {
            view: boolean;
            upload: boolean;
            download: boolean;
            share: boolean;
        };
        expires_at?: Date;
        password?: string;
    },
    user_id: string
): Promise<ServiceResponse<any>> => {
    try {
        console.log("Creating share token with data:", {
            event_id: tokenData.event_id,
            album_id: tokenData.album_id,
            permissions: tokenData.permissions,
            expires_at: tokenData.expires_at,
            has_password: !!tokenData.password,
            user_id
        });
        // Process the password if provided
        let password_hash = null;
        if (tokenData.password) {
            password_hash = await bcrypt.hash(tokenData.password, 10);
        }

        // Create token data
        const shareTokenData: any = {
            event_id: new mongoose.Types.ObjectId(tokenData.event_id),
            created_by: new mongoose.Types.ObjectId(user_id),
            permissions: {
                view: tokenData.permissions.view ?? true,
                upload: tokenData.permissions.upload ?? false,
                download: tokenData.permissions.download ?? false,
                share: tokenData.permissions.share ?? false,
            },
            expires_at: tokenData.expires_at || null,
            password_hash,
        };

        // Add album_id if provided
        if (tokenData.album_id) {
            shareTokenData.album_id = new mongoose.Types.ObjectId(tokenData.album_id);
        }

        // Create the share token
        const shareToken = await ShareToken.create(shareTokenData);
        
        console.log("Share token created successfully:", {
            id: shareToken._id.toString(),
            token: shareToken.token,
            event_id: shareToken.event_id.toString()
        });

        // Format response to match frontend expectations
        return {
            status: true,
            code: 201,
            message: "Share token created successfully",
            data: {
                id: shareToken._id.toString(),
                token: shareToken.token,
                eventId: shareToken.event_id.toString(),
                albumId: shareToken.album_id?.toString() || null,
                permissions: {
                    view: shareToken.permissions.view,
                    upload: shareToken.permissions.upload,
                    download: shareToken.permissions.download,
                    share: shareToken.permissions.share
                },
                createdAt: shareToken.created_at,
                expiresAt: shareToken.expires_at,
                createdById: shareToken.created_by.toString(),
                usageCount: shareToken.usage_count,
                isPasswordProtected: !!shareToken.password_hash
            },
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to create share token",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Validate a share token
 */
export const validateShareTokenService = async (
    tokenValue: string,
    password?: string
): Promise<ServiceResponse<any>> => {
    try {
        // Find the token
        const token = await ShareToken.findOne({ token: tokenValue });

        // Check if token exists
        if (!token) {
            return {
                status: false,
                code: 404,
                message: "Invalid share token",
                data: null,
                error: { message: "The provided share token does not exist" },
                other: null,
            };
        }

        // Check if token is revoked
        if (token.revoked) {
            return {
                status: false,
                code: 403,
                message: "Share token has been revoked",
                data: null,
                error: { message: "This share token has been revoked" },
                other: null,
            };
        }

        // Check if token is expired
        if (token.expires_at && new Date() > token.expires_at) {
            return {
                status: false,
                code: 403,
                message: "Share token has expired",
                data: null,
                error: { message: "This share token has expired" },
                other: null,
            };
        }

        // Check password if token is password protected
        if (token.password_hash) {
            if (!password) {
                return {
                    status: false,
                    code: 401,
                    message: "Password required",
                    data: null,
                    error: { message: "This share token is password protected" },
                    other: { requiresPassword: true },
                };
            }

            const isPasswordValid = await bcrypt.compare(password, token.password_hash);
            if (!isPasswordValid) {
                return {
                    status: false,
                    code: 401,
                    message: "Invalid password",
                    data: null,
                    error: { message: "The password provided is incorrect" },
                    other: { requiresPassword: true },
                };
            }
        }

        // Increment usage count
        token.usage_count += 1;
        await token.save();

        // Return token details
        return {
            status: true,
            code: 200,
            message: "Share token validated successfully",
            data: {
                id: token._id.toString(),
                token: token.token,
                eventId: token.event_id.toString(),
                albumId: token.album_id?.toString() || null,
                permissions: token.permissions,
                createdAt: token.created_at,
                expiresAt: token.expires_at,
                createdById: token.created_by.toString(),
                usageCount: token.usage_count
            },
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to validate share token",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Get shared event content
 */
export const getSharedEventService = async (
    tokenValue: string,
    password?: string
): Promise<ServiceResponse<any>> => {
    try {
        // First, validate the token
        const validationResult = await validateShareTokenService(tokenValue, password);
        
        if (!validationResult.status) {
            return validationResult;
        }
        
        const tokenData = validationResult.data;
        
        // Check if the token has view permission
        if (!tokenData.permissions.view) {
            return {
                status: false,
                code: 403,
                message: "Insufficient permissions",
                data: null,
                error: { message: "This share token does not have view permissions" },
                other: null,
            };
        }
        
        // Fetch the event data
        const eventData = await Event.findById(tokenData.eventId)
            .select('title description start_date end_date location template cover_image');
            
        if (!eventData) {
            return {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: { message: "The event associated with this token does not exist" },
                other: null,
            };
        }
        
        // Construct the response with event data and token permissions
        return {
            status: true,
            code: 200,
            message: "Shared event retrieved successfully",
            data: {
                event: eventData,
                permissions: tokenData.permissions,
                tokenId: tokenData.id
            },
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to retrieve shared event",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Revoke a share token
 */
export const revokeShareTokenService = async (
    token_id: string,
    user_id: string
): Promise<ServiceResponse<null>> => {
    try {
        const token = await ShareToken.findById(token_id);
        
        if (!token) {
            return {
                status: false,
                code: 404,
                message: "Share token not found",
                data: null,
                error: { message: "The specified share token does not exist" },
                other: null,
            };
        }
        
        // Only allow the token creator or an admin to revoke it
        if (token.created_by.toString() !== user_id) {
            // Here you might add a check if user is admin
            return {
                status: false,
                code: 403,
                message: "Permission denied",
                data: null,
                error: { message: "You don't have permission to revoke this token" },
                other: null,
            };
        }
        
        // Update token to revoked status
        token.revoked = true;
        token.revoked_at = new Date();
        token.revoked_by = new mongoose.Types.ObjectId(user_id);
        await token.save();
        
        return {
            status: true,
            code: 200,
            message: "Share token revoked successfully",
            data: null,
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to revoke share token",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Get all share tokens for an event
 */
export const getEventShareTokensService = async (
    event_id: string,
    user_id: string
): Promise<ServiceResponse<any[]>> => {
    try {
        // Check if user has permission to view tokens for this event
        // Here you could add a check if the user is the event creator or has admin rights
        
        const tokens = await ShareToken.find({
            event_id: new mongoose.Types.ObjectId(event_id),
            created_by: new mongoose.Types.ObjectId(user_id)
        })
        .select('-password_hash')
        .sort({ created_at: -1 });
        
        return {
            status: true,
            code: 200,
            message: "Share tokens retrieved successfully",
            data: tokens.map(token => ({
                id: token._id,
                token: token.token,
                eventId: token.event_id,
                albumId: token.album_id,
                permissions: token.permissions,
                createdAt: token.created_at,
                expiresAt: token.expires_at,
                usageCount: token.usage_count,
                revoked: token.revoked,
                revokedAt: token.revoked_at
            })),
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to retrieve share tokens",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

/**
 * Get shared album media
 */
export const getSharedAlbumMediaService = async (
    album_id: string,
    tokenValue: string,
    password?: string
): Promise<ServiceResponse<any[]>> => {
    try {
        // First validate the token
        const validationResult = await validateShareTokenService(tokenValue, password);
        
        if (!validationResult.status) {
            return validationResult;
        }
        
        const tokenData = validationResult.data;
        
        // Check if token permissions allow viewing
        if (!tokenData.permissions.view) {
            return {
                status: false,
                code: 403,
                message: "Insufficient permissions",
                data: null,
                error: { message: "This share token does not have view permissions" },
                other: null,
            };
        }
        
        // Check if token is for this album or its parent event
        const isValidForAlbum = tokenData.albumId && tokenData.albumId === album_id;
        
        if (!isValidForAlbum) {
            // If not directly for this album, check if it's for the parent event
            const album = await mongoose.model('albums').findById(album_id);
            if (!album || album.event_id.toString() !== tokenData.eventId) {
                return {
                    status: false,
                    code: 403,
                    message: "Token not valid for this album",
                    data: null,
                    error: { message: "The provided share token is not valid for this album" },
                    other: null,
                };
            }
        }
        
        // Get media for the album
        const media = await Media.find({ album_id: new mongoose.Types.ObjectId(album_id) })
            .sort({ created_at: -1 });
            
        return {
            status: true,
            code: 200,
            message: "Media retrieved successfully",
            data: media,
            error: null,
            other: {
                permissions: tokenData.permissions
            },
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to retrieve shared album media",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

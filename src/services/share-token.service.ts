import { ShareToken, ShareTokenCreationType } from "@models/share-token.model";
import { ServiceResponse } from "types/service.types";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import { User } from "@models/user.model";
import { logger } from "@utils/logger";

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
        is_restricted_to_guests?: boolean;
        invited_guests?: string[];  // List of email addresses
    },
    user_id: string
): Promise<ServiceResponse<any>> => {
    try {
        logger.info("Creating share token with data:", {
            event_id: tokenData.event_id,
            album_id: tokenData.album_id,
            permissions: tokenData.permissions,
            expires_at: tokenData.expires_at,
            has_password: !!tokenData.password,
            is_restricted_to_guests: tokenData.is_restricted_to_guests,
            invited_guests_count: tokenData.invited_guests?.length || 0,
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

        // Set guest access options if provided
        if (tokenData.is_restricted_to_guests) {
            shareTokenData.is_restricted_to_guests = true;
            
            // If we have invited guests, set them up
            if (Array.isArray(tokenData.invited_guests) && tokenData.invited_guests.length > 0) {
                // Normalize and deduplicate emails
                const emailsMap: {[key: string]: boolean} = {};
                const uniqueEmails = tokenData.invited_guests
                    .filter(email => email && typeof email === 'string')
                    .map(email => email.toLowerCase().trim())
                    .filter(email => {
                        if (emailsMap[email]) return false;
                        emailsMap[email] = true;
                        return true;
                    });
                
                shareTokenData.invited_guests = uniqueEmails.map(email => ({
                    email: email,
                    invited_at: new Date(),
                    accessed_at: null as Date | null,
                    user_id: null as mongoose.Types.ObjectId | null
                }));
                
                logger.info(`Added ${uniqueEmails.length} guests to new share token`);
            }
        }

        // Create the share token
        const shareToken = await ShareToken.create(shareTokenData);
        
        // Update the event's sharing status
        await updateEventSharingStatus(tokenData.event_id);
        
        logger.info("Share token created successfully:", {
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
    password?: string,
    user_id?: string  // Added user_id parameter to check for guest access
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
        
        // Check for guest-only access restriction
        if (token.is_restricted_to_guests) {
            // If no user ID is provided, can't verify guest status
            if (!user_id) {
                return {
                    status: false,
                    code: 401,
                    message: "Authentication required",
                    data: null,
                    error: { 
                        message: "This shared resource is restricted to invited guests only. Please log in."
                    },
                    other: { requires_authentication: true },
                };
            }
            
            // If the user is the creator, they always have access
            if (token.created_by.toString() !== user_id) {
                // Check if user is in invited guests
                const user = await User.findById(user_id);
                
                if (!user || !user.email) {
                    return {
                        status: false,
                        code: 403,
                        message: "User not authenticated properly",
                        data: null,
                        error: { 
                            message: "Unable to verify your identity. Please log in again."
                        },
                        other: { requires_authentication: true },
                    };
                }
                
                // Check if user's email is in the invited guests list
                const isInvited = token.invited_guests.some(guest => 
                    guest.email.toLowerCase() === user.email.toLowerCase()
                );
                
                if (!isInvited) {
                    return {
                        status: false,
                        code: 403,
                        message: "Access denied",
                        data: null,
                        error: { message: "You are not on the guest list for this shared resource" },
                        other: null,
                    };
                }
                
                // Update the accessed_at timestamp and user_id for this guest
                for (const guest of token.invited_guests) {
                    if (guest.email.toLowerCase() === user.email.toLowerCase()) {
                        guest.accessed_at = new Date();
                        guest.user_id = new mongoose.Types.ObjectId(user_id);
                        break;
                    }
                }
                
                await token.save();
            }
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
        
        // Update event sharing status since a token was revoked
        await updateEventSharingStatus(token.event_id.toString());
        
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

/**
 * Invite a guest to an event via share token
 */
export const inviteGuestWithShareTokenService = async (
    token_id: string,
    guest_email: string,
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
        
        // Only allow the token creator or an admin to invite guests
        if (token.created_by.toString() !== user_id) {
            // Here you might add a check if user is admin
            return {
                status: false,
                code: 403,
                message: "Permission denied",
                data: null,
                error: { message: "You don't have permission to invite guests with this token" },
                other: null,
            };
        }
        
        // Check if the guest is already invited
        const isAlreadyInvited = token.invited_guests.some(guest => 
            guest.email.toLowerCase() === guest_email.toLowerCase()
        );
        
        if (isAlreadyInvited) {
            return {
                status: false,
                code: 409,
                message: "Guest already invited",
                data: null,
                error: { message: "This guest has already been invited" },
                other: null,
            };
        }
        
        // Add the guest to the token's invited guests list
        token.invited_guests.push({
            email: guest_email.toLowerCase(),
            invited_at: new Date(),
            accessed_at: null as Date | null,
            user_id: null as mongoose.Types.ObjectId | null
        });
        await token.save();
        
        // Here you would typically send an email invitation to the guest
        // For now, we just log it
        logger.info(`Invited guest ${guest_email} to event via share token ${token_id}`);
        
        return {
            status: true,
            code: 200,
            message: "Guest invited successfully",
            data: null,
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to invite guest with share token",
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
 * Get all guests invited via a share token
 */
export const getShareTokenGuestsService = async (
    token_id: string,
    user_id: string
): Promise<ServiceResponse<any>> => {
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
        
        // Only allow the token creator or an admin to view guests
        if (token.created_by.toString() !== user_id) {
            // Here you might add a check if user is admin
            return {
                status: false,
                code: 403,
                message: "Permission denied",
                data: null,
                error: { message: "You don't have permission to view guests for this token" },
                other: null,
            };
        }
        
        // Populate guest details
        const guestEmails = token.invited_guests.map(guest => guest.email);
        const guests = await User.find({ 
            email: { $in: guestEmails } 
        }).select('name email');
        
        return {
            status: true,
            code: 200,
            message: "Guests retrieved successfully",
            data: guests,
            error: null,
            other: null,
        };
    } catch (err: any) {
        return {
            status: false,
            code: 500,
            message: "Failed to retrieve guests for share token",
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
 * Add invited guests to a share token
 */
export const addInvitedGuestsToShareTokenService = async (
    token_id: string,
    user_id: string,
    guests: string[]
): Promise<ServiceResponse<any>> => {
    try {
        // Validate inputs
        if (!mongoose.Types.ObjectId.isValid(token_id)) {
            return {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null,
            };
        }

        if (!Array.isArray(guests) || guests.length === 0) {
            return {
                status: false,
                code: 400,
                message: "Invalid guests list",
                data: null,
                error: { message: "A valid list of guest emails is required" },
                other: null,
            };
        }

        // Find the token
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

        // Check if user has permission (only the token creator can add guests)
        if (token.created_by.toString() !== user_id) {
            return {
                status: false,
                code: 403,
                message: "Permission denied",
                data: null,
                error: { message: "You don't have permission to modify this token" },
                other: null,
            };
        }

        // Enable guest restriction if not already set
        token.is_restricted_to_guests = true;

        // Add new guests (avoiding duplicates)
        const currentEmailsMap: {[key: string]: boolean} = {};
        token.invited_guests.forEach(g => {
            currentEmailsMap[g.email.toLowerCase()] = true;
        });
        
        const now = new Date();
        
        for (const email of guests) {
            const normalizedEmail = email.toLowerCase().trim();
            // Only add if not already in the list
            if (!currentEmailsMap[normalizedEmail]) {
                token.invited_guests.push({
                    email: normalizedEmail,
                    invited_at: now,
                    accessed_at: null as Date | null,
                    user_id: null as mongoose.Types.ObjectId | null
                });
                currentEmailsMap[normalizedEmail] = true;
            }
        }

        // Save the updated token
        await token.save();

        // Update event sharing status since guests were added
        await updateEventSharingStatus(token.event_id.toString());

        logger.info(`Added ${guests.length} guests to token ${token_id}`);

        return {
            status: true,
            code: 200,
            message: "Guests added successfully",
            data: {
                token_id: token._id,
                guests_count: token.invited_guests.length
            },
            error: null,
            other: null,
        };
    } catch (err: any) {
        logger.error("Failed to add guests to share token", { error: err.message });
        return {
            status: false,
            code: 500,
            message: "Failed to add guests to share token",
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
 * Remove invited guests from a share token
 */
export const removeInvitedGuestsFromShareTokenService = async (
    token_id: string,
    user_id: string,
    guests: string[]
): Promise<ServiceResponse<any>> => {
    try {
        // Validate inputs
        if (!mongoose.Types.ObjectId.isValid(token_id)) {
            return {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null,
            };
        }

        if (!Array.isArray(guests) || guests.length === 0) {
            return {
                status: false,
                code: 400,
                message: "Invalid guests list",
                data: null,
                error: { message: "A valid list of guest emails is required" },
                other: null,
            };
        }

        // Find the token
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

        // Check if user has permission (only the token creator can remove guests)
        if (token.created_by.toString() !== user_id) {
            return {
                status: false,
                code: 403,
                message: "Permission denied",
                data: null,
                error: { message: "You don't have permission to modify this token" },
                other: null,
            };
        }

        // Normalize emails for comparison and put them in a map for O(1) lookup
        const emailsToRemove: {[key: string]: boolean} = {};
        guests.forEach(email => {
            emailsToRemove[email.toLowerCase().trim()] = true;
        });
        
        // Filter out the guests to be removed
        const initialCount = token.invited_guests.length;
        
        // Properly filter a mongoose document array
        for (let i = token.invited_guests.length - 1; i >= 0; i--) {
            if (emailsToRemove[token.invited_guests[i].email.toLowerCase()]) {
                token.invited_guests.splice(i, 1);
            }
        }
        
        // If no more guests, optionally disable guest restriction
        if (token.invited_guests.length === 0) {
            token.is_restricted_to_guests = false;
        }

        // Save the updated token
        await token.save();

        // Update event sharing status since guests were removed
        await updateEventSharingStatus(token.event_id.toString());

        const removedCount = initialCount - token.invited_guests.length;
        logger.info(`Removed ${removedCount} guests from token ${token_id}`);

        return {
            status: true,
            code: 200,
            message: "Guests removed successfully",
            data: {
                token_id: token._id,
                guests_count: token.invited_guests.length,
                removed_count: removedCount
            },
            error: null,
            other: null,
        };
    } catch (err: any) {
        logger.error("Failed to remove guests from share token", { error: err.message });
        return {
            status: false,
            code: 500,
            message: "Failed to remove guests from share token",
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
 * Check if a guest has access to a share token
 */
export const checkGuestAccessToShareTokenService = async (
    token_id: string,
    email: string
): Promise<ServiceResponse<boolean>> => {
    try {
        // Validate inputs
        if (!mongoose.Types.ObjectId.isValid(token_id)) {
            return {
                status: false,
                code: 400,
                message: "Invalid token ID",
                data: null,
                error: { message: "A valid token ID is required" },
                other: null,
            };
        }

        if (!email || typeof email !== 'string') {
            return {
                status: false,
                code: 400,
                message: "Invalid email",
                data: null,
                error: { message: "A valid email address is required" },
                other: null,
            };
        }

        // Find the token
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

        // If token is not restricted to guests, anyone has access
        if (!token.is_restricted_to_guests) {
            return {
                status: true,
                code: 200,
                message: "Token is not restricted to guests",
                data: true, // Access granted
                error: null,
                other: null,
            };
        }

        // Check if the email is in the invited guests list
        const normalizedEmail = email.toLowerCase().trim();
        const isInvited = token.invited_guests.some(guest => 
            guest.email.toLowerCase() === normalizedEmail
        );

        return {
            status: true,
            code: 200,
            message: isInvited ? "Guest has access" : "Guest does not have access",
            data: isInvited,
            error: null,
            other: null,
        };
    } catch (err: any) {
        logger.error("Failed to check guest access", { error: err.message });
        return {
            status: false,
            code: 500,
            message: "Failed to check guest access",
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
 * Update an event's sharing status based on its active share tokens
 * @param event_id The ID of the event to update
 */
const updateEventSharingStatus = async (event_id: string): Promise<void> => {
    try {
        // Get all active (not revoked and not expired) share tokens for the event
        const now = new Date();
        const activeTokens = await ShareToken.find({
            event_id: new mongoose.Types.ObjectId(event_id),
            revoked: false,
            $or: [
                { expires_at: null },
                { expires_at: { $gt: now } }
            ]
        });
        
        if (activeTokens.length === 0) {
            // No active tokens, update event to not shared
            await Event.findByIdAndUpdate(event_id, {
                is_shared: false,
                share_settings: {
                    restricted_to_guests: false,
                    has_password_protection: false,
                    guest_count: 0,
                    last_shared_at: null,
                    active_share_tokens: 0
                }
            });
            return;
        }
        
        // Calculate sharing statistics
        const hasRestrictedAccess = activeTokens.some(token => token.is_restricted_to_guests);
        const hasPasswordProtection = activeTokens.some(token => token.password_hash !== null);
        
        // Count total invited guests (avoiding duplicates across tokens)
        const emailsMap: {[key: string]: boolean} = {};
        let uniqueGuestCount = 0;
        
        activeTokens.forEach(token => {
            token.invited_guests.forEach(guest => {
                const email = guest.email.toLowerCase();
                if (!emailsMap[email]) {
                    emailsMap[email] = true;
                    uniqueGuestCount++;
                }
            });
        });
        
        // Update the event
        await Event.findByIdAndUpdate(event_id, {
            is_shared: true,
            share_settings: {
                restricted_to_guests: hasRestrictedAccess,
                has_password_protection: hasPasswordProtection,
                guest_count: uniqueGuestCount,
                last_shared_at: new Date(),
                active_share_tokens: activeTokens.length
            }
        });
        
        logger.info(`Updated sharing status for event ${event_id}`, {
            active_tokens: activeTokens.length,
            restricted_access: hasRestrictedAccess,
            password_protected: hasPasswordProtection,
            guest_count: uniqueGuestCount
        });
    } catch (err) {
        logger.error(`Failed to update event sharing status for event ${event_id}`, {
            error: err instanceof Error ? err.message : String(err)
        });
        // Don't throw - this is a background operation that shouldn't break the main flow
    }
};

/**
 * Update sharing status for all events (can be called during system startup)
 */
export const updateAllEventsSharingStatus = async (): Promise<void> => {
    try {
        logger.info("Starting to update sharing status for all events");
        
        // Find all events
        const events = await Event.find();
        logger.info(`Found ${events.length} events to check`);
        
        let updatedCount = 0;
        
        // Update each event's sharing status
        for (const event of events) {
            await updateEventSharingStatus(event._id.toString());
            updatedCount++;
            
            // Log progress for large updates
            if (updatedCount % 100 === 0) {
                logger.info(`Updated sharing status for ${updatedCount}/${events.length} events`);
            }
        }
        
        logger.info(`Completed updating sharing status for ${updatedCount} events`);
    } catch (err) {
        logger.error("Failed to update all events sharing status", {
            error: err instanceof Error ? err.message : String(err)
        });
    }
};

/**
 * Get the sharing status for an event
 */
export const getEventSharingStatusService = async (
    event_id: string,
    user_id: string
): Promise<ServiceResponse<any>> => {
    try {
        // Validate inputs
        if (!mongoose.Types.ObjectId.isValid(event_id)) {
            return {
                status: false,
                code: 400,
                message: "Invalid event ID",
                data: null,
                error: { message: "A valid event ID is required" },
                other: null,
            };
        }

        // Find the event
        const event = await Event.findById(event_id);
        if (!event) {
            return {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: { message: "The specified event does not exist" },
                other: null,
            };
        }

        // Check user permission
        if (event.created_by.toString() !== user_id) {
            return {
                status: false,
                code: 403,
                message: "Permission denied",
                data: null,
                error: { message: "You don't have permission to view this event's sharing status" },
                other: null,
            };
        }

        // If the event's sharing status might be out of date, refresh it
        if (event.is_shared) {
            await updateEventSharingStatus(event_id);
            // Refetch the event to get updated sharing info
            const updatedEvent = await Event.findById(event_id);
            if (updatedEvent) {
                event.is_shared = updatedEvent.is_shared;
                event.share_settings = updatedEvent.share_settings;
            }
        }

        // Get active share tokens
        const activeTokens = await ShareToken.find({
            event_id: new mongoose.Types.ObjectId(event_id),
            revoked: false,
            $or: [
                { expires_at: null },
                { expires_at: { $gt: new Date() } }
            ]
        }).select('-password_hash');

        return {
            status: true,
            code: 200,
            message: "Event sharing status retrieved successfully",
            data: {
                is_shared: event.is_shared,
                share_settings: event.share_settings,
                active_tokens: activeTokens.map(token => ({
                    id: token._id,
                    token: token.token,
                    created_at: token.created_at,
                    expires_at: token.expires_at,
                    is_restricted_to_guests: token.is_restricted_to_guests,
                    invited_guest_count: token.invited_guests.length
                }))
            },
            error: null,
            other: null,
        };
    } catch (err: any) {
        logger.error("Failed to get event sharing status", { error: err.message });
        return {
            status: false,
            code: 500,
            message: "Failed to get event sharing status",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};

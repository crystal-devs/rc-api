import { ShareToken } from "@models/share-token.model";
import { ServiceResponse } from "types/service.types";
import mongoose from "mongoose";
import { logger } from "@utils/logger";

/**
 * Get invited guests for a share token
 */
export const getInvitedGuestsService = async (
    tokenId: string,
    userId: string
): Promise<ServiceResponse<any>> => {
    try {
        // Find the share token
        const token = await ShareToken.findById(tokenId);
        
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
        
        // Check if the requester has permission to view the guest list
        // Only the creator of the token should be able to see the guest list
        if (token.created_by.toString() !== userId) {
            return {
                status: false,
                code: 403,
                message: "Unauthorized",
                data: null,
                error: { message: "You do not have permission to view this guest list" },
                other: null,
            };
        }
        
        // Return the invited guests list
        return {
            status: true,
            code: 200,
            message: "Guest list retrieved successfully",
            data: {
                token_id: token._id,
                event_id: token.event_id,
                invited_guests: token.invited_guests.map(guest => ({
                    email: guest.email,
                    invited_at: guest.invited_at,
                    accessed_at: guest.accessed_at,
                    user_id: guest.user_id ? guest.user_id.toString() : null
                })),
                total_guests: token.invited_guests.length,
                active_guests: token.invited_guests.filter(g => g.accessed_at).length
            },
            error: null,
            other: null,
        };
    } catch (error: any) {
        logger.error(`Error in getInvitedGuestsService: ${error.message}`, { error });
        return {
            status: false,
            code: 500,
            message: "Failed to retrieve guest list",
            data: null,
            error: { message: error.message },
            other: null,
        };
    }
};

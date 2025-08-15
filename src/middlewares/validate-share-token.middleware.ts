// middlewares/guest-auth.middleware.ts

import { validateShareToken } from '@services/event';
import { Request, Response, NextFunction } from 'express';

interface GuestRequest extends Request {
    guestAccess?: {
        eventId: string;
        permissions: any;
        shareToken: any;
        isGuest: boolean;
    };
}

export const validateGuestTokenMiddleware = async (
    req: GuestRequest, 
    res: Response, 
    next: NextFunction
) => {
    try {
        const { share_token } = req.params;
        
        if (!share_token) {
            return res.status(400).json({
                status: false,
                code: 400,
                message: "Share token is required",
                data: null,
                error: { message: "Share token parameter is missing" },
                other: null
            });
        }

        const validation = await validateShareToken(share_token);
        
        if (!validation.valid) {
            return res.status(403).json({
                status: false,
                code: 403,
                message: validation.reason || "Invalid share token",
                data: null,
                error: { message: validation.reason },
                other: null
            });
        }

        // Attach guest access info to request
        req.guestAccess = {
            eventId: validation.event_id!,
            permissions: validation.permissions!,
            shareToken: validation.shareToken!,
            isGuest: true
        };

        // Also set the event_id in params for compatibility with existing controller
        req.params.event_id = validation.event_id!;

        next();
    } catch (error) {
        console.error('Guest token validation error:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: "Token validation failed",
            data: null,
            error: { message: "Internal server error during token validation" },
            other: null
        });
    }
};
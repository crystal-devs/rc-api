import { Response, NextFunction } from "express";
import { sendResponse } from "@utils/express.util";
import { injectedRequest } from "types/injected-types";
import { GuestSessionService } from "@services/guest/guest-session.service";
import { logger } from "@utils/logger";

/**
 * Get the list of invited guests for a share token
 */
export const getInvitedGuestsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { token_id } = req.params;
        const userId = req.user._id.toString();

        // Get the guest list
        // const response = await getInvitedGuestsService(token_id, userId);

        // Send response
        // return sendResponse(res, response);
        return
    } catch (error: any) {
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Failed to retrieve invited guests",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};

/**
 * Update guest information for a session
 */
export const updateGuestInfoController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { eventId } = req.params;
        const { sessionId, name, email, phone } = req.body;

        if (!sessionId || !eventId) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Session ID and Event ID are required",
                data: null,
                error: null,
                other: null
            });
        }

        const result = await GuestSessionService.updateGuestInfo(sessionId, eventId, {
            name,
            email,
            phone
        });

        return sendResponse(res, {
            status: result.success,
            code: result.success ? 200 : 400,
            message: result.message,
            data: result.success ? { updated: true } : null,
            error: result.success ? null : { message: result.message },
            other: null
        });
    } catch (error: any) {
        logger.error('Error updating guest info:', error);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Failed to update guest information",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};

/**
 * Check if guest session has required information
 */
export const checkGuestInfoController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { eventId } = req.params;
        const { sessionId, requiredFields } = req.query;

        if (!sessionId || !eventId) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Session ID and Event ID are required",
                data: null,
                error: null,
                other: null
            });
        }

        const fields = (requiredFields as string)?.split(',') as ('email' | 'phone' | 'name')[] || ['email'];
        const result = await GuestSessionService.hasRequiredInfo(sessionId as string, eventId, fields);

        return sendResponse(res, {
            status: true,
            code: 200,
            message: "Guest info check completed",
            data: {
                hasRequiredInfo: result.hasInfo,
                missingFields: result.missingFields,
                guestInfo: result.guestInfo
            },
            error: null,
            other: null
        });
    } catch (error: any) {
        logger.error('Error checking guest info:', error);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Failed to check guest information",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};

/**
 * Get guest session analytics
 */
export const getGuestAnalyticsController = async (req: injectedRequest, res: Response, next: NextFunction) => {
    try {
        const { eventId } = req.params;
        const { sessionId, timeRange } = req.query;

        if (!eventId) {
            return sendResponse(res, {
                status: false,
                code: 400,
                message: "Event ID is required",
                data: null,
                error: null,
                other: null
            });
        }

        if (sessionId) {
            // Get individual session analytics
            const analytics = await GuestSessionService.getSessionAnalytics(sessionId as string, eventId);
            return sendResponse(res, {
                status: true,
                code: 200,
                message: "Session analytics retrieved",
                data: analytics,
                error: null,
                other: null
            });
        } else {
            // Get event-wide analytics
            const analytics = await GuestSessionService.getEventAnalytics(
                eventId,
                (timeRange as 'day' | 'week' | 'month') || 'week'
            );
            return sendResponse(res, {
                status: true,
                code: 200,
                message: "Event analytics retrieved",
                data: analytics,
                error: null,
                other: null
            });
        }
    } catch (error: any) {
        logger.error('Error getting guest analytics:', error);
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Failed to retrieve analytics",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};

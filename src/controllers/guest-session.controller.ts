// controllers/guestSessionController.ts
import { Request, Response, RequestHandler } from 'express';
import { logger } from '@utils/logger';
import { SessionClaimService } from '@services/guest/sessionClaimService';

/**
 * Get claimable content summary for logged-in user
 */
export const getClaimableSummaryController: RequestHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const userId = (req as any).user?._id;
        const { eventId } = req.params;
        
        // Get session ID from cookie
        const guestSessionId = req.cookies?.guest_session_id;

        console.log(guestSessionId, 'guestSessionIdguestSessionId');
        if (!userId) {
            res.status(401).json({
                status: false,
                code: 401,
                message: 'Authentication required',
                data: null
            });
            return;
        }

        // If no session ID in cookie, return empty summary
        if (!guestSessionId) {
            res.status(200).json({
                status: true,
                code: 200,
                message: 'No claimable content found',
                data: {
                    hasClaimableContent: false,
                    totalSessions: 0,
                    totalMedia: 0,
                    sessions: []
                }
            });
            return;
        }

        const summary = await SessionClaimService.getClaimSummaryBySessionId(
            userId, 
            eventId, 
            guestSessionId
        );

        res.status(200).json({
            status: true,
            code: 200,
            message: 'Claim summary retrieved',
            data: summary
        });

    } catch (error: any) {
        logger.error('Error in getClaimableSummaryController:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to get claim summary',
            data: null,
            error: { message: error.message }
        });
    }
};

/**
 * Claim guest content
 */
export const claimGuestContentController: RequestHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const userId = (req as any).user?._id;
        const { eventId } = req.params;
        
        // Get session ID from cookie (primary) or body (fallback)
        const guestSessionId = req.cookies?.guest_session_id || req.body?.sessionId;

        if (!userId) {
            res.status(401).json({
                status: false,
                code: 401,
                message: 'Authentication required',
                data: null
            });
            return;
        }

        if (!guestSessionId) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Guest session ID required to claim content',
                data: null
            });
            return;
        }

        const result = await SessionClaimService.claimGuestContent(
            userId,
            eventId,
            [guestSessionId] // Always pass as array
        );

        res.status(200).json({
            status: true,
            code: 200,
            message: `Successfully claimed ${result.mediaMigrated} photos`,
            data: result
        });

    } catch (error: any) {
        logger.error('Error in claimGuestContentController:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to claim content',
            data: null,
            error: { message: error.message }
        });
    }
};
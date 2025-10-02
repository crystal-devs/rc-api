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

        if (!userId) {
            res.status(401).json({
                status: false,
                code: 401,
                message: 'Authentication required',
                data: null
            });
            return;
        }

        const summary = await SessionClaimService.getClaimSummary(userId, eventId);

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
        const { sessionIds } = req.body; // Optional: specific sessions

        if (!userId) {
            res.status(401).json({
                status: false,
                code: 401,
                message: 'Authentication required',
                data: null
            });
            return;
        }

        const result = await SessionClaimService.claimGuestContent(
            userId,
            eventId,
            sessionIds
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

// // routes/guestSessionRoutes.ts
// import express from 'express';
// import { authMiddleware } from '../middleware/authMiddleware';
// import {
//     getClaimableSummaryController,
//     claimGuestContentController
// } from '../controllers/guestSessionController';

// const router = express.Router();

// // Get claimable content summary (requires auth)
// router.get(
//     '/claimable/:eventId',
//     authMiddleware,
//     getClaimableSummaryController
// );

// // Claim guest content (requires auth)
// router.post(
//     '/claim/:eventId',
//     authMiddleware,
//     claimGuestContentController
// );

// export default router;
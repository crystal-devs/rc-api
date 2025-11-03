// controllers/cleanup.controller.ts
import { Request, Response, NextFunction, RequestHandler } from "express";
import mongoose from "mongoose";
import { logger } from "@utils/logger";
import { sendResponse } from "@utils/express.util";
import { CleanupService } from "@services/cleanup.service";

// Enhanced interface for authenticated requests
interface AuthenticatedRequest extends Request {
    user?: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
        subscription?: any;
    };
    sessionID?: string;
}

/**
 * POST /admin/cleanup-media
 *
 * Cleans up deleted media documents and S3 objects
 * Can be triggered by:
 * - EventBridge Lambda (scheduled)
 * - Manual API call from dashboard
 * - Another backend service
 */
export const cleanupMediaController: RequestHandler = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    logger.info('Starting cleanup job');

    try {
        // Use Mongoose connection directly (standard approach in your codebase)
        const db = mongoose.connection;

        if (!db || db.readyState !== 1) {
            res.status(500).json({ error: 'Database connection not available' });
            return;
        }

        const result = await CleanupService.cleanupDeletedMedia(db);

        if (result.status === 'ok') {
            res.json(result);
        } else {
            res.status(500).json(result);
        }

    } catch (error: any) {
        logger.error('Cleanup controller error:', error);

        res.status(500).json({
            status: 'error',
            message: 'Cleanup failed',
            error: error.message
        });
    }
};
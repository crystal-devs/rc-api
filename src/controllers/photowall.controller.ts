// controllers/photo-wall.controller.ts
import { RequestHandler, Request, Response, NextFunction } from "express";
import {
    updatePhotoWallSettingsService,
    getPhotoWallStatusService
} from "@services/photowall.service";
import { logger } from "@utils/logger";
import { getPhotoWallService } from "@services/photowall.service";

export const getPhotoWallController: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { shareToken } = req.params;
        const { quality, maxItems, currentIndex, sessionId, lastFetchTime } = req.query;

        if (!shareToken) {
            res.status(400).json({
                status: false,
                code: 400,
                message: 'Share token required',
                data: null
            });
            return;
        }

        const options = {
            quality: quality as string || 'large',
            maxItems: parseInt(maxItems as string) || 100,
            currentIndex: parseInt(currentIndex as string) || 0,
            sessionId: sessionId as string,
            lastFetchTime: lastFetchTime as string
        };

        const response = await getPhotoWallService(shareToken, options);

        // Add cache headers for optimal performance
        if (response.status) {
            res.set({
                'Cache-Control': 'no-cache, must-revalidate',
                'ETag': `"${response.data?.wallId}-${Date.now()}"`,
                'Last-Modified': new Date().toUTCString()
            });
        }

        res.status(response.code).json(response);
    } catch (error: any) {
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to load photo wall',
            data: null,
            error: error.message
        });
    }
};

// Remove all other controller functions - they're not needed with unified approach

export const updatePhotoWallSettingsController: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { shareToken } = req.params;
        const settings = req.body;
        // const userId = (req as any).user?._id;

        if (!shareToken) {
            res.status(400).json({
                status: false,
                message: 'Share token required',
                data: null
            });
            return;
        }

        logger.info(`⚙️ Updating photo wall settings:`, {
            shareToken: shareToken.substring(0, 8) + '...',
            settings
        });

        const response = await updatePhotoWallSettingsService(shareToken, settings);
        res.status(response.code).json(response);
    } catch (error: any) {
        logger.error('❌ Error in updatePhotoWallSettingsController:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to update photo wall settings',
            data: null,
            error: error.message
        });
    }
};

export const getPhotoWallStatusController: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { shareToken } = req.params;

        if (!shareToken) {
            res.status(400).json({
                status: false,
                message: 'Share token required',
                data: null
            });
            return;
        }

        const response = await getPhotoWallStatusService(shareToken);

        if (response.status) {
            res.set('Cache-Control', 'public, max-age=30');
        }

        res.status(response.code).json(response);
    } catch (error: any) {
        logger.error('❌ Error in getPhotoWallStatusController:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get photo wall status',
            data: null,
            error: error.message
        });
    }
};
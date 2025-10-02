// controllers/photowall.controller.ts - Simplified

import { RequestHandler, Request, Response } from "express";
import { getPhotoWallDisplayService } from "@services/photowall.service";
import { logger } from "@utils/logger";

export const getPhotoWallController: RequestHandler = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { shareToken } = req.params;
        const { quality, maxItems } = req.query;

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
            maxItems: parseInt(maxItems as string) || 100
        };

        const response = await getPhotoWallDisplayService(shareToken, options);
        res.status(response.code).json(response);
    } catch (error: any) {
        logger.error('❌ Error in getPhotoWallController:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Failed to load photo wall',
            data: null,
            error: error.message
        });
    }
};

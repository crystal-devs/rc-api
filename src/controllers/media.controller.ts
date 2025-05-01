// controllers/media.controller.ts

import { uploadMediaService, uploadCoverImageService } from "@services/media.service";
import { sendResponse } from "@utils/express.util";
import { NextFunction, RequestHandler, Response } from "express";
import { injectedRequest } from "types/injected-types";

/**
 * Regular media upload controller
 */
export const uploadMediaController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const file = req.file;
        const { album_id } = req.body;
        const user_id = req.user._id;

        if (!file) {
            res.status(400).json({
                status: false,
                message: "Missing file",
                error: { message: "File is required" },
            });
            return;
        }

        if (!album_id) {
            res.status(400).json({
                status: false,
                message: "Missing album_id",
                error: { message: "album_id is required" },
            });
            return;
        }

        const response = await uploadMediaService(file, user_id.toString(), album_id);
        sendResponse(res, response);
    } catch (_err) {
        next(_err);
    }
};

/**
 * Cover image upload controller
 */
export const uploadCoverImageController: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Log the request for debugging
        console.log('Cover image upload request:', {
            file: req.file ? 'File present' : 'No file',
            body: req.body
        });

        const file = req.file;
        // Get the folder parameter with 'covers' as default
        const { folder = 'covers' } = req.body;

        // Validate inputs
        if (!file) {
            res.status(400).json({
                status: false,
                message: "No file provided",
                error: { message: "Image file is required" },
            });
            return;
        }

        // Upload cover image
        const response = await uploadCoverImageService(file, folder);
        sendResponse(res, response);
    } catch (_err) {
        console.error('Error in uploadCoverImageController:', _err);
        next(_err);
    }
};
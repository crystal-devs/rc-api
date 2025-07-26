// routes/media.routes.ts - Updated for guest uploads

import express, { RequestHandler } from "express";
import multer from "multer";
import {
    uploadMediaController,
    guestUploadMediaController, // New controller for guest uploads
    uploadCoverImageController,
    getMediaByEventController,
    getMediaByAlbumController,
    deleteMediaController,
    updateMediaStatusController,
    bulkUpdateMediaStatusController,
    getGuestMediaController
} from "@controllers/media.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import {
    checkStorageLimitMiddleware,
    checkEventPhotoLimitMiddleware,
    checkFileSizeLimitMiddleware
} from "@middlewares/subscription-limit.middleware";
import { validateGuestTokenMiddleware } from "@middlewares/validate-share-token.middleware";
import { optionalAuthMiddleware } from "@middlewares/conditional-auth.middleware";

const mediaRouter = express.Router();

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Authenticated upload (existing functionality)
mediaRouter.post(
    "/upload",
    authMiddleware,
    upload.single('image'),
    checkFileSizeLimitMiddleware as RequestHandler,
    checkStorageLimitMiddleware as RequestHandler,
    checkEventPhotoLimitMiddleware as RequestHandler,
    uploadMediaController
);

// Guest upload - no auth required but event must allow it
mediaRouter.post(
    "/guest-upload",
    upload.single('image'),
    checkFileSizeLimitMiddleware as RequestHandler,
    guestUploadMediaController
);

// Cover upload (always requires auth)
mediaRouter.post("/upload-cover", authMiddleware, upload.single('image'), uploadCoverImageController);

// Get media routes (conditional auth)
mediaRouter.get("/event/:event_id", authMiddleware, getMediaByEventController);
mediaRouter.get("/album/:album_id", authMiddleware, getMediaByAlbumController);

mediaRouter.get("/guest/:share_token",
    optionalAuthMiddleware,
    getGuestMediaController
);

// Single media status update
mediaRouter.patch("/:media_id/status", authMiddleware, updateMediaStatusController);

// Bulk media status update
mediaRouter.patch("/event/:event_id/bulk-status", authMiddleware, bulkUpdateMediaStatusController);


// Delete media (always requires auth)
mediaRouter.delete("/:media_id", authMiddleware, deleteMediaController);

export default mediaRouter;
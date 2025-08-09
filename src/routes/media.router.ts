// routes/media.routes.ts - Updated and cleaned up

import express, { RequestHandler } from "express";
import multer from "multer";
import {
    guestUploadMediaController,
    uploadCoverImageController,
    getMediaByEventController,
    getMediaByAlbumController,
    deleteMediaController,
    updateMediaStatusController,
    bulkUpdateMediaStatusController,
    getGuestMediaController,
    getMediaByIdController,
    getMediaVariantsController,
    getBatchOptimizedUrlsController
} from "@controllers/media.controller";
import { getBatchUploadStatusController, getUploadStatusController, uploadMediaController, } from "@controllers/upload.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import {
    checkStorageLimitMiddleware,
    checkEventPhotoLimitMiddleware,
    checkFileSizeLimitMiddleware
} from "@middlewares/subscription-limit.middleware";
import { validateGuestTokenMiddleware } from "@middlewares/validate-share-token.middleware";
import { optionalAuthMiddleware } from "@middlewares/conditional-auth.middleware";

const mediaRouter = express.Router();

// Configure multer for file uploads with better error handling
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        // Accept images and videos
        if (file.mimetype.match(/^(image|video)\//)) {
            cb(null, true);
        } else {
            cb(new Error('Only image and video files are allowed'));
        }
    }
});

// === AUTHENTICATED UPLOADS ===
mediaRouter.post(
  "/upload",
  authMiddleware,
  upload.array('images', 10), // Accepts 1-10 files
  checkFileSizeLimitMiddleware as RequestHandler,
  checkStorageLimitMiddleware as RequestHandler,
  checkEventPhotoLimitMiddleware as RequestHandler,
  uploadMediaController as RequestHandler // Single controller handles all cases
);

// Status endpoints (unchanged)
mediaRouter.get("/status/:mediaId", getUploadStatusController as RequestHandler);
mediaRouter.post("/status/batch", getBatchUploadStatusController as RequestHandler);

// mediaRouter.post(
//     "/upload/multiple",
//     authMiddleware,
//     upload.array('images', 10), // Allow up to 10 files with field name 'images'
//     checkFileSizeLimitMiddleware as RequestHandler,
//     checkStorageLimitMiddleware as RequestHandler,
//     checkEventPhotoLimitMiddleware as RequestHandler,
//     uploadMultipleMediaController // New controller
// );

// Cover image upload (always requires auth)
mediaRouter.post(
    "/upload-cover",
    authMiddleware,
    upload.single('image'),
    uploadCoverImageController
);

// === GUEST UPLOADS ===
mediaRouter.post(
    "/guest/:share_token/upload",
    optionalAuthMiddleware,        // Allow both auth and non-auth users
    upload.array('files', 10),    // Support multiple files
    guestUploadMediaController
);

// === MEDIA RETRIEVAL ===
// Get media by event (authenticated)
mediaRouter.get(
    "/event/:eventId",
    authMiddleware,
    getMediaByEventController
);

// Get media by album (authenticated)
mediaRouter.get(
    "/album/:albumId",
    authMiddleware,
    getMediaByAlbumController
);

// Get guest media (public access with token)
mediaRouter.get(
    "/guest/:shareToken",
    optionalAuthMiddleware,
    getGuestMediaController
);

// Get specific media by ID
mediaRouter.get(
    "/:media_id",
    authMiddleware,
    getMediaByIdController
);

// === MEDIA MANAGEMENT ===
// Single media status update
mediaRouter.patch(
    "/:media_id/status",
    authMiddleware,
    updateMediaStatusController
);

// Bulk media status update
mediaRouter.patch(
    "/event/:event_id/bulk-status",
    authMiddleware,
    bulkUpdateMediaStatusController
);

// Delete media (always requires auth)
mediaRouter.delete(
    "/:media_id",
    authMiddleware,
    deleteMediaController
);

// === OPTIMIZATION ENDPOINTS ===
// Get media variants information
mediaRouter.get(
    "/:mediaId/variants",
    authMiddleware,
    getMediaVariantsController
);

// Batch get optimized URLs
mediaRouter.post(
    "/batch/optimized-urls",
    authMiddleware,
    getBatchOptimizedUrlsController
);

export default mediaRouter;
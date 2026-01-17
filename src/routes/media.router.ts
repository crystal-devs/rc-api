// routes/media.routes.ts - Updated and cleaned up

import express, { RequestHandler } from "express";
import multer from "multer";
import {
    guestUploadMediaController,
    getMediaByEventController,
    getMediaByAlbumController,
    deleteMediaController,
    updateMediaStatusController,
    bulkUpdateMediaStatusController,
    bulkSoftDeleteMediaController,
    getGuestMediaController,
    getMediaByIdController,
    getMediaVariantsController,
    getUploadStatusController,
    getBatchUploadStatusController,
    retryUploadController
} from "@controllers/media.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import {
    checkStorageLimitMiddleware,
    checkEventPhotoLimitMiddleware,
} from "@middlewares/subscription-limit.middleware";
import { optionalAuthMiddleware } from "@middlewares/conditional-auth.middleware";
import { checkFileSizeLimitMiddleware } from "@middlewares/upload.middleware";
import { generateBatchUploadUrlsController, generateUploadUrlController } from "@controllers/upload-url.controller";
import { uploadCompleteController } from "@controllers/upload-complete.controller";
import { getSignedUrlForKeyController } from "@controllers/signed-url.controller";
import { validateLambdaToken } from "@middlewares/validateLambdaToken.middleware";
import { updateMediaController } from "@controllers/update-media.controller";

const mediaRouter = express.Router();
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

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
// routes/media.routes.ts - Updated route
// mediaRouter.post(
//     "/upload",
//     authMiddleware,
//     upload.array('images', 10),
//     checkFileSizeLimitMiddleware as RequestHandler,
//     checkStorageLimitMiddleware as RequestHandler,
//     checkEventPhotoLimitMiddleware as RequestHandler,
//     uploadMediaController as RequestHandler,
// );

mediaRouter.post('/upload-url', authMiddleware, wrap(generateBatchUploadUrlsController))
mediaRouter.post('/upload-complete', authMiddleware, wrap(uploadCompleteController))
mediaRouter.post('/signed-url/key', optionalAuthMiddleware, wrap(getSignedUrlForKeyController))
mediaRouter.post('/update-photo', validateLambdaToken as RequestHandler, wrap(updateMediaController))

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

// Bulk soft delete media (POST used for reliable body support)
mediaRouter.post(
    "/event/:event_id/bulk-delete",
    authMiddleware,
    bulkSoftDeleteMediaController
);

// === OPTIMIZATION ENDPOINTS ===
// Get media variants information
mediaRouter.get(
    "/:mediaId/variants",
    authMiddleware,
    getMediaVariantsController
);


// === UPLOAD STATUS ENDPOINTS ===
// Get upload progress status for a single media item
mediaRouter.get(
    "/upload/:mediaId/status",
    authMiddleware,
    getUploadStatusController
);

// Batch get upload status for multiple media items
mediaRouter.post(
    "/upload/batch-status",
    authMiddleware,
    getBatchUploadStatusController
);

// Retry failed upload processing
mediaRouter.post(
    "/upload/:mediaId/retry",
    authMiddleware,
    retryUploadController
);

export default mediaRouter;
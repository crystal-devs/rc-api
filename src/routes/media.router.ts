// routes/media.routes.ts - Updated and cleaned up

import express, { RequestHandler } from "express";
import multer from "multer";
import {
    guestUploadMediaController,
    getMediaByEventController,
    getEventMediaCountsController,
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
import { eventAccessMiddleware } from "@middlewares/event-access.middleware";
import { mediaAccessMiddleware } from "@middlewares/resource-access.middleware";
import { authorize } from "@middlewares/authorize.middleware";
import {
    checkStorageLimitMiddleware,
    checkEventPhotoLimitMiddleware,
} from "@middlewares/subscription-limit.middleware";
import { optionalAuthMiddleware } from "@middlewares/conditional-auth.middleware";
import { checkFileSizeLimitMiddleware } from "@middlewares/upload.middleware";
import { generateBatchUploadUrlsController, generateUploadUrlController } from "@controllers/upload-url.controller";
import { uploadCompleteController, uploadBatchCompleteController } from "@controllers/upload-complete.controller";
import { getSignedUrlForKeyController } from "@controllers/signed-url.controller";
import { validateLambdaToken } from "@middlewares/validateLambdaToken.middleware";
import { updateMediaController } from "@controllers/update-media.controller";
import { searchFacesController } from "@controllers/media/search-faces.controller";
import { mediaRateLimiter, uploadRateLimiter, faceSearchRateLimiter } from "@configs/security.config";

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

mediaRouter.post('/upload-url', authMiddleware, uploadRateLimiter, wrap(generateBatchUploadUrlsController))
mediaRouter.post('/upload-complete', authMiddleware, wrap(uploadCompleteController))
mediaRouter.post('/upload-complete/batch', authMiddleware, wrap(uploadBatchCompleteController))
mediaRouter.post('/signed-url/key', optionalAuthMiddleware, wrap(getSignedUrlForKeyController))
mediaRouter.post('/update-photo', validateLambdaToken as RequestHandler, uploadRateLimiter, wrap(updateMediaController))

// === GUEST UPLOADS ===
mediaRouter.post(
    "/guest/:share_token/upload",
    optionalAuthMiddleware,        // Allow both auth and non-auth users
    uploadRateLimiter,             // Rate limit uploads
    upload.array('files', 10),    // Support multiple files
    guestUploadMediaController
);

// === MEDIA RETRIEVAL ===
// Get media by event (authenticated)
mediaRouter.get(
    "/event/:eventId",
    authMiddleware,
    eventAccessMiddleware,
    authorize('media.view'),
    mediaRateLimiter,
    getMediaByEventController
);

// Get media counts by approval status (moderation tab badges — host surface)
mediaRouter.get(
    "/event/:eventId/counts",
    authMiddleware,
    eventAccessMiddleware,
    authorize('media.approve'),
    mediaRateLimiter,
    getEventMediaCountsController
);

// Get media by album (authenticated)
mediaRouter.get(
    "/album/:albumId",
    authMiddleware,
    mediaRateLimiter,
    getMediaByAlbumController
);

// Get guest media (public access with token)
mediaRouter.get(
    "/guest/:shareToken",
    optionalAuthMiddleware,
    mediaRateLimiter,
    getGuestMediaController
);

// Get specific media by ID
mediaRouter.get(
    "/:media_id",
    authMiddleware,
    mediaAccessMiddleware,
    authorize('media.view'),
    mediaRateLimiter,
    getMediaByIdController
);

// === MEDIA MANAGEMENT ===
// Single media status update (approve/reject/hide — moderation)
mediaRouter.patch(
    "/:media_id/status",
    authMiddleware,
    mediaAccessMiddleware,
    authorize('media.approve'),
    updateMediaStatusController
);

// Bulk media status update (approve/reject — moderation)
mediaRouter.patch(
    "/event/:event_id/bulk-status",
    authMiddleware,
    eventAccessMiddleware,
    authorize('media.approve'),
    bulkUpdateMediaStatusController
);

// Delete media (always requires auth)
mediaRouter.delete(
    "/:media_id",
    authMiddleware,
    mediaAccessMiddleware,
    authorize('media.delete'),
    deleteMediaController
);

// Bulk soft delete media (POST used for reliable body support)
mediaRouter.post(
    "/event/:event_id/bulk-delete",
    authMiddleware,
    eventAccessMiddleware,
    authorize('media.delete'),
    bulkSoftDeleteMediaController
);

// === OPTIMIZATION ENDPOINTS ===
// Get media variants information
mediaRouter.get(
    "/:mediaId/variants",
    authMiddleware,
    mediaAccessMiddleware,
    authorize('media.view'),
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

// retryUploadController
// );

// === SEARCH ENDPOINTS ===
// Search for faces in event photos
mediaRouter.post(
    "/search/faces",
    optionalAuthMiddleware,
    faceSearchRateLimiter,
    upload.single('image'),
    wrap(searchFacesController)
);

export default mediaRouter;
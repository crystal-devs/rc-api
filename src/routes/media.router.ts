// routes/media.routes.ts

import express from "express";
import multer from "multer";
import { 
    uploadMediaController, 
    uploadCoverImageController, 
    getMediaByEventController, 
    getMediaByAlbumController,
    deleteMediaController
} from "@controllers/media.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const mediaRouter = express.Router();

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: { 
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Apply authentication middleware to all routes
mediaRouter.use(authMiddleware);

// Upload media to an album
mediaRouter.post("/upload", upload.single('image'), uploadMediaController);

// Upload a cover image for an event or album
mediaRouter.post("/upload-cover", upload.single('image'), uploadCoverImageController);

// Get media by event ID
mediaRouter.get("/event/:event_id", getMediaByEventController);

// Get media by album ID
mediaRouter.get("/album/:album_id", getMediaByAlbumController);

// Delete media by ID
mediaRouter.delete("/:media_id", deleteMediaController);

export default mediaRouter;
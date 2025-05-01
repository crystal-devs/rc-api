// routes/media.routes.ts

import express from "express";
import multer from "multer";
import { uploadMediaController, uploadCoverImageController } from "@controllers/media.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: { 
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Upload media to an album
router.post("/upload", upload.single('image'), uploadMediaController);

// Upload a cover image for an event or album
router.post("/upload-cover", upload.single('image'), uploadCoverImageController);

export default router;
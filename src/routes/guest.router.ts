import express from "express";
import multer from "multer";
import { loginWithFaceController } from "@controllers/guest/guest-auth.controller";
import { getMyPhotosController } from "@controllers/guest/guest-media.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const guestRouter = express.Router();
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// Configure multer for handling the selfie upload
const upload = multer({
    storage: multer.memoryStorage(), // Keep in memory for direct buffer access
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    }
});

// === PUBLIC GUEST ROUTES ===

// Face Login: Uploads a selfie -> Returns token + faceId
guestRouter.post(
    "/auth/face",
    upload.single('selfie'),
    wrap(loginWithFaceController)
);

// === PROTECTED GUEST ROUTES (Requires Guest Token) ===
// Ideally we should have a middleware that validates either User Auth OR Guest Token.
// For now, let's assume `authMiddleware` can handle it, or we create a specific `guestAuthMiddleware`.
// Given standard JWT, if we sign it with correct secret, `authMiddleware` essentially verifies it 
// and populates `req.user`.

guestRouter.get(
    "/media/mine",
    authMiddleware, // This will populate req.user with { sessionId, faceId, eventId }
    wrap(getMyPhotosController)
);

export default guestRouter;

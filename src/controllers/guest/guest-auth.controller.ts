import { Request, Response } from "express";
import { rekognitionService } from "@services/aws/rekognition.service";
import { GuestSession } from "@models/guest-session.model";
import { logger } from "@utils/logger";
import jwt from "jsonwebtoken";
import { keys } from "@configs/dotenv.config";

export const loginWithFaceController = async (req: Request, res: Response) => {
    try {
        const { eventId } = req.body;
        const file = req.file;

        if (!file || !eventId) {
            return res.status(400).json({ status: false, message: "Selfie and Event ID are required" });
        }

        // 1. Search for existing identity
        let faceId = await rekognitionService.searchFaceId(file.buffer, eventId);
        let isNewIdentity = false;

        // 2. If no match, register new identity
        if (!faceId) {
            faceId = await rekognitionService.indexFaceBuffer(file.buffer, eventId);
            isNewIdentity = true;
        }

        if (!faceId) {
            return res.status(500).json({ status: false, message: "Failed to process face" });
        }

        // 3. Find or Create Session for this Face Identity
        // We link this device/browser session to the Face Identity.
        // If a session exists for this FaceId, we reuse it (cross-device persistance logic usually requires a user account, 
        // but here we just want to GIVE ACCESS to the photos. So we can just issue a token with the FaceID).

        // However, we want to track "Guest Sessions" for analytics.
        // Let's create a new session or update existing one?
        // Simpler: Just create a new session for this device login.

        let session = await GuestSession.create({
            session_id: `gs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            event_id: eventId,
            access_method: 'face_login',
            aws_face_id: faceId,
            // TODO: Upload selfie to S3 and save URL here? For now, skip to save time/cost.
            guest_info: {
                name: 'Guest ' + faceId.substring(0, 6)
            }
        });

        // 4. Issue Token
        const token = jwt.sign(
            {
                sessionId: session._id,
                faceId: faceId,
                eventId: eventId,
                role: 'guest'
            },
            keys.jwtSecret as string,
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            status: true,
            data: {
                token,
                faceId,
                isNewIdentity,
                message: isNewIdentity ? "Welcome! We'll start finding your photos." : "Welcome back!"
            }
        });

    } catch (error: any) {
        logger.error("Login with face failed:", error);
        return res.status(500).json({ status: false, message: "Internal server error" });
    }
};

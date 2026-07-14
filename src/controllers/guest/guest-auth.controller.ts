import { Request, Response } from "express";
import { rekognitionService } from "@services/aws/rekognition.service";
import { GuestSession } from "@models/guest-session.model";
import { Event } from "@models/event.model";
import { logger } from "@utils/logger";
import jwt from "jsonwebtoken";
import { keys } from "@configs/dotenv.config";
import { generateSecureToken } from "@utils/secure-token.util";

export const loginWithFaceController = async (req: Request, res: Response) => {
    try {
        const { eventId } = req.body;
        const file = req.file;

        if (!file || !eventId) {
            return res.status(400).json({ status: false, message: "Selfie and Event ID are required" });
        }

        // DPDP gate: biometric processing requires the host to have opted the
        // event in, and the guest to explicitly consent (the client must send
        // consent=true alongside the selfie — the consent screen's checkbox).
        const event = await Event.findById(eventId).select('face_recognition').lean();
        if (!event) {
            return res.status(404).json({ status: false, message: "Event not found" });
        }
        if (!event.face_recognition?.enabled) {
            return res.status(403).json({
                status: false,
                message: "Face features are not enabled for this event"
            });
        }
        const consentGiven = req.body.consent === 'true' || req.body.consent === true;
        if (!consentGiven) {
            return res.status(400).json({
                status: false,
                message: "Explicit consent is required for face processing",
                error: { code: 'FACE_CONSENT_REQUIRED' }
            });
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
            session_id: generateSecureToken('gs'),
            event_id: eventId,
            access_method: 'face_login',
            aws_face_id: faceId,
            // TODO: Upload selfie to S3 and save URL here? For now, skip to save time/cost.
            guest_info: {
                name: 'Guest ' + faceId.substring(0, 6)
            },
            face_consent: {
                given: true,
                at: new Date(),
                version: event.face_recognition?.consent_version || 'v1',
                withdrawn_at: null
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

/**
 * Withdraw biometric consent (DPDP): deletes the guest's face from the event's
 * Rekognition collection, clears the stored identifiers, and records the
 * withdrawal timestamp. The guest keeps normal (non-face) access.
 * POST /api/guest/consent/withdraw — requires guest token
 */
export const withdrawFaceConsentController = async (req: Request, res: Response) => {
    try {
        const { sessionId } = (req as any).user || {};
        if (!sessionId) {
            return res.status(401).json({ status: false, message: "Unauthorized" });
        }

        const session = await GuestSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ status: false, message: "Session not found" });
        }

        if (session.aws_face_id) {
            await rekognitionService.deleteFaces(
                [session.aws_face_id],
                session.event_id.toString()
            );
        }

        session.aws_face_id = null;
        session.selfie_url = null;
        session.set('face_consent.given', false);
        session.set('face_consent.withdrawn_at', new Date());
        await session.save();

        logger.info(`Face consent withdrawn for guest session ${sessionId} (event ${session.event_id}) — face data deleted`);

        return res.status(200).json({
            status: true,
            message: "Your face data has been deleted and consent withdrawn."
        });
    } catch (error: any) {
        logger.error("Withdraw face consent failed:", error);
        return res.status(500).json({ status: false, message: "Internal server error" });
    }
};

import { Request, Response } from "express";
import { rekognitionService } from "@services/aws/rekognition.service";
import { Media } from "@models/media.model"; // Assuming Media model export
import { logger } from "@utils/logger";

export const getMyPhotosController = async (req: Request, res: Response) => {
    try {
        // User payload populated by Auth Middleware (Guest Token)
        const { faceId, eventId } = (req as any).user;

        if (!faceId || !eventId) {
            return res.status(401).json({ status: false, message: "Unauthorized: Missing face identity" });
        }

        // 1. Search AWS for all photos containing this face
        const awsMediaIds = await rekognitionService.searchByFaceId(faceId, eventId);

        // 2. Fetch Media Details from DB (Hybrid Search: AWS Link OR Direct DB Tag)
        // This supports both "Real" indexed photos and "Mock/Seeded" photos that have faceId in DB but not AWS.
        const photos = await Media.find({
            $or: [
                { _id: { $in: awsMediaIds } },
                { 'faces.faceId': faceId }
            ],
            status: { $in: ['active', 'approved'] } // Only show approved photos
        })
            .sort({ created_at: -1 })
            .limit(2000); // Increased limit for load testing

        return res.status(200).json({
            status: true,
            data: photos
        });

    } catch (error: any) {
        logger.error("Get My Photos failed:", error);
        return res.status(500).json({ status: false, message: "Internal server error" });
    }
};

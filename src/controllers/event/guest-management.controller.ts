import { Request, Response } from "express";
import { GuestSession } from "@models/guest-session.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";

export const getEventGuestSessionsController = async (req: Request, res: Response) => {
    try {
        const { eventId } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        // Query builder
        const query: any = { event_id: new mongoose.Types.ObjectId(eventId) };

        // Filter by status if provided
        if (req.query.status && req.query.status !== 'all') {
            query.status = req.query.status;
        }

        // Filter by access method if provided
        if (req.query.access_method && req.query.access_method !== 'all') {
            query.access_method = req.query.access_method;
        }

        const [sessions, total] = await Promise.all([
            GuestSession.find(query)
                .sort({ last_activity_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            GuestSession.countDocuments(query)
        ]);

        return res.status(200).json({
            status: true,
            data: sessions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error: any) {
        logger.error("Error fetching guest sessions:", error);
        return res.status(500).json({ status: false, message: "Internal server error" });
    }
};

export const revokeGuestSessionController = async (req: Request, res: Response) => {
    try {
        const { eventId, sessionId } = req.params;

        const session = await GuestSession.findOne({
            _id: sessionId,
            event_id: eventId
        });

        if (!session) {
            return res.status(404).json({ status: false, message: "Session not found" });
        }

        session.status = 'blocked';
        await session.save();

        logger.info(`Guest session ${sessionId} revoked by host`);

        return res.status(200).json({
            status: true,
            message: "Session access revoked",
            data: session
        });

    } catch (error: any) {
        logger.error("Error revoking session:", error);
        return res.status(500).json({ status: false, message: "Internal server error" });
    }
};

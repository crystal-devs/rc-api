/**
 * Session Management Controller
 * 
 * Provides API endpoints for users to view and manage their active sessions.
 * Industry-standard security feature for account protection.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import { SessionService } from "@services/auth/session.service";
import { logger } from "@utils/logger";

/**
 * GET /user/sessions
 * Returns list of all active sessions for the authenticated user
 */
export const getActiveSessionsController: RequestHandler = async (req, res, next) => {
    try {
        const userId = (req as any).user?._id?.toString();

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "User not authenticated"
            });
            return;
        }

        // Get current session ID from the request (if available)
        const currentSessionId = (req as any).sessionId;

        const sessions = await SessionService.getActiveSessions(userId, currentSessionId);

        res.status(200).json({
            status: true,
            message: "Active sessions retrieved",
            sessions: sessions.map(s => ({
                id: s.sessionId,
                device: {
                    name: s.deviceInfo.name,
                    type: s.deviceInfo.type,
                    os: s.deviceInfo.os,
                    browser: s.deviceInfo.browser
                },
                ip: s.ip,
                location: s.deviceInfo.location,
                createdAt: s.createdAt,
                lastActivity: s.lastActivityAt,
                isCurrent: s.isCurrentSession || false
            })),
            total: sessions.length
        });
    } catch (error) {
        logger.error("Get active sessions error:", error);
        next(error);
    }
};

/**
 * DELETE /user/sessions/:sessionId
 * Revoke a specific session
 */
export const revokeSessionController: RequestHandler = async (req, res, next) => {
    try {
        const userId = (req as any).user?._id?.toString();
        const { sessionId } = req.params;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "User not authenticated"
            });
            return;
        }

        if (!sessionId) {
            res.status(400).json({
                status: false,
                message: "Session ID is required"
            });
            return;
        }

        const success = await SessionService.revokeSession(userId, sessionId, 'user_revoke');

        if (success) {
            res.status(200).json({
                status: true,
                message: "Session revoked successfully"
            });
        } else {
            res.status(404).json({
                status: false,
                message: "Session not found or already revoked"
            });
        }
    } catch (error) {
        logger.error("Revoke session error:", error);
        next(error);
    }
};

/**
 * DELETE /user/sessions
 * Revoke all sessions except the current one
 */
export const revokeAllSessionsController: RequestHandler = async (req, res, next) => {
    try {
        const userId = (req as any).user?._id?.toString();
        const currentSessionId = (req as any).sessionId;

        if (!userId) {
            res.status(401).json({
                status: false,
                message: "User not authenticated"
            });
            return;
        }

        // Use a placeholder if no current session ID (shouldn't happen, but safety first)
        const excludeSessionId = currentSessionId || 'none';
        const revokedCount = await SessionService.revokeAllOtherSessions(userId, excludeSessionId);

        res.status(200).json({
            status: true,
            message: `${revokedCount} session(s) revoked successfully`,
            revokedCount
        });
    } catch (error) {
        logger.error("Revoke all sessions error:", error);
        next(error);
    }
};

export default {
    getActiveSessionsController,
    revokeSessionController,
    revokeAllSessionsController
};

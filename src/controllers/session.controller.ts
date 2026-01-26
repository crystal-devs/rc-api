// controllers/session.controller.ts
// ====================================
// Session management endpoints

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { injectedRequest } from 'types/injected-types';
import { sessionService } from '@services/auth/session.service';
import { auditService } from '@services/auth/audit.service';
import { logger } from '@utils/logger';

/**
 * Get all active sessions for the current user
 */
export const getActiveSessionsController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const currentSessionId = req.headers['x-session-id'] as string; // Could be passed from client

        const sessions = await sessionService.getActiveSessions(userId, currentSessionId);

        res.status(200).json({
            status: true,
            message: 'Active sessions retrieved',
            data: {
                sessions,
                total: sessions.length
            }
        });
    } catch (error: any) {
        logger.error('Error getting active sessions:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to retrieve sessions'
        });
    }
};

/**
 * Revoke a specific session
 */
export const revokeSessionController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const { sessionId } = req.params;

        if (!sessionId) {
            res.status(400).json({
                status: false,
                message: 'Session ID is required'
            });
            return;
        }

        const success = await sessionService.revokeSession(userId, sessionId, 'user_action');

        if (success) {
            // Audit the revocation
            await auditService.logEvent({
                eventType: 'token_revoke',
                userId,
                sessionId,
                ip: req.ip,
                userAgent: req.get('User-Agent') || '',
                success: true,
                metadata: { reason: 'user_action', revokedSessionId: sessionId }
            });

            res.status(200).json({
                status: true,
                message: 'Session revoked successfully'
            });
        } else {
            res.status(404).json({
                status: false,
                message: 'Session not found or already revoked'
            });
        }
    } catch (error: any) {
        logger.error('Error revoking session:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to revoke session'
        });
    }
};

/**
 * Revoke all other sessions (keep current session)
 */
export const revokeAllOtherSessionsController: RequestHandler = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const currentSessionId = req.headers['x-session-id'] as string;

        if (!currentSessionId) {
            res.status(400).json({
                status: false,
                message: 'Current session ID is required'
            });
            return;
        }

        const revokedCount = await sessionService.revokeAllOtherSessions(userId, currentSessionId);

        // Audit the bulk revocation
        await auditService.logEvent({
            eventType: 'token_revoke',
            userId,
            ip: req.ip,
            userAgent: req.get('User-Agent') || '',
            success: true,
            metadata: {
                reason: 'revoke_all_others',
                currentSessionId,
                revokedCount
            }
        });

        res.status(200).json({
            status: true,
            message: `${revokedCount} sessions revoked successfully`,
            data: { revokedCount }
        });
    } catch (error: any) {
        logger.error('Error revoking all other sessions:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to revoke sessions'
        });
    }
};
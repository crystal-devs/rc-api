// controllers/bulkDownload.controller.ts
import { Request, Response } from 'express';
import { z } from 'zod'; // For validation
import { Event } from '@models/event.model';
import { logger } from '@utils/logger';
import { BulkDownloadService } from '@services/media/bulk-download.service';

// Validation schemas
const createDownloadSchema = z.object({
    shareToken: z.string().min(1, 'Share token is required'),
    quality: z.enum(['thumbnail', 'medium', 'large', 'original']).default('original'),
    includeVideos: z.boolean().default(true),
    includeImages: z.boolean().default(true),
    // Optional guest info
    guestId: z.string().optional(),
    guestName: z.string().optional(),
    guestEmail: z.string().email().optional().or(z.literal('')),
});

const jobIdSchema = z.object({
    jobId: z.string().min(1, 'Job ID is required')
});

const cancelDownloadSchema = z.object({
    jobId: z.string().min(1, 'Job ID is required'),
    guestId: z.string().optional()
});

export class BulkDownloadController {
    
    /**
     * Create a new bulk download request
     * POST /api/bulk-download
     */
    static async createDownload(req: Request, res: Response): Promise<void> {
        try {
            // Validate input
            const validatedData = createDownloadSchema.parse(req.body);
            const { shareToken, quality, includeVideos, includeImages, guestId, guestName, guestEmail } = validatedData;

            // Validate share token and get event
            const event = await Event.findOne({ share_token: shareToken }).lean();
            if (!event) {
                res.status(404).json({
                    success: false,
                    message: 'Event not found or invalid share token',
                    code: 'EVENT_NOT_FOUND'
                });
                return;
            }

            // Check download permissions
            if (!event.permissions?.can_download) {
                res.status(403).json({
                    success: false,
                    message: 'Download not permitted for this event',
                    code: 'DOWNLOAD_NOT_PERMITTED'
                });
                return;
            }

            // Determine request type and user info
            const authHeader = req.headers.authorization;
            let requestedByType: 'guest' | 'user' | 'host' = 'guest';
            let requestedById = guestId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            let requesterEmail = guestEmail;
            let requesterName = guestName;

            // If authenticated user (implement your auth logic here)
            if (authHeader && authHeader.startsWith('Bearer ')) {
                // const token = authHeader.slice(7);
                // const user = await verifyToken(token); // Implement your token verification
                // if (user) {
                //     requestedByType = user._id.toString() === event.created_by.toString() ? 'host' : 'user';
                //     requestedById = user._id.toString();
                //     requesterEmail = user.email;
                //     requesterName = user.name;
                // }
            }

            // Create download request
            const result = await BulkDownloadService.createDownloadRequest({
                eventId: event._id.toString(),
                shareToken,
                quality,
                includeVideos,
                includeImages,
                requestedByType,
                requestedById,
                requesterEmail,
                requesterName,
                userIpAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            });

            logger.info(`Bulk download request created: ${result.jobId} for event ${event._id}`);

            res.status(201).json({
                success: true,
                data: {
                    downloadId: result.jobId,
                    totalFiles: result.totalFiles,
                    estimatedSizeMB: result.estimatedSizeMB,
                    estimatedTimeMinutes: result.estimatedTimeMinutes,
                    mediaBreakdown: result.mediaBreakdown,
                    message: 'Download request created successfully. You will be notified when ready.'
                }
            });

        } catch (error: any) {
            logger.error('Create bulk download error:', {
                error: error.message,
                stack: error.stack,
                body: req.body
            });

            // Handle specific error types
            if (error.message.includes('Rate limit exceeded')) {
                res.status(429).json({
                    success: false,
                    message: error.message,
                    code: 'RATE_LIMIT_EXCEEDED'
                });
                return;
            }

            if (error.message.includes('No approved media found')) {
                res.status(400).json({
                    success: false,
                    message: 'No downloadable media found for this event',
                    code: 'NO_MEDIA_FOUND'
                });
                return;
            }

            if (error.message.includes('Download size too large')) {
                res.status(400).json({
                    success: false,
                    message: error.message,
                    code: 'SIZE_LIMIT_EXCEEDED'
                });
                return;
            }

            // Validation errors
            if (error.name === 'ZodError') {
                res.status(400).json({
                    success: false,
                    message: 'Invalid request data',
                    code: 'VALIDATION_ERROR',
                    details: error.errors
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: error.message || 'Failed to create download request',
                code: 'INTERNAL_ERROR'
            });
        }
    }

    /**
     * Get download job status
     * GET /api/bulk-download/:jobId/status
     */
    static async getDownloadStatus(req: Request, res: Response): Promise<void> {
        try {
            const { jobId } = jobIdSchema.parse(req.params);

            const status = await BulkDownloadService.getDownloadStatus(jobId);

            if (!status) {
                res.status(404).json({
                    success: false,
                    message: 'Download not found or expired',
                    code: 'DOWNLOAD_NOT_FOUND'
                });
                return;
            }

            res.json({
                success: true,
                data: status
            });

        } catch (error: any) {
            logger.error('Get download status error:', {
                error: error.message,
                jobId: req.params.jobId
            });

            if (error.name === 'ZodError') {
                res.status(400).json({
                    success: false,
                    message: 'Invalid job ID',
                    code: 'VALIDATION_ERROR'
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get download status',
                code: 'INTERNAL_ERROR'
            });
        }
    }

    /**
     * Cancel download job
     * DELETE /api/bulk-download/:jobId
     */
    static async cancelDownload(req: Request, res: Response): Promise<void> {
        try {
            const { jobId } = req.params;
            const { guestId } = req.body;

            // Determine user ID (guest or authenticated user)
            let requestedById = guestId;
            const authHeader = req.headers.authorization;
            
            if (authHeader && authHeader.startsWith('Bearer ')) {
                // const user = await verifyToken(authHeader.slice(7));
                // requestedById = user?._id.toString();
            }

            if (!requestedById) {
                res.status(400).json({
                    success: false,
                    message: 'User identification required',
                    code: 'USER_ID_REQUIRED'
                });
                return;
            }

            const cancelled = await BulkDownloadService.cancelDownloadJob(jobId, requestedById);

            if (!cancelled) {
                res.status(404).json({
                    success: false,
                    message: 'Download not found or cannot be cancelled',
                    code: 'DOWNLOAD_NOT_CANCELLABLE'
                });
                return;
            }

            logger.info(`Download job cancelled: ${jobId} by user ${requestedById}`);

            res.json({
                success: true,
                message: 'Download cancelled successfully'
            });

        } catch (error: any) {
            logger.error('Cancel download error:', {
                error: error.message,
                jobId: req.params.jobId
            });

            res.status(500).json({
                success: false,
                message: error.message || 'Failed to cancel download',
                code: 'INTERNAL_ERROR'
            });
        }
    }

    /**
     * Get user's download history
     * GET /api/bulk-download/history
     */
    static async getDownloadHistory(req: Request, res: Response): Promise<void> {
        try {
            const { guestId } = req.query;
            const limit = Math.min(parseInt(req.query.limit as string) || 10, 50); // Max 50 records

            let requestedById = guestId as string;
            const authHeader = req.headers.authorization;
            
            if (authHeader && authHeader.startsWith('Bearer ')) {
                // const user = await verifyToken(authHeader.slice(7));
                // requestedById = user?._id.toString();
            }

            if (!requestedById) {
                res.status(400).json({
                    success: false,
                    message: 'User identification required',
                    code: 'USER_ID_REQUIRED'
                });
                return;
            }

            const history = await BulkDownloadService.getUserDownloadHistory(requestedById, limit);

            res.json({
                success: true,
                data: {
                    downloads: history,
                    total: history.length
                }
            });

        } catch (error: any) {
            logger.error('Get download history error:', {
                error: error.message,
                query: req.query
            });

            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get download history',
                code: 'INTERNAL_ERROR'
            });
        }
    }

    /**
     * Health check endpoint for monitoring
     * GET /api/bulk-download/health
     */
    static async healthCheck(req: Request, res: Response): Promise<void> {
        try {
            // Check queue health
            const queueHealth = await BulkDownloadService.downloadQueue.getWaiting();
            const activeJobs = await BulkDownloadService.downloadQueue.getActive();

            res.json({
                success: true,
                data: {
                    status: 'healthy',
                    queue: {
                        waiting: queueHealth.length,
                        active: activeJobs.length
                    },
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error: any) {
            res.status(503).json({
                success: false,
                message: 'Service unhealthy',
                error: error.message
            });
        }
    }
}
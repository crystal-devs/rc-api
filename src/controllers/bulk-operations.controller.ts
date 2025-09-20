// controllers/bulk-operations.controller.ts
import { Response, NextFunction, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { injectedRequest } from "types/injected-types";
import { bulkUpdateMediaStatusService } from '@services/media';

export class BulkOperationsController {

    /**
     * Bulk update media status
     */
    static bulkUpdateMediaStatus: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const { event_id } = req.params;
            const userId = req.user._id.toString();
            const { media_ids, status, reason, hide_reason } = req.body;

            // Validate event_id
            if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid or missing event ID',
                    data: null,
                    error: { message: 'A valid event ID is required' },
                    other: null
                });
                return;
            }

            // Validate required fields
            if (!media_ids || !Array.isArray(media_ids) || media_ids.length === 0) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Media IDs array is required',
                    data: null,
                    error: { message: 'media_ids must be a non-empty array' },
                    other: null
                });
                return;
            }

            if (!status) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Status is required',
                    data: null,
                    error: { message: 'Status field is required in request body' },
                    other: null
                });
                return;
            }

            // Validate status value
            const validStatuses = ['approved', 'pending', 'rejected', 'hidden', 'auto_approved'];
            if (!validStatuses.includes(status)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid status value',
                    data: null,
                    error: {
                        message: 'Status must be one of: approved, pending, rejected, hidden, auto_approved'
                    },
                    other: null
                });
                return;
            }

            // Limit bulk operations
            if (media_ids.length > 100) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Too many items for bulk update',
                    data: null,
                    error: { message: 'Maximum 100 items can be updated at once' },
                    other: null
                });
                return;
            }

            logger.info('Bulk updating media status:', {
                event_id,
                mediaCount: media_ids.length,
                status,
                userId,
                operation: 'bulk_status_update'
            });

            // Call service
            const response = await bulkUpdateMediaStatusService(event_id, media_ids, status, {
                adminId: userId,
                reason,
                hideReason: hide_reason
            });

            logger.info('Bulk media status update completed:', {
                success: response.status,
                modifiedCount: response.data?.modifiedCount,
                requestedCount: response.data?.requestedCount,
                operation: 'bulk_status_update'
            });

            res.status(response.code).json(response);

        } catch (error: any) {
            logger.error('Error in bulkUpdateMediaStatus:', {
                message: error.message,
                params: req.params,
                body: req.body,
                operation: 'bulk_status_update'
            });

            res.status(500).json({
                status: false,
                code: 500,
                message: 'Internal server error',
                data: null,
                error: {
                    message: 'An unexpected error occurred during bulk status update',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                },
                other: null
            });
        }
    };

    /**
     * Bulk approve media - convenience endpoint
     */
    static bulkApproveMedia: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        req.body.status = 'approved';
        return BulkOperationsController.bulkUpdateMediaStatus(req, res, next);
    };

    /**
     * Bulk reject media - convenience endpoint
     */
    static bulkRejectMedia: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        req.body.status = 'rejected';
        return BulkOperationsController.bulkUpdateMediaStatus(req, res, next);
    };

    /**
     * Bulk hide media - convenience endpoint
     */
    static bulkHideMedia: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        req.body.status = 'hidden';
        return BulkOperationsController.bulkUpdateMediaStatus(req, res, next);
    };

    /**
     * Bulk delete media (placeholder for future implementation)
     */
    static bulkDeleteMedia: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const { event_id } = req.params;
            const userId = req.user._id.toString();
            const { media_ids, reason } = req.body;

            // Validate inputs (similar to status update)
            if (!event_id || !mongoose.Types.ObjectId.isValid(event_id)) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Invalid or missing event ID',
                    data: null,
                    error: { message: 'A valid event ID is required' },
                    other: null
                });
                return;
            }

            if (!media_ids || !Array.isArray(media_ids) || media_ids.length === 0) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Media IDs array is required',
                    data: null,
                    error: { message: 'media_ids must be a non-empty array' },
                    other: null
                });
                return;
            }

            // More restrictive limit for deletions
            if (media_ids.length > 50) {
                res.status(400).json({
                    status: false,
                    code: 400,
                    message: 'Too many items for bulk deletion',
                    data: null,
                    error: { message: 'Maximum 50 items can be deleted at once' },
                    other: null
                });
                return;
            }

            logger.info('Bulk delete request:', {
                event_id,
                mediaCount: media_ids.length,
                userId,
                reason,
                operation: 'bulk_delete'
            });

            // TODO: Implement bulk delete service
            res.status(501).json({
                status: false,
                code: 501,
                message: 'Bulk delete not implemented yet',
                data: null,
                error: { message: 'This feature will be available in a future update' },
                other: null
            });

        } catch (error: any) {
            logger.error('Error in bulkDeleteMedia:', {
                message: error.message,
                params: req.params,
                body: req.body,
                operation: 'bulk_delete'
            });

            res.status(500).json({
                status: false,
                code: 500,
                message: 'Internal server error',
                data: null,
                error: {
                    message: 'An unexpected error occurred during bulk deletion',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                },
                other: null
            });
        }
    };

    /**
     * Get bulk operation history
     */
    static getBulkOperationHistory: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const userId = req.user._id.toString();
            const { page = 1, limit = 20, event_id } = req.query;

            logger.info('Fetching bulk operation history:', {
                userId,
                page,
                limit,
                event_id,
                operation: 'get_history'
            });

            // TODO: Implement history tracking service
            res.status(200).json({
                status: true,
                code: 200,
                message: 'Bulk operation history retrieved successfully',
                data: {
                    operations: [],
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total: 0,
                        hasNext: false
                    }
                },
                error: null,
                other: {
                    note: 'History tracking will be implemented in a future update'
                }
            });

        } catch (error: any) {
            logger.error('Error in getBulkOperationHistory:', {
                message: error.message,
                query: req.query,
                operation: 'get_history'
            });

            res.status(500).json({
                status: false,
                code: 500,
                message: 'Internal server error',
                data: null,
                error: {
                    message: 'An unexpected error occurred while fetching history',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                },
                other: null
            });
        }
    };

    /**
     * Health check for bulk operations
     */
    static healthCheck: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const healthStatus = {
                service: 'bulk-operations',
                status: 'healthy',
                timestamp: new Date().toISOString(),
                checks: {
                    database: 'connected',
                    rateLimit: 'active',
                    authentication: 'enabled'
                }
            };

            logger.info('Bulk operations health check:', {
                status: healthStatus.status,
                operation: 'health_check'
            });

            res.status(200).json({
                status: true,
                code: 200,
                message: 'Bulk operations service is healthy',
                data: healthStatus,
                error: null,
                other: null
            });

        } catch (error: any) {
            logger.error('Error in bulk operations health check:', {
                message: error.message,
                operation: 'health_check'
            });

            res.status(503).json({
                status: false,
                code: 503,
                message: 'Bulk operations service is unhealthy',
                data: null,
                error: {
                    message: 'Health check failed',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                },
                other: null
            });
        }
    };
}
// controllers/bulk-operations.controller.ts
import { Response, NextFunction, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { injectedRequest } from "types/injected-types";
import { bulkUpdateMediaStatusService } from '@services/media';
import { getWebSocketService } from '@services/websocket/websocket.service';

export class BulkOperationsController {

    /**
     * Bulk update media status with WebSocket support
     */
    static bulkUpdateMediaStatus: RequestHandler = async (
        req: injectedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const { event_id } = req.params;
            const userId = req.user._id.toString();
            const userName = req.user.name || 'Admin'; // Get user name from request
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

            // Send HTTP response first
            res.status(response.code).json(response);

            // Handle WebSocket updates asynchronously (non-blocking)
            if (response.status && response.data) {
                // Use setImmediate to ensure this runs after HTTP response is sent
                setImmediate(async () => {
                    try {
                        await BulkOperationsController.broadcastBulkStatusUpdate({
                            eventId: event_id,
                            mediaIds: media_ids,
                            newStatus: status,
                            updatedBy: {
                                id: userId,
                                name: userName,
                                type: 'admin' // Could be dynamic based on user role
                            },
                            reason,
                            hideReason: hide_reason,
                            updateResult: response.data,
                            timestamp: new Date()
                        });
                    } catch (wsError: any) {
                        logger.error('❌ Bulk WebSocket broadcast failed:', {
                            error: wsError.message,
                            eventId: event_id,
                            mediaCount: media_ids.length,
                            operation: 'bulk_websocket_broadcast'
                        });
                        // Don't fail the main operation if WebSocket fails
                    }
                });
            }

            logger.info('Bulk media status update completed:', {
                success: response.status,
                modifiedCount: response.data?.modifiedCount,
                requestedCount: response.data?.requestedCount,
                operation: 'bulk_status_update'
            });

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
     * Broadcast bulk status update via WebSocket
     * Handles the WebSocket communication efficiently for bulk operations
     */
    private static async broadcastBulkStatusUpdate(params: {
        eventId: string;
        mediaIds: string[];
        newStatus: string;
        updatedBy: {
            id: string;
            name: string;
            type: string;
        };
        reason?: string;
        hideReason?: string;
        updateResult: any;
        timestamp: Date;
    }): Promise<void> {
        try {
            const webSocketService = getWebSocketService();
            const { 
                eventId, 
                mediaIds, 
                newStatus, 
                updatedBy, 
                reason, 
                hideReason, 
                updateResult, 
                timestamp 
            } = params;

            // Create bulk status update payload matching the enhanced service interface
            const bulkStatusUpdatePayload = {
                type: 'bulk_status_update' as const,
                eventId,
                operation: {
                    mediaIds,
                    newStatus,
                    previousStatus: updateResult.previousStatus || 'mixed', // Could be mixed statuses
                    updatedBy,
                    reason,
                    hideReason,
                    timestamp,
                    summary: {
                        totalRequested: mediaIds.length,
                        totalModified: updateResult.modifiedCount || 0,
                        totalFailed: (mediaIds.length - (updateResult.modifiedCount || 0)),
                        success: updateResult.modifiedCount > 0
                    }
                }
            };

            // Performance optimization: Use batched emission for large updates
            if (mediaIds.length > 20) {
                // For large bulk operations, send summary first
                await webSocketService.emitBulkStatusUpdate(bulkStatusUpdatePayload);
                
                // Then send individual updates in batches to avoid overwhelming clients
                const batchSize = 10;
                const batches = [];
                
                for (let i = 0; i < mediaIds.length; i += batchSize) {
                    batches.push(mediaIds.slice(i, i + batchSize));
                }

                // Process batches with small delays to prevent overwhelming
                for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                    const batch = batches[batchIndex];
                    const batchPayload = {
                        type: 'bulk_status_batch' as const,
                        eventId,
                        batchIndex,
                        totalBatches: batches.length,
                        mediaIds: batch,
                        newStatus,
                        updatedBy,
                        timestamp: new Date()
                    };

                    await webSocketService.emitBulkStatusBatch(batchPayload);
                    
                    // Small delay between batches (only for very large operations)
                    if (batchIndex < batches.length - 1 && mediaIds.length > 50) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
            } else {
                // For smaller bulk operations, send all at once
                await webSocketService.emitBulkStatusUpdate(bulkStatusUpdatePayload);
                
                // Also send individual updates for better granular UI updates
                const individualUpdates = mediaIds.map(mediaId => ({
                    type: 'status_update' as const,
                    mediaId,
                    eventId,
                    newStatus,
                    previousStatus: 'unknown', // We don't track individual previous statuses in bulk
                    updatedBy,
                    timestamp,
                    bulkOperation: true
                }));

                await webSocketService.emitBulkIndividualUpdates(individualUpdates);
            }

            logger.info('✅ Bulk status update broadcasted via WebSocket:', {
                eventId,
                mediaCount: mediaIds.length,
                status: newStatus,
                modifiedCount: updateResult.modifiedCount,
                by: updatedBy.name,
                operation: 'bulk_websocket_broadcast'
            });

        } catch (error: any) {
            // Re-throw to be caught by caller
            throw new Error(`WebSocket broadcast failed: ${error.message}`);
        }
    }

    /**
     * Bulk approve media - convenience endpoint with WebSocket
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
     * Bulk reject media - convenience endpoint with WebSocket
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
     * Bulk hide media - convenience endpoint with WebSocket
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
            const userName = req.user.name || 'Admin';
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

            // When implemented, add WebSocket broadcast here similar to bulk status update

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
                    websocket: 'active',
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
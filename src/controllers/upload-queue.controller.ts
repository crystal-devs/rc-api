// controllers/upload-queue.controller.ts
// Complete API endpoints for upload queue visualization

import { Request, Response } from 'express';
import { Media } from '@models/media.model';
import { getImageQueue } from 'queues/imageQueue';
import { logger } from '@utils/logger';
import mongoose from 'mongoose';

interface AuthenticatedRequest extends Request {
    user: {
        _id: mongoose.Types.ObjectId | string;
        role?: string;
    };
}

/**
 * 📊 Get upload queue data for an event
 */
export const getUploadQueueController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response | void> => {
    try {
        const { eventId } = req.params;
        const { status, limit = 50, offset = 0 } = req.query;

        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                status: false,
                message: "Valid event_id is required"
            });
        }

        // Build query filters
        const matchFilters: any = {
            event_id: new mongoose.Types.ObjectId(eventId)
        };

        if (status && status !== 'all') {
            if (status === 'active') {
                matchFilters['processing.status'] = { $in: ['pending', 'processing'] };
            } else if (status === 'completed') {
                matchFilters['processing.status'] = 'completed';
            } else if (status === 'failed') {
                matchFilters['processing.status'] = 'failed';
            } else {
                matchFilters['processing.status'] = status;
            }
        }

        // Get queue items with uploader info
        const queueItems = await Media.aggregate([
            { $match: matchFilters },
            {
                $lookup: {
                    from: 'users',
                    localField: 'uploaded_by',
                    foreignField: '_id',
                    as: 'uploader_info'
                }
            },
            {
                $addFields: {
                    uploader_name: {
                        $cond: {
                            if: { $eq: ['$uploader_type', 'guest'] },
                            then: '$guest_uploader.name',
                            else: { $arrayElemAt: ['$uploader_info.name', 0] }
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 1,
                    original_filename: 1,
                    size_mb: 1,
                    uploader_type: 1,
                    uploader_name: 1,
                    'processing.status': 1,
                    'processing.current_stage': 1,
                    'processing.progress_percentage': 1,
                    'processing.started_at': 1,
                    'processing.completed_at': 1,
                    'processing.error_message': 1,
                    'processing.retry_count': 1,
                    'processing.job_id': 1,
                    url: 1,
                    created_at: 1
                }
            },
            { $sort: { created_at: -1 } },
            { $skip: parseInt(offset as string) },
            { $limit: parseInt(limit as string) }
        ]);

        // Get queue statistics
        const stats = await getQueueStatistics(eventId);

        // Add queue position for waiting jobs
        const transformedItems = await Promise.all(queueItems.map(async item => {
            let queuePosition;
            if (item.processing?.job_id && item.processing?.status === 'pending') {
                queuePosition = await getQueuePosition(item.processing.job_id);
            }

            return {
                mediaId: item._id.toString(),
                filename: item.original_filename || 'Unknown',
                uploader: {
                    id: item.uploader_type === 'guest' ? 'guest' : 'admin',
                    name: item.uploader_name || 'Unknown',
                    type: item.uploader_type
                },
                status: mapProcessingStatus(item.processing?.status),
                stage: item.processing?.current_stage || 'uploading',
                progress: item.processing?.progress_percentage || 0,
                size: item.size_mb || 0,
                queuePosition,
                startTime: item.processing?.started_at,
                completedTime: item.processing?.completed_at,
                error: item.processing?.error_message,
                retryCount: item.processing?.retry_count || 0,
                jobId: item.processing?.job_id,
                thumbnail: item.url,
                estimatedTime: queuePosition ? queuePosition * 30 : undefined // 30 seconds per job estimate
            };
        }));

        return res.json({
            status: true,
            data: {
                items: transformedItems,
                stats,
                pagination: {
                    offset: parseInt(offset as string),
                    limit: parseInt(limit as string),
                    total: stats.total
                }
            }
        });

    } catch (error: any) {
        logger.error('Failed to get upload queue:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to retrieve upload queue',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * 📊 Get queue statistics for an event
 */
export const getQueueStatsController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response | void> => {
    try {
        const { eventId } = req.params;

        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                status: false,
                message: "Valid event_id is required"
            });
        }

        const stats = await getQueueStatistics(eventId);

        return res.json({
            status: true,
            data: stats
        });

    } catch (error: any) {
        logger.error('Failed to get queue stats:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to retrieve queue statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * 🔄 Retry failed upload
 */
export const retryUploadController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response | void> => {
    try {
        const { eventId, mediaId } = req.params;

        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({
                status: false,
                message: "Valid event_id is required"
            });
        }

        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return res.status(400).json({
                status: false,
                message: "Valid media_id is required"
            });
        }

        // Find the failed media item
        const media = await Media.findOne({
            _id: new mongoose.Types.ObjectId(mediaId),
            event_id: new mongoose.Types.ObjectId(eventId),
            'processing.status': 'failed'
        });

        if (!media) {
            return res.status(404).json({
                status: false,
                message: "Failed upload not found"
            });
        }

        // Reset processing status
        media.processing.status = 'pending';
        media.processing.current_stage = 'uploading';
        media.processing.progress_percentage = 0;
        media.processing.error_message = '';
        media.processing.retry_count = (media.processing.retry_count || 0) + 1;
        media.processing.started_at = new Date();
        
        await media.save();

        // Re-queue the job if possible
        const imageQueue = getImageQueue();
        if (imageQueue) {
            const job = await imageQueue.add('process-image', {
                mediaId: media._id.toString(),
                eventId,
                albumId: media.album_id.toString(),
                originalFilename: media.original_filename,
                fileSize: media.size_mb * 1024 * 1024, // Convert back to bytes
                mimeType: `image/${media.format}`,
                isRetry: true,
                retryCount: media.processing.retry_count
            }, {
                priority: 8, // Higher priority for retries
                attempts: 2,
                backoff: { type: 'exponential', delay: 3000 }
            });

            media.processing.job_id = job.id?.toString();
            await media.save();

            logger.info(`📄 Retry queued for ${mediaId}: Job ${job.id}`);
        }

        return res.json({
            status: true,
            message: 'Upload retry initiated',
            data: {
                mediaId,
                jobId: media.processing.job_id,
                retryCount: media.processing.retry_count
            }
        });

    } catch (error: any) {
        logger.error('Failed to retry upload:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to retry upload',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * ⏸️ Pause/Resume upload
 */
export const pauseResumeUploadController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response | void> => {
    try {
        const { eventId, mediaId } = req.params;
        const { action } = req.body; // 'pause' or 'resume'

        if (!['pause', 'resume'].includes(action)) {
            return res.status(400).json({
                status: false,
                message: "Action must be 'pause' or 'resume'"
            });
        }

        // Find the media item
        const media = await Media.findOne({
            _id: new mongoose.Types.ObjectId(mediaId),
            event_id: new mongoose.Types.ObjectId(eventId)
        });

        if (!media) {
            return res.status(404).json({
                status: false,
                message: "Upload not found"
            });
        }

        const imageQueue = getImageQueue();
        if (!imageQueue || !media.processing.job_id) {
            return res.status(400).json({
                status: false,
                message: "Cannot control upload - queue or job not found"
            });
        }

        if (action === 'pause') {
            // For BullMQ, we can't pause jobs directly, so we mark as paused in DB
            media.processing.status = 'paused';
            await media.save();
            
            logger.info(`⏸️ Paused upload: ${mediaId}`);
        } else {
            // Resume the job
            media.processing.status = 'pending';
            await media.save();
            
            logger.info(`▶️ Resumed upload: ${mediaId}`);
        }

        return res.json({
            status: true,
            message: `Upload ${action}d successfully`,
            data: {
                mediaId,
                action,
                status: media.processing.status
            }
        });

    } catch (error: any) {
        logger.error(`Failed to ${req.body.action} upload:`, error);
        return res.status(500).json({
            status: false,
            message: `Failed to ${req.body.action} upload`,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * ❌ Cancel upload
 */
export const cancelUploadController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response | void> => {
    try {
        const { eventId, mediaId } = req.params;

        // Find and delete the media item
        const media = await Media.findOneAndDelete({
            _id: new mongoose.Types.ObjectId(mediaId),
            event_id: new mongoose.Types.ObjectId(eventId),
            'processing.status': { $in: ['pending', 'processing', 'paused'] }
        });

        if (!media) {
            return res.status(404).json({
                status: false,
                message: "Active upload not found"
            });
        }

        // Try to remove from queue
        const imageQueue = getImageQueue();
        if (imageQueue && media.processing.job_id) {
            try {
                const job = await imageQueue.getJob(media.processing.job_id);
                if (job) {
                    await job.remove();
                    logger.info(`🗑️ Removed job ${media.processing.job_id} from queue`);
                }
            } catch (jobError) {
                logger.warn('Failed to remove job from queue:', jobError);
            }
        }

        logger.info(`❌ Cancelled upload: ${mediaId}`);

        return res.json({
            status: true,
            message: 'Upload cancelled successfully',
            data: {
                mediaId,
                filename: media.original_filename
            }
        });

    } catch (error: any) {
        logger.error('Failed to cancel upload:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to cancel upload',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * 🧹 Clear completed/failed uploads from queue view
 */
export const clearQueueHistoryController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response | void> => {
    try {
        const { eventId } = req.params;
        const { olderThan } = req.query; // Hours

        const hoursAgo = parseInt(olderThan as string) || 24; // Default 24 hours
        const cutoffDate = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000));

        // This doesn't delete the media, just clears old processing data
        const result = await Media.updateMany({
            event_id: new mongoose.Types.ObjectId(eventId),
            'processing.status': { $in: ['completed', 'failed'] },
            'processing.completed_at': { $lt: cutoffDate }
        }, {
            $unset: {
                'processing.job_id': '',
                'processing.retry_count': '',
                'processing.error_message': ''
            }
        });

        logger.info(`🧹 Cleared queue history for ${result.modifiedCount} items`);

        return res.json({
            status: true,
            message: `Cleared ${result.modifiedCount} items from queue history`,
            data: {
                clearedCount: result.modifiedCount,
                cutoffDate
            }
        });

    } catch (error: any) {
        logger.error('Failed to clear queue history:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to clear queue history',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getQueueStatistics(eventId: string) {
    try {
        const eventObjectId = new mongoose.Types.ObjectId(eventId);

        // Get status counts
        const statusCounts = await Media.aggregate([
            { $match: { event_id: eventObjectId } },
            {
                $group: {
                    _id: '$processing.status',
                    count: { $sum: 1 },
                    avgProcessingTime: {
                        $avg: {
                            $cond: {
                                if: { $eq: ['$processing.status', 'completed'] },
                                then: '$processing.processing_time_ms',
                                else: null
                            }
                        }
                    }
                }
            }
        ]);

        // Initialize stats
        const stats = {
            total: 0,
            queued: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            paused: 0,
            totalProcessingTime: 0,
            averageProcessingTime: 0,
            queueThroughput: 0
        };

        // Map status counts
        statusCounts.forEach(item => {
            const status = item._id;
            const count = item.count;

            stats.total += count;

            switch (status) {
                case 'pending':
                    stats.queued += count;
                    break;
                case 'processing':
                    stats.processing += count;
                    break;
                case 'completed':
                    stats.completed += count;
                    stats.averageProcessingTime = Math.round((item.avgProcessingTime || 0) / 1000); // Convert to seconds
                    break;
                case 'failed':
                    stats.failed += count;
                    break;
                case 'paused':
                    stats.paused += count;
                    break;
            }
        });

        // Calculate throughput (items completed in last hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentCompletions = await Media.countDocuments({
            event_id: eventObjectId,
            'processing.status': 'completed',
            'processing.completed_at': { $gte: oneHourAgo }
        });

        stats.queueThroughput = recentCompletions;

        // Get real queue health info from BullMQ
        const imageQueue = getImageQueue();
        if (imageQueue) {
            try {
                const [waiting, active] = await Promise.all([
                    imageQueue.getWaiting(),
                    imageQueue.getActive()
                ]);

                // Override with real queue numbers if available
                if (waiting.length > 0) stats.queued = waiting.length;
                if (active.length > 0) stats.processing = active.length;
            } catch (queueError) {
                logger.warn('Failed to get real-time queue stats from BullMQ:', queueError);
            }
        }

        return stats;

    } catch (error) {
        logger.error('Failed to get queue statistics:', error);
        return {
            total: 0,
            queued: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            paused: 0,
            totalProcessingTime: 0,
            averageProcessingTime: 0,
            queueThroughput: 0
        };
    }
}

function mapProcessingStatus(status: string): string {
    const statusMap: Record<string, string> = {
        'pending': 'queued',
        'processing': 'processing',
        'completed': 'completed',
        'failed': 'failed',
        'paused': 'paused'
    };
    return statusMap[status] || 'queued';
}

// Get current queue position for an item
async function getQueuePosition(jobId: string): Promise<number | undefined> {
    try {
        const imageQueue = getImageQueue();
        if (!imageQueue) return undefined;

        const waiting = await imageQueue.getWaiting();
        const position = waiting.findIndex(job => job.id === jobId);
        return position >= 0 ? position + 1 : undefined;
    } catch (error) {
        logger.warn('Failed to get queue position:', error);
        return undefined;
    }
}
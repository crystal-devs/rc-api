// services/cleanup.service.ts
import cron from 'node-cron';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import { logger } from '@utils/logger';
import { MonitoringService } from '@utils/monitoring';
import { keys } from '@configs/dotenv.config';
import { Media } from '@models/media.model';

// Initialize S3 client locally (following the same pattern as other controllers)
const s3Client = new S3Client({
    region: keys.awsRegion as string,
    credentials: {
        accessKeyId: keys.awsAccessKeyId as string,
        secretAccessKey: keys.awsSecretAccessKey as string,
    },
});

interface CleanupStats {
    scanned: number;
    deleted: number;
    failed: number;
    startTime: number;
    errors: Array<{ docId: string; error: string }>;
}

interface CleanupResult {
    status: 'ok' | 'error';
    message: string;
    stats: CleanupStats & { duration: string; successRate: string };
}

export class CleanupService {

    static initializeBulkDownloadCleanupJobs() {
        // Run cleanup every hour for expired downloads
        cron.schedule('0 * * * *', async () => {
            try {
                logger.info('Starting scheduled cleanup of expired downloads');
                logger.info('Completed scheduled cleanup');
            } catch (error) {
                logger.error('Bulk download cleanup job failed:', error);
            }
        });

        // Check for stuck jobs every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            try {
                const stuckJobsCount = await MonitoringService.checkStuckJobs();
                if (stuckJobsCount > 0) {
                    logger.warn(`Found and fixed ${stuckJobsCount} stuck download jobs`);
                }
            } catch (error) {
                logger.error('Stuck job monitoring failed:', error);
            }
        });

        logger.info('Bulk download cleanup jobs scheduled');
    }

    static async cleanupDeletedMedia(db: mongoose.Connection): Promise<CleanupResult> {
        const stats: CleanupStats = {
            scanned: 0,
            deleted: 0,
            failed: 0,
            startTime: Date.now(),
            errors: []
        };

        try {
            const RETENTION_MINUTES = parseInt(process.env.RETENTION_MINUTES || '1', 10);
            const cutoff = new Date(Date.now() - RETENTION_MINUTES * 60 * 1000);

            logger.info(`Searching for media deleted before: ${cutoff.toISOString()}`);

            // Use Mongoose model instead of raw collection for better type safety
            const query = {
                isDeleted: true,
                deletedAt: { $lt: cutoff },
                $or: [
                    { deletionStatus: { $exists: false } },
                    { deletionStatus: { $ne: 'done' } }
                ]
            };

            // Get documents using Mongoose (better for your codebase)
            const documents = await Media.find(query)
                .select('_id s3Keys uploadId deletionAttempts image_variants url')
                .lean()
                .limit(1000); // Limit for safety

            logger.info(`Found ${documents.length} documents to process`);

            let batch: any[] = [];
            const BATCH_SIZE = 100;

            for (const doc of documents) {
                stats.scanned++;
                batch.push(doc);

                if (batch.length >= BATCH_SIZE) {
                    await this.processBatch(db, batch, stats);
                    batch = [];
                }
            }

            // Process remaining documents
            if (batch.length > 0) {
                await this.processBatch(db, batch, stats);
            }

            const duration = Date.now() - stats.startTime;
            logger.info(`Cleanup complete: scanned=${stats.scanned}, deleted=${stats.deleted}, failed=${stats.failed}, duration=${duration}ms`);

            return {
                status: 'ok',
                message: 'Cleanup completed successfully',
                stats: {
                    ...stats,
                    duration: `${duration}ms`,
                    successRate: stats.scanned > 0 ? ((stats.deleted / stats.scanned) * 100).toFixed(2) + '%' : 'N/A'
                }
            };

        } catch (error: any) {
            logger.error('Cleanup error:', error);

            return {
                status: 'error',
                message: 'Cleanup failed',
                stats: {
                    ...stats,
                    duration: `${Date.now() - stats.startTime}ms`,
                    successRate: stats.scanned > 0 ? ((stats.deleted / stats.scanned) * 100).toFixed(2) + '%' : 'N/A'
                }
            };
        }
    }

    private static async processBatch(db: mongoose.Connection, batch: any[], stats: CleanupStats): Promise<void> {
        for (const doc of batch) {
            try {
                await this.processDocument(db, doc, stats);
            } catch (error: any) {
                logger.error(`Error processing document ${doc._id}:`, error.message);
                stats.failed++;
                stats.errors.push({
                    docId: doc._id.toString(),
                    error: error.message
                });
            }
        }
    }

    private static async processDocument(db: mongoose.Connection, doc: any, stats: CleanupStats): Promise<void> {
        const docId = doc._id;

        // Extract S3 keys from the document - handle both old and new formats
        let s3Keys: string[] = [];

        logger.info(`Processing document ${docId} for S3 key extraction`);

        if (doc.s3Keys && Array.isArray(doc.s3Keys)) {
            s3Keys = doc.s3Keys;
            logger.info(`Found ${s3Keys.length} keys in s3Keys array for ${docId}`);
        } else if (doc.image_variants) {
            // Extract keys from image variants
            const variants = doc.image_variants;
            if (variants.original?.public_id) s3Keys.push(variants.original.public_id);
            if (variants.small?.webp?.public_id) s3Keys.push(variants.small.webp.public_id);
            if (variants.small?.jpeg?.public_id) s3Keys.push(variants.small.jpeg.public_id);
            if (variants.medium?.webp?.public_id) s3Keys.push(variants.medium.webp.public_id);
            if (variants.medium?.jpeg?.public_id) s3Keys.push(variants.medium.jpeg.public_id);
            if (variants.large?.webp?.public_id) s3Keys.push(variants.large.webp.public_id);
            if (variants.large?.jpeg?.public_id) s3Keys.push(variants.large.jpeg.public_id);
            logger.info(`Found ${s3Keys.length} keys in image_variants for ${docId}`);
        }

        // Also check the main URL if no variants found
        if (s3Keys.length === 0 && doc.url) {
            // Extract key from URL if it's an S3 URL
            const urlMatch = doc.url.match(/https:\/\/[^\/]+\/(.+)/);
            if (urlMatch) {
                const key = urlMatch[1].split('?')[0]; // Remove query params
                s3Keys.push(key);
                logger.info(`Extracted key from URL for ${docId}: ${key}`);
            }
        }

        logger.info(`Final S3 keys for ${docId}:`, s3Keys);

        // Validate S3 keys exist
        if (s3Keys.length === 0) {
            logger.warn(`No S3 keys for media ${docId}`);

            await db.collection('media').updateOne(
                { _id: docId },
                {
                    $set: {
                        deletionStatus: 'failed',
                        deletionError: 'no_s3_keys_found',
                        lastDeletionAttemptAt: new Date()
                    },
                    $inc: { deletionAttempts: 1 }
                }
            );

            stats.failed++;
            return;
        }

        // Delete from S3
        try {
            if (s3Keys.length > 0) {
                await this.deleteFromS3(s3Keys, docId);
            } else {
                logger.warn(`No S3 keys found for media ${docId}, skipping S3 deletion`);
            }

            // Hard delete from MongoDB using Mongoose
            await Media.findByIdAndDelete(docId);

            logger.info(`Deleted media ${docId} - S3 keys: ${s3Keys.length}`);
            stats.deleted++;

        } catch (error: any) {
            // Mark as failed using Mongoose
            const attempts = doc.deletionAttempts || 0;

            await Media.findByIdAndUpdate(docId, {
                $set: {
                    deletionStatus: attempts >= 5 ? 'permanent_failed' : 'failed',
                    deletionError: error.message,
                    lastDeletionAttemptAt: new Date()
                },
                $inc: { deletionAttempts: 1 }
            });

            stats.failed++;
            throw error;
        }
    }

    private static async deleteFromS3(keys: string[], docId: string, maxRetries = 3): Promise<void> {
        logger.info(`Attempting to delete ${keys.length} S3 keys for document ${docId}:`, keys);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const s3Objects = keys.map(key => ({ Key: key }));

                // Delete in batches (S3 max is 1000 per request)
                for (let i = 0; i < s3Objects.length; i += 1000) {
                    const batch = s3Objects.slice(i, i + 1000);

                    logger.info(`Deleting batch ${Math.floor(i/1000) + 1} with ${batch.length} objects for ${docId}`);

                    const result = await s3Client.send(
                        new DeleteObjectsCommand({
                            Bucket: process.env.AWS_S3_BUCKET,
                            Delete: { Objects: batch }
                        })
                    );

                    logger.info(`S3 delete result for ${docId}:`, {
                        deleted: result.Deleted?.length || 0,
                        errors: result.Errors?.length || 0
                    });

                    if (result.Errors?.length > 0) {
                        logger.warn(`S3 deletion errors for ${docId}:`, result.Errors);
                        throw new Error(`S3 partial failure: ${result.Errors.length} errors`);
                    }
                }

                logger.info(`Successfully deleted all S3 objects for document ${docId}`);
                return; // Success

            } catch (error: any) {
                logger.error(`S3 deletion attempt ${attempt}/${maxRetries} failed for ${docId}:`, {
                    error: error.message,
                    code: error.code,
                    statusCode: error.statusCode,
                    keys: keys
                });

                if (attempt === maxRetries) {
                    throw error;
                }

                // Exponential backoff
                const delay = Math.pow(2, attempt - 1) * 100;
                logger.info(`Waiting ${delay}ms before retry ${attempt + 1} for ${docId}`);
                await new Promise(resolve =>
                    setTimeout(resolve, delay)
                );
            }
        }
    }
}
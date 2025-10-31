// services/initialization.service.ts - Updated to disable QueueWebSocketBridge
import { connectToMongoDB, logConnectionPoolStats } from '@configs/database.config';
import { redisConnection } from '@configs/redis.config';
import { createDefaultPlans } from '@models/subscription-plan.model';
import { logger } from '@utils/logger';
import { initializeImageQueue } from 'queues/imageQueue';
import { initializeImageWorker } from 'workers/imageWorker';
import { BulkDownloadService } from './media/bulk-download.service';
import { initializeStorageCleanupWorker } from 'workers/storageCleanupWorker';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { keys } from '@configs/dotenv.config';

export class InitializationService {

    static async initializeDatabase() {
        logger.info('Initializing MongoDB with connection pooling...');
        await connectToMongoDB();
        await createDefaultPlans();
        logger.info('Default subscription plans created/verified');
        logConnectionPoolStats();
    }

    static async initializeRedis() {
        try {
            await redisConnection.connect();
            logger.info('Redis connected successfully');
            return true;
        } catch (error) {
            logger.error('Failed to connect to Redis:', error);
            logger.warn('Continuing without Redis - some features will be disabled');
            return false;
        }
    }

    static async initializeImageProcessing() {
        try {
            logger.info('Initializing image processing system...');

            const imageQueue = await initializeImageQueue();
            await initializeImageWorker();

            logger.info('QueueWebSocketBridge disabled - using SimpleProgressService only');

            logger.info('Image processing system initialized (WebSocket bridge disabled)');
            return true;
        } catch (error) {
            logger.error('Failed to initialize image processing:', error);
            logger.warn('Continuing without image processing queue - uploads will fail');
            return false;
        }
    }

    static async initializeImageStorageCleaup() {
        try {
            logger.info('Initializing Image cleanup worker system...');

            await initializeStorageCleanupWorker();

            logger.info('Image cleanup worker system initialized (WebSocket bridge disabled)');
            return true;
        } catch (error) {
            logger.error('Failed to initialize Image cleanup worker system:', error);
            logger.warn('Continuing without Image cleanup worker system queue - uploads will fail');
            return false;
        }
    }

    static async initializeBulkDownload() {
        try {
            logger.info('Initializing bulk download service...');
            await BulkDownloadService.initializeQueue();
            logger.info('Bulk download service initialized successfully');
            return true;
        } catch (error) {
            logger.error('Failed to initialize bulk download service:', error);
            logger.warn('Continuing without bulk download service - download requests will fail');
            return false;
        }
    }

    static async initializeS3(): Promise<boolean> {
        try {
            // Check if S3 credentials are configured
            if (!keys.awsAccessKeyId || !keys.awsSecretAccessKey || !keys.s3BucketName) {
                logger.warn('S3 credentials not configured - skipping S3 initialization');
                return false;
            }

            logger.info('Initializing S3 connection...');

            const s3Client = new S3Client({
                region: keys.awsRegion as string,
                credentials: {
                    accessKeyId: keys.awsAccessKeyId as string,
                    secretAccessKey: keys.awsSecretAccessKey as string,
                },
            });

            // Test connection by listing objects (with max 1 result)
            await s3Client.send(new ListObjectsV2Command({
                Bucket: keys.s3BucketName as string,
                MaxKeys: 1
            }));

            logger.info('✅ S3 connection validated successfully');
            return true;
        } catch (error) {
            logger.error('❌ S3 connection failed:', error);
            logger.warn('Continuing without S3 - upload URL generation will fail');
            return false;
        }
    }
}
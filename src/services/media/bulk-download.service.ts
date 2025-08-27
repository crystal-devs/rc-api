// services/bulkDownload.service.ts - Using exact same pattern as image queue
import { Queue, Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import ImageKit from 'imagekit';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import { Media } from '@models/media.model';
import { BulkDownload, BulkDownloadDocument } from '@models/bulk-download.model';
import { redisConnection } from '@configs/redis.config';

// Initialize ImageKit
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

// Define the allowed stage types
type CurrentStage = 'initializing' | 'fetching_media' | 'downloading_files' | 'creating_archive' | 'uploading_archive' | 'generating_link' | 'notifying_user' | 'completed';

interface CreateDownloadRequestParams {
    eventId: string;
    shareToken: string;
    quality: 'thumbnail' | 'medium' | 'large' | 'original';
    includeVideos: boolean;
    includeImages: boolean;
    requestedByType: 'guest' | 'user' | 'host';
    requestedById: string;
    requesterEmail?: string;
    requesterName?: string;
    userIpAddress?: string;
    userAgent?: string;
}

interface DownloadedFile {
    originalPath: string;
    filename: string;
    size: number;
    type: 'image' | 'video';
}

export class BulkDownloadService {
    public static downloadQueue: Queue;
    public static worker: Worker;
    private static readonly MAX_CONCURRENT_DOWNLOADS = 2;
    private static readonly RATE_LIMIT_DURATION = 300; // 5 minutes
    private static readonly MAX_REQUESTS_PER_USER = 3;
    private static readonly MAX_FILE_SIZE_MB = 50;
    private static readonly MAX_TOTAL_SIZE_GB = 5;

    // Public getters for accessing queue and worker
    static getDownloadQueue(): Queue | null {
        return this.downloadQueue || null;
    }

    static getWorker(): Worker | null {
        return this.worker || null;
    }

    static async initializeQueue() {
        try {
            // Use EXACT same Redis config pattern as your image queue
            const redisConfig = {
                host: this.getRedisHost(),
                port: this.getRedisPort(),
                password: this.getRedisPassword(),

                // Performance settings
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                keepAlive: 30000,
                family: 4,

                // Timeout settings - increased for stability
                connectTimeout: 30000,  // Increased from 10000
                commandTimeout: 30000,  // Increased from 5000 to prevent timeouts; remove entirely for no timeout

                // Add proper retry strategy for reconnections
                retryStrategy: (times: number) => {
                    if (times > 10) return null;  // Give up after 10 attempts
                    return Math.min(times * 500, 10000);  // Exponential backoff up to 10s
                },
            };

            this.downloadQueue = new Queue('bulk-download', {
                connection: redisConfig,
                defaultJobOptions: {
                    removeOnComplete: 20,
                    removeOnFail: 10,
                    attempts: 2,
                    backoff: {
                        type: 'exponential',
                        delay: 5000
                    },
                    priority: 5,
                }
            });

            this.worker = new Worker('bulk-download', this.processDownloadJob.bind(this), {
                connection: redisConfig,
                concurrency: this.MAX_CONCURRENT_DOWNLOADS,
            });

            // Wait for connection like your image queue does
            await this.downloadQueue.waitUntilReady();

            // Same event handling pattern
            this.downloadQueue.on('error', (error: Error) => {
                logger.error('Bulk download queue error:', error);
            });

            this.worker.on('completed', (job: Job) => {
                logger.info(`Bulk download job ${job.id} completed successfully`);
            });

            this.worker.on('failed', (job, err) => {
                logger.error(`Bulk download job ${job?.id} failed:`, err.message);
            });

            // Add connection logging for debugging
            logger.info('Bulk download service initialized with Redis config:', {
                host: redisConfig.host,
                port: redisConfig.port,
                hasPassword: !!redisConfig.password,
                commandTimeout: redisConfig.commandTimeout,
            });
        } catch (error) {
            logger.error('Failed to initialize bulk download service:', error);
            throw error;
        }
    }


    // Use EXACT same helper functions as your image queue
    private static getRedisHost(): string {
        const redisUrl = keys.redisUrl as string;
        if (redisUrl?.startsWith('redis://')) {
            try {
                const url = new URL(redisUrl);
                return url.hostname || 'localhost';
            } catch {
                return 'localhost';
            }
        }
        return process.env.REDIS_HOST || 'localhost';
    }

    private static getRedisPort(): number {
        const redisUrl = keys.redisUrl as string;
        if (redisUrl?.startsWith('redis://')) {
            try {
                const url = new URL(redisUrl);
                return parseInt(url.port) || 6379;
            } catch {
                return 6379;
            }
        }
        return parseInt(process.env.REDIS_PORT || '6379');
    }

    private static getRedisPassword(): string | undefined {
        const redisUrl = keys.redisUrl as string;
        if (redisUrl?.startsWith('redis://')) {
            try {
                const url = new URL(redisUrl);
                return url.password || undefined;
            } catch {
                return undefined;
            }
        }
        return process.env.REDIS_PASSWORD || undefined;
    }

    static async createDownloadRequest(params: CreateDownloadRequestParams) {
        await this.checkRateLimit(params.requestedById, params.eventId);

        const event = await Event.findById(params.eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        if (!event.permissions?.can_download) {
            throw new Error('Download not permitted for this event');
        }

        await this.cancelExistingJobs(params.requestedById, params.eventId);

        const mediaStats = await this.calculateMediaStats(
            params.eventId,
            params.quality,
            params.includeImages,
            params.includeVideos
        );

        if (mediaStats.totalCount === 0) {
            throw new Error('No approved media found for download');
        }

        if (mediaStats.estimatedSizeMB > this.MAX_TOTAL_SIZE_GB * 1024) {
            throw new Error(`Download size too large (${Math.round(mediaStats.estimatedSizeMB / 1024 * 100) / 100}GB). Maximum allowed: ${this.MAX_TOTAL_SIZE_GB}GB`);
        }

        const jobId = `bulk_${Date.now()}_${uuidv4().split('-')[0]}`;

        const downloadJob: BulkDownloadDocument = new BulkDownload({
            job_id: jobId,
            event_id: params.eventId,
            share_token: params.shareToken,
            requested_by_type: params.requestedByType,
            requested_by_id: params.requestedById,
            requester_email: params.requesterEmail,
            requester_name: params.requesterName,
            quality: params.quality,
            include_videos: params.includeVideos,
            include_images: params.includeImages,
            total_files_requested: mediaStats.totalCount,
            estimated_size_mb: mediaStats.estimatedSizeMB,
            media_breakdown: mediaStats.breakdown,
            user_ip_address: params.userIpAddress,
            user_agent: params.userAgent,
            status: 'queued'
        });

        await downloadJob.save();

        const queueJob = await this.downloadQueue.add(
            'process-bulk-download',
            {
                jobId,
                eventId: params.eventId,
                shareToken: params.shareToken,
                quality: params.quality,
                includeVideos: params.includeVideos,
                includeImages: params.includeImages
            },
            {
                jobId: `bulk-download-${jobId}`,
                priority: this.getJobPriority(params.requestedByType),
                delay: 2000
            }
        );

        downloadJob.queue_job_id = queueJob.id as string;
        await downloadJob.save();

        await this.updateRateLimit(params.requestedById, params.eventId);

        return {
            jobId,
            totalFiles: mediaStats.totalCount,
            estimatedSizeMB: mediaStats.estimatedSizeMB,
            estimatedTimeMinutes: Math.max(2, Math.ceil(mediaStats.totalCount / 15)),
            mediaBreakdown: mediaStats.breakdown
        };
    }

    // Rate limiting uses your native Redis connection
    private static async checkRateLimit(requestedById: string, eventId: string) {
        const redisClient = redisConnection.getClient();
        if (!redisClient) {
            logger.warn('Redis client not available for rate limiting');
            return;
        }

        const rateLimitKey = `download_rate_limit:${eventId}:${requestedById}`;
        const currentCount = await redisClient.get(rateLimitKey);

        if (currentCount && parseInt(currentCount as string) >= this.MAX_REQUESTS_PER_USER) {
            throw new Error(`Rate limit exceeded. Maximum ${this.MAX_REQUESTS_PER_USER} download requests per ${this.RATE_LIMIT_DURATION / 60} minutes`);
        }
    }

    private static async updateRateLimit(requestedById: string, eventId: string) {
        const redisClient = redisConnection.getClient();
        if (!redisClient) {
            logger.warn('Redis client not available for rate limiting');
            return;
        }

        const rateLimitKey = `download_rate_limit:${eventId}:${requestedById}`;
        const current = await redisClient.incr(rateLimitKey);

        if (current === 1) {
            await redisClient.expire(rateLimitKey, this.RATE_LIMIT_DURATION);
        }
    }

    private static async cancelExistingJobs(requestedById: string, eventId: string) {
        const activeJobs = await BulkDownload.find({
            requested_by_id: requestedById,
            event_id: eventId,
            status: { $in: ['queued', 'processing', 'compressing', 'uploading'] }
        });

        for (const job of activeJobs) {
            if (job.queue_job_id) {
                try {
                    const queueJob = await this.downloadQueue.getJob(job.queue_job_id);
                    if (queueJob && (await queueJob.getState()) === 'waiting') {
                        await queueJob.remove();
                    }
                } catch (error) {
                    logger.warn(`Failed to cancel queue job ${job.queue_job_id}:`, error);
                }
            }

            job.status = 'cancelled';
            job.error_message = 'Cancelled by new request';
            await job.save();
        }
    }

    private static async calculateMediaStats(eventId: string, quality: string, includeImages: boolean, includeVideos: boolean) {
        const mediaQuery: any = {
            event_id: eventId,
            'approval.status': { $in: ['approved', 'auto_approved'] }
        };

        const typeFilter: string[] = [];
        if (includeImages) typeFilter.push('image');
        if (includeVideos) typeFilter.push('video');

        if (typeFilter.length > 0) {
            mediaQuery.type = { $in: typeFilter };
        }

        const mediaItems = await Media.find(mediaQuery, 'type size_mb image_variants').lean();

        let totalEstimatedMB = 0;
        let imageCount = 0, videoCount = 0;
        let imagesSizeMB = 0, videosSizeMB = 0;

        for (const media of mediaItems) {
            let fileSizeMB = media.size_mb || 5;

            if (media.type === 'image' && media.image_variants) {
                const sizeMultiplier = this.getQualitySizeMultiplier(quality);
                fileSizeMB *= sizeMultiplier;
                imageCount++;
                imagesSizeMB += fileSizeMB;
            } else if (media.type === 'video') {
                videoCount++;
                videosSizeMB += fileSizeMB;
            }

            totalEstimatedMB += fileSizeMB;
        }

        return {
            totalCount: mediaItems.length,
            estimatedSizeMB: Math.round(totalEstimatedMB * 100) / 100,
            breakdown: {
                images: { count: imageCount, size_mb: Math.round(imagesSizeMB * 100) / 100 },
                videos: { count: videoCount, size_mb: Math.round(videosSizeMB * 100) / 100 }
            }
        };
    }

    private static getQualitySizeMultiplier(quality: string): number {
        switch (quality) {
            case 'thumbnail': return 0.05;
            case 'medium': return 0.25;
            case 'large': return 0.60;
            case 'original': return 1.0;
            default: return 0.25;
        }
    }

    private static getJobPriority(requestedByType: string): number {
        switch (requestedByType) {
            case 'host': return 10;
            case 'user': return 5;
            case 'guest': return 1;
            default: return 1;
        }
    }

    // Main job processor
    // Fixed main job processor with better error handling and progress management
    private static async processDownloadJob(job: Job): Promise<any> {
        const { jobId } = job.data;

        const downloadJob = await BulkDownload.findOne({ job_id: jobId });
        if (!downloadJob) {
            throw new Error(`Download job ${jobId} not found`);
        }

        try {
            downloadJob.status = 'processing';
            downloadJob.processing_started_at = new Date();
            downloadJob.worker_instance = process.env.WORKER_ID || 'default';
            await downloadJob.save();

            // Stage 1: Fetch media list
            await downloadJob.updateProgress('fetching_media', 5);
            const mediaItems = await this.getMediaForDownload(job.data);

            if (mediaItems.length === 0) {
                throw new Error('No media items found for download');
            }

            // Stage 2: Download files (simplified - no progress callbacks)
            await downloadJob.updateProgress('downloading_files', 15);
            const tempDir = path.join(process.cwd(), 'temp', 'bulk-downloads', jobId);
            await fs.mkdir(tempDir, { recursive: true });

            const downloadedFiles = await this.downloadMediaFiles(mediaItems, tempDir, job.data.quality);

            // Update actual files processed
            await downloadJob.updateProgress('downloading_files', 65, {
                total_files_processed: downloadedFiles.length,
                total_files_failed: mediaItems.length - downloadedFiles.length
            });

            // Stage 3: Create ZIP archive (simplified)
            const zipPath = path.join(tempDir, `event-${job.data.eventId}-media.zip`);
            await this.createZipArchiveSimplified(downloadedFiles, zipPath);

            // Stage 4: Upload to cloud storage
            await downloadJob.updateProgress('uploading_archive', 85);
            const uploadResult = await this.uploadToImageKit(zipPath, jobId);

            // Stage 5: Complete job
            await downloadJob.markAsCompleted(uploadResult.url, {
                key: uploadResult.filePath,
                fileId: uploadResult.fileId,
                sizeMb: uploadResult.size / (1024 * 1024)
            });

            // Stage 6: Cleanup temp files
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                logger.warn('Failed to cleanup temp directory:', cleanupError);
            }

            logger.info(`Bulk download job ${jobId} completed successfully`);
            return { success: true, downloadUrl: uploadResult.url };

        } catch (error: any) {
            logger.error(`Bulk download job ${jobId} failed:`, error);

            try {
                await downloadJob.updateProgress('creating_archive', downloadJob.progress_percentage || 0, {
                    status: 'failed',
                    error_message: error.message
                });
            } catch (saveError) {
                logger.error(`Failed to mark job ${jobId} as failed:`, saveError);
            }

            throw error;
        }
    }


    // Get media items for download
    static async getMediaForDownload(jobData: any) {
        const { eventId, includeImages, includeVideos } = jobData;

        const mediaQuery: any = {
            event_id: eventId,
            'approval.status': { $in: ['approved', 'auto_approved'] }
        };

        const typeFilter: string[] = [];
        if (includeImages) typeFilter.push('image');
        if (includeVideos) typeFilter.push('video');

        if (typeFilter.length > 0) {
            mediaQuery.type = { $in: typeFilter };
        }

        return await Media.find(mediaQuery).lean();
    }

    // Download media files to temp directory
    // Fixed downloadMediaFiles method with proper progress handling
    static async downloadMediaFiles(
        mediaItems: any[],
        tempDir: string,
        quality: string
    ): Promise<DownloadedFile[]> {
        const downloadedFiles: DownloadedFile[] = [];
        const maxConcurrent = 3; // Reduced to prevent overwhelming

        for (let i = 0; i < mediaItems.length; i += maxConcurrent) {
            const batch = mediaItems.slice(i, i + maxConcurrent);

            const batchPromises = batch.map(async (media, batchIndex) => {
                const globalIndex = i + batchIndex;
                const fileUrl = this.getMediaUrl(media, quality);
                const filename = this.generateSafeFilename(media, globalIndex);
                const filePath = path.join(tempDir, filename);

                try {
                    await this.downloadFile(fileUrl, filePath);
                    const stats = await fs.stat(filePath);

                    if (stats.size > this.MAX_FILE_SIZE_MB * 1024 * 1024) {
                        logger.warn(`File ${filename} exceeds size limit, skipping`);
                        await fs.unlink(filePath);
                        return null;
                    }

                    return {
                        originalPath: filePath,
                        filename,
                        size: stats.size,
                        type: media.type
                    };
                } catch (error) {
                    logger.error(`Failed to download ${filename}:`, error);
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);

            for (const result of batchResults) {
                if (result) {
                    downloadedFiles.push(result);
                }
            }
        }

        logger.info(`Successfully downloaded ${downloadedFiles.length} of ${mediaItems.length} files`);
        return downloadedFiles;
    };
    static async createZipArchiveSimplified(
        files: DownloadedFile[],
        zipPath: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const output = createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 6 },
                forceLocalTime: true
            });

            output.on('close', () => {
                logger.info(`ZIP archive created: ${archive.pointer()} total bytes`);
                resolve();
            });

            output.on('error', reject);
            archive.on('error', reject);

            archive.pipe(output);

            // Add files to archive
            for (const file of files) {
                archive.file(file.originalPath, { name: file.filename });
            }

            archive.finalize();
        });
    }

    // Create ZIP archive from downloaded files
    static async createZipArchive(
        files: DownloadedFile[],
        zipPath: string,
        progressCallback: (progress: number) => Promise<any>
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const output = createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 6 },
                forceLocalTime: true
            });

            let processedFiles = 0;
            let lastProgressUpdate = 0;
            const progressThrottle = 1000; // Throttle progress updates

            const updateProgress = async (progress: number) => {
                const now = Date.now();
                if (now - lastProgressUpdate > progressThrottle) {
                    try {
                        await progressCallback(progress);
                        lastProgressUpdate = now;
                    } catch (error) {
                        logger.warn('Progress update failed:', error);
                        // Don't throw - continue processing
                    }
                }
            };

            output.on('close', () => {
                logger.info(`ZIP archive created: ${archive.pointer()} total bytes`);
                resolve();
            });

            output.on('error', reject);
            archive.on('error', reject);

            // Throttle progress updates during archive creation
            archive.on('entry', async () => {
                processedFiles++;
                await updateProgress(processedFiles / files.length);
            });

            archive.pipe(output);

            // Add files to archive
            for (const file of files) {
                archive.file(file.originalPath, { name: file.filename });
            }

            archive.finalize();
        });
    }

    // Download individual file
    static async downloadFile(url: string, filePath: string): Promise<void> {
        const response = await axios({
            method: 'get',
            url,
            responseType: 'stream',
            timeout: 60000,
            maxRedirects: 5
        });

        if (response.status !== 200) {
            throw new Error(`Failed to download file: HTTP ${response.status}`);
        }

        const writer = createWriteStream(filePath);

        return new Promise((resolve, reject) => {
            response.data.pipe(writer);

            let error: Error | null = null;

            writer.on('error', (err) => {
                error = err;
                writer.close();
                reject(err);
            });

            writer.on('close', () => {
                if (!error) {
                    resolve();
                }
            });
        });
    }

    // Get appropriate URL for media based on quality
    static getMediaUrl(media: any, quality: string): string {
        if (media.type === 'video') {
            return media.url;
        }

        // For images, use variants if available
        if (media.image_variants) {
            switch (quality) {
                case 'original':
                    return media.image_variants.original?.url || media.url;
                case 'large':
                    return media.image_variants.large?.jpeg?.url || media.image_variants.large?.webp?.url || media.url;
                case 'medium':
                    return media.image_variants.medium?.jpeg?.url || media.image_variants.medium?.webp?.url || media.url;
                case 'thumbnail':
                    return media.image_variants.small?.jpeg?.url || media.image_variants.small?.webp?.url || media.url;
                default:
                    return media.url;
            }
        }

        return media.url;
    }

    // Generate safe filename for download
    static generateSafeFilename(media: any, index: number): string {
        const originalName = media.original_filename || `file-${index + 1}`;
        const extension = path.extname(originalName) || (media.type === 'image' ? '.jpg' : '.mp4');

        // Clean filename of unsafe characters
        const baseName = path.basename(originalName, extension)
            .replace(/[^a-zA-Z0-9\-_\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);

        // Add unique identifier to prevent collisions
        const uniqueId = media._id?.toString().substring(0, 8) || Math.random().toString(36).substring(2, 8);

        return `${baseName}_${uniqueId}${extension}`;
    }

    // Upload ZIP to ImageKit
    static async uploadToImageKit(zipPath: string, jobId: string) {
        const zipBuffer = await fs.readFile(zipPath);
        const stats = await fs.stat(zipPath);

        const fileName = `bulk-download-${jobId}-${Date.now()}.zip`;
        const folder = '/bulk-downloads/';

        try {
            logger.info(`Starting ImageKit upload: ${fileName}, Size: ${Math.round(stats.size / (1024 * 1024))}MB`);

            const uploadResult = await imagekit.upload({
                file: zipBuffer,
                fileName,
                folder,
                useUniqueFileName: true,
                tags: ['bulk-download', jobId],
                // Remove custom metadata completely - it's causing the error
                // customMetadata: { ... }  // REMOVED
            });

            logger.info(`ZIP uploaded to ImageKit successfully: ${uploadResult.url}`);

            return {
                url: uploadResult.url,
                fileId: uploadResult.fileId,
                filePath: uploadResult.filePath,
                size: stats.size
            };

        } catch (error: any) {
            // Enhanced error logging to see what ImageKit is actually returning
            logger.error('ImageKit upload failed with details:', {
                error: error,
                message: error?.message,
                response: error?.response?.data,
                status: error?.response?.status,
                fileName: fileName,
                fileSize: stats.size
            });

            // Try to get a meaningful error message
            let errorMessage = 'Unknown ImageKit error';
            if (error?.message) {
                errorMessage = error.message;
            } else if (error?.response?.data?.message) {
                errorMessage = error.response.data.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            throw new Error(`Failed to upload ZIP to ImageKit: ${errorMessage}`);
        }
    }

    // Get download status
    static async getDownloadStatus(jobId: string) {
        const job = await BulkDownload.findOne({ job_id: jobId });
        if (!job) return null;

        let queueStatus = null;
        if (job.queue_job_id && ['queued', 'processing'].includes(job.status)) {
            try {
                const queueJob = await this.downloadQueue.getJob(job.queue_job_id);
                queueStatus = queueJob ? await queueJob.getState() : null;
            } catch (error) {
                // Queue job might be cleaned up
            }
        }

        return {
            jobId: job.job_id,
            status: job.status,
            currentStage: job.current_stage,
            progress: job.progress_percentage,
            totalFiles: job.total_files_requested,
            processedFiles: job.total_files_processed,
            failedFiles: job.total_files_failed,
            downloadUrl: job.download_url,
            downloadUrlExpiresAt: job.download_url_expires_at,
            estimatedSizeMB: job.estimated_size_mb,
            actualSizeMB: job.actual_size_mb,
            mediaBreakdown: job.media_breakdown,
            errorMessage: job.error_message,
            processingDuration: job.processing_duration_ms,
            createdAt: job.created_at,
            queueStatus
        };
    }

    // Cleanup expired downloads and temp files
    static async cleanupExpiredDownloads(): Promise<void> {
        try {
            const expiredJobs = await BulkDownload.find({
                status: 'completed',
                download_url_expires_at: { $lt: new Date() },
                cleanup_completed: false
            }).limit(50);

            for (const job of expiredJobs) {
                try {
                    if (job.storage_file_id) {
                        await imagekit.deleteFile(job.storage_file_id);
                        logger.info(`Deleted expired file from ImageKit: ${job.storage_file_id}`);
                    }

                    job.cleanup_completed = true;
                    job.status = 'expired';
                    job.download_url = null;
                    await job.save();

                } catch (error) {
                    logger.error(`Failed to cleanup expired download ${job.job_id}:`, error);
                }
            }

            // Cleanup temp directories
            const tempBase = path.join(process.cwd(), 'temp', 'bulk-downloads');
            try {
                const tempDirs = await fs.readdir(tempBase);
                const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

                for (const dir of tempDirs) {
                    const dirPath = path.join(tempBase, dir);
                    const stats = await fs.stat(dirPath);

                    if (stats.isDirectory() && stats.mtime.getTime() < oneDayAgo) {
                        await fs.rm(dirPath, { recursive: true, force: true });
                        logger.info(`Cleaned up old temp directory: ${dir}`);
                    }
                }
            } catch (error) {
                logger.warn('Temp directory cleanup failed:', error);
            }

            logger.info(`Cleaned up ${expiredJobs.length} expired downloads`);

        } catch (error) {
            logger.error('Cleanup process failed:', error);
        }
    }

    // Get user's download history
    static async getUserDownloadHistory(requestedById: string, limit: number = 10) {
        return await BulkDownload.find({
            requested_by_id: requestedById,
            status: { $in: ['completed', 'failed', 'expired'] }
        })
            .sort({ created_at: -1 })
            .limit(limit)
            .select('job_id status created_at estimated_size_mb actual_size_mb download_url_expires_at error_message')
            .lean();
    }

    // Cancel download job
    static async cancelDownloadJob(jobId: string, requestedById: string): Promise<boolean> {
        const job = await BulkDownload.findOne({
            job_id: jobId,
            requested_by_id: requestedById,
            status: { $in: ['queued', 'processing'] }
        });

        if (!job) return false;

        if (job.queue_job_id) {
            try {
                const queueJob = await this.downloadQueue.getJob(job.queue_job_id);
                if (queueJob) {
                    await queueJob.remove();
                }
            } catch (error) {
                logger.warn(`Failed to cancel queue job ${job.queue_job_id}:`, error);
            }
        }

        job.status = 'cancelled';
        job.error_message = 'Cancelled by user';
        await job.save();

        return true;
    }

    static async cleanup() {
        try {
            if (this.worker) {
                await this.worker.close();
                logger.info('Bulk download worker closed');
            }

            if (this.downloadQueue) {
                await this.downloadQueue.close();
                logger.info('Bulk download queue closed');
            }
        } catch (error) {
            logger.error('Error during bulk download cleanup:', error);
        }
    }
}
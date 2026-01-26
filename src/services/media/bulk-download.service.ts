import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client } from "@aws-sdk/client-s3";
import { BulkDownload } from "@models/bulk-download.model";
import { Media } from "@models/media.model";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@utils/logger";
import { keys } from "@configs/dotenv.config";
import crypto from "crypto";
import mongoose from "mongoose";

// Initialize S3 client for URL generation
const s3Client = new S3Client({
  region: keys.awsRegion as string,
  credentials: {
    accessKeyId: keys.awsAccessKeyId as string,
    secretAccessKey: keys.awsSecretAccessKey as string,
  },
});

const REGION = process.env.AWS_REGION || "ap-south-1";
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const sqs = new SQSClient({ region: REGION });

// Helper function to compute content hash for an event
const computeEventContentHash = async (eventId: string, quality: string): Promise<{ hash: string; mediaCount: number }> => {
  // Get all approved media for this event, sorted by ID for consistent hashing
  const approvedMedia = await Media.find({
    event_id: new mongoose.Types.ObjectId(eventId),
    'approval.status': { $in: ['approved', 'auto_approved'] },
    isDeleted: { $ne: true }
  })
  .select('_id created_at updated_at')
  .sort({ _id: 1 })
  .lean();

  if (approvedMedia.length === 0) {
    return { hash: '', mediaCount: 0 };
  }

  // Create hash input: media IDs + timestamps + quality
  const hashInput = approvedMedia
    .map(media => `${media._id.toString()}-${media.created_at.getTime()}-${media.updated_at.getTime()}`)
    .join('|') + `|quality:${quality}`;

  const hash = crypto.createHash('md5').update(hashInput).digest('hex');

  return { hash, mediaCount: approvedMedia.length };
};

export const createBulkDownloadService = async ({
  eventId,
  shareToken,
  requestedById,
  requestedByType,
  quality = "original",
}: {
  eventId: string;
  shareToken?: string;
  requestedById: string;
  requestedByType: string;
  quality?: string;
}) => {
  try {
    if (!eventId || !requestedById)
      throw new Error("Missing required parameters: eventId or requestedById");

    // Compute current content hash for this event
    const { hash: currentContentHash, mediaCount } = await computeEventContentHash(eventId, quality);

    if (mediaCount === 0) {
      return {
        status: false,
        code: 400,
        message: "No approved media available for download",
        data: null as any,
        error: { message: "Event has no downloadable content" }
      };
    }

    // Check for active jobs (processing, etc.)
    const activeJob = await BulkDownload.findOne({
      event_id: new mongoose.Types.ObjectId(eventId),
      requested_by_id: requestedById,
      status: { $in: ["queued", "processing", "compressing", "uploading"] },
    });

    if (activeJob) {
      return {
        status: true,
        code: 200,
        message: "A bulk download is already in progress",
        data: { jobId: activeJob.job_id },
      };
    }

    console.log(eventId, shareToken, requestedById, requestedByType, quality, SQS_QUEUE_URL, 'bulk download request');
    const jobId = uuidv4();

    // Check for existing completed download with same content hash
    // Only reuse if the ZIP was created recently (within 24 hours) to avoid stale data
    const existing = await BulkDownload.findOne({
      event_id: new mongoose.Types.ObjectId(eventId),
      content_hash: currentContentHash,
      quality: quality,
      status: "completed",
      created_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Only last 24 hours
    });

    if (existing) {
      logger.info(`[createBulkDownloadService] Reusing cached ZIP for event ${eventId}, hash: ${currentContentHash}`);
      return {
        status: true,
        code: 200,
        message: "Existing bulk download available",
        data: {
          jobId: existing.job_id,
          downloadUrl: existing.download_url,
          contentHash: currentContentHash,
          reused: true
        },
      };
    }

    const job = await BulkDownload.create({
      job_id: jobId,
      event_id: new mongoose.Types.ObjectId(eventId),
      share_token: shareToken,
      requested_by_id: requestedById,
      requested_by_type: requestedByType,
      quality,
      content_hash: currentContentHash,
      media_count: mediaCount,
      status: "queued",
      current_stage: "initializing",
    });

    console.log(SQS_QUEUE_URL, 'SQS_QUEUE_URLSQS_QUEUE_URLSQS_QUEUE_URL')

    if (SQS_QUEUE_URL) {
      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify({
              jobId,
              eventId,
              quality,
              shareToken,
              contentHash: currentContentHash,
              mediaCount
            }),
          })
        );
        await job.updateOne({ processing_started_at: new Date() });
        logger.info(`[createBulkDownloadService] Queued bulk job ${jobId} to SQS with content hash: ${currentContentHash}`);
      } catch (sqsError) {
        logger.warn(`[createBulkDownloadService] SQS send failed: ${sqsError.message}`);
      }
    }

    return {
      status: true,
      code: 202,
      message: "Bulk download queued",
      data: { jobId },
    };
  } catch (error) {
    logger.error(`[createBulkDownloadService] Error: ${error.message}`);
    return {
      status: false,
      code: 500,
      message: "Failed to create bulk download job",
      error: { message: error.message },
    };
  }
};

/**
 * Retrieve current status of a bulk download job
 */
export const getBulkDownloadStatusService = async ({
  jobId,
}: {
  jobId: string;
}) => {
  try {
    if (!jobId) throw new Error("Job ID is required");

    const job = await BulkDownload.findOne({ job_id: jobId });
    if (!job) {
      return {
        status: false,
        code: 404,
        message: "Job not found",
        data: null,
        error: { message: "Invalid job ID" },
        other: null,
      };
    }

    const expired =
      job.download_url_expires_at &&
      new Date(job.download_url_expires_at) < new Date();

    if (expired) {
      logger.info(`[getBulkDownloadStatusService] Job ${jobId} expired`);
      return {
        status: false,
        code: 410,
        message: "Download expired — please request again",
        data: null,
        error: { message: "Expired download" },
        other: null,
      };
    }

    // Check if URL needs refresh for completed jobs
    let finalDownloadUrl = job.download_url;
    let urlRefreshed = false;

    if (job.status === 'completed' && job.storage_key) {
      const now = new Date();
      const urlExpired = !job.download_url_expires_at || job.download_url_expires_at < now;

      if (urlExpired) {
        try {
          // Generate fresh presigned URL with 24-hour expiry
          const freshUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: keys.s3BucketName as string,
              Key: job.storage_key,
            }),
            { expiresIn: 86400 } // 24 hours
          );

          // Update job with new URL
          await BulkDownload.findOneAndUpdate(
            { job_id: jobId },
            {
              download_url: freshUrl,
              download_url_expires_at: new Date(Date.now() + 86400 * 1000), // 24 hours from now
              updated_at: new Date()
            }
          );

          finalDownloadUrl = freshUrl;
          urlRefreshed = true;

          logger.info(`[getBulkDownloadStatusService] Refreshed expired URL for job ${jobId}`);
        } catch (urlError) {
          logger.error(`[getBulkDownloadStatusService] Failed to refresh URL for job ${jobId}:`, urlError);
          // Continue with old URL if refresh fails
        }
      }
    }

    return {
      status: true,
      code: 200,
      message: "Bulk download status retrieved",
      data: {
        jobId: job.job_id,
        progress: job.progress_percentage,
        stage: job.current_stage,
        downloadUrl: finalDownloadUrl,
        jobStatus: job.status,
        totalFiles: job.total_files_requested,
        contentHash: job.content_hash,
        mediaCount: job.media_count,
        urlRefreshed: urlRefreshed, // Indicate if URL was refreshed
        urlExpiresAt: job.download_url_expires_at,
      },
      error: null as any,
      other: null as any,
    };
  } catch (error: any) {
    logger.error(`[getBulkDownloadStatusService] Error: ${error.message}`);
    return {
      status: false,
      code: 500,
      message: "Failed to get bulk download status",
      data: null,
      error: { message: error.message },
      other: null,
    };
  }
};

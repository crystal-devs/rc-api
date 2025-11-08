import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { BulkDownload } from "@models/bulk-download.model";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@utils/logger";

const REGION = process.env.AWS_REGION || "ap-south-1";
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const sqs = new SQSClient({ region: REGION });

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
    
    // prevent duplicate jobs
    const activeJob = await BulkDownload.findOne({
      event_id: eventId,
      requested_by_id: requestedById,
      status: { $in: ["queued", "processing", "compressing", "uploading"] },
    });
    // if (activeJob) {
    //   return {
    //     status: true,
    //     code: 200,
    //     message: "A bulk download is already in progress",
    //     data: { jobId: activeJob.job_id },
    //   };
    // }
    
    console.log(eventId, shareToken, requestedById, requestedByType, quality, SQS_QUEUE_URL, 'asdfasdfasdfasdf');
    const jobId = uuidv4();

    // reuse valid zip
    const existing = await BulkDownload.findOne({
      event_id: eventId,
      requested_by_id: requestedById,
      status: "completed",
      created_at: { $gt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }, // last 2 days
    });

    if (existing) {
      return {
        status: true,
        code: 200,
        message: "Existing bulk download available",
        data: { jobId: existing.job_id, downloadUrl: existing.download_url },
      };
    }

    const job = await BulkDownload.create({
      job_id: jobId,
      event_id: eventId,
      share_token: shareToken,
      requested_by_id: requestedById,
      requested_by_type: requestedByType,
      quality,
      status: "queued",
      current_stage: "initializing",
    });

    console.log(SQS_QUEUE_URL, 'SQS_QUEUE_URLSQS_QUEUE_URLSQS_QUEUE_URL')

    if (SQS_QUEUE_URL) {
      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify({ jobId, eventId, quality, shareToken }),
          })
        );
        await job.updateOne({ processing_started_at: new Date() });
        logger.info(`[createBulkDownloadService] Queued bulk job ${jobId} to SQS`);
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

        return {
            status: true,
            code: 200,
            message: "Bulk download status retrieved",
            data: {
                jobId: job.job_id,
                progress: job.progress_percentage,
                stage: job.current_stage,
                downloadUrl: job.download_url,
                jobStatus: job.status,
                totalFiles: job.total_files_requested,
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

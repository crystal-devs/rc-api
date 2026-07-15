import { Request, Response } from 'express';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Media } from '@models/media.model';
import { validatePermissionsAndGetApproval } from '@utils/media.utils';
import { isValidSubEventForEvent } from '@services/event/sub-event.service';
import mongoose from 'mongoose';

// Initialize S3 client
const s3Client = new S3Client({
  region: keys.awsRegion as string,
  credentials: {
    accessKeyId: keys.awsAccessKeyId as string,
    secretAccessKey: keys.awsSecretAccessKey as string,
  },
});

interface UploadUrlRequest {
  eventId: string;
  fileName: string;
  fileType: string;
}

interface BatchUploadUrlRequest {
  eventId: string;
  files: Array<{
    fileName: string;
    fileType: string;
  }>;
  /** Optional function (sub-event) to tag this batch with — Phase 1 */
  subEventId?: string;
}

interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    role?: string;
  };
}

/**
 * Generate presigned URL for direct S3 upload
 * POST /api/upload-url
 */
export const generateUploadUrlController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { eventId, fileName, fileType }: UploadUrlRequest = req.body;

    // Validate required fields
    if (!eventId || !fileName || !fileType) {
      return res.status(400).json({
        status: false,
        message: 'Missing required fields: eventId, fileName, fileType'
      });
    }

    // Generate unique filename with UUID
    const fileExtension = fileName.split('.').pop();
    const uploadId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const key = `events/${eventId}/original/${uploadId}.jpg`;

    // Create PUT command for S3
    const command = new PutObjectCommand({
      Bucket: keys.s3BucketName as string,
      Key: key,
      ContentType: fileType,
      CacheControl: 'max-age=31536000, immutable' // Enable aggressive caching
    });

    // Generate presigned URL (expires in 10 minutes)
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 600, // 10 minutes
    });

    // Create Metadata Record (Pending Upload)
    const userId = req.user?._id;
    const approvalResult = await validatePermissionsAndGetApproval(eventId, userId);

    const media = new Media({
      upload_id: uploadId,
      type: 'image',
      event_id: eventId,
      album_id: eventId,

      owner: {
        type: req.user?.role === 'guest' ? 'guest' : 'registered_user',
        user_id: req.user?.role !== 'guest' ? req.user?._id : undefined,
        guest_id: req.user?.role === 'guest' ? req.user?._id : undefined
      },

      original: {
        public_id: key,
        filename: fileName,
        format: fileExtension,
        width: 0,   // Placeholder, updated after processing
        height: 0,  // Placeholder, updated after processing
        size_mb: 0  // Placeholder, updated after upload
      },

      processing: {
        status: 'pending', // Pending upload
        stage: 'uploading',
        progress: 0,
        // job_id and others will be added by processing service
      },

      approval: approvalResult,
      deleteGroup: `event-${eventId}-upload-${uploadId}`
    });

    await media.save();
    logger.info(`Media placeholder created: ${media._id}, upload_id: ${uploadId}`);

    logger.info(`Generated presigned URL for event ${eventId}, file: ${fileName}, url: ${signedUrl}`);

    return res.status(200).json({
      status: true,
      message: 'Upload URL generated successfully',
      data: {
        uploadUrl: signedUrl,
        key: key,
        fileName: fileName,
        uploadId: uploadId,
        expiresIn: 600, // seconds
      }
    });

  } catch (error: any) {
    logger.error('Failed to generate upload URL:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to generate upload URL',
      error: error.message
    });
  }
};

/**
 * Generate multiple presigned URLs for batch upload (optimized for up to 20 images)
 * POST /api/upload-urls/batch
 */
export const generateBatchUploadUrlsController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user
    console.log(userId, 'User ID');
    const { eventId, files, subEventId }: BatchUploadUrlRequest = req.body;

    // Validate required fields
    if (!eventId || !files || !Array.isArray(files)) {
      return res.status(400).json({
        status: false,
        message: 'Missing required fields: eventId and files array'
      });
    }

    // Validate batch size (max 20 images)
    const MAX_BATCH_SIZE = 20;
    if (files.length === 0 || files.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        status: false,
        message: `Batch size must be between 1 and ${MAX_BATCH_SIZE} files`
      });
    }

    // Validate each file entry
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.fileName || !file.fileType) {
        return res.status(400).json({
          status: false,
          message: `File at index ${i} missing fileName or fileType`
        });
      }

      // Validate file type (images and videos allowed)
      if (!file.fileType.startsWith('image/') && !file.fileType.startsWith('video/')) {
        return res.status(400).json({
          status: false,
          message: `File at index ${i} must be an image or video type`
        });
      }
    }

    logger.info(`Generating ${files.length} presigned URLs for event ${eventId}`);

    // Generate URLs with controlled concurrency (max 5 concurrent)
    const CONCURRENT_LIMIT = 5;
    const results: Array<{
      uploadUrl: string;
      key: string;
      fileName: string;
      uploadId: string;
      expiresIn: number;
    }> = [];

    // Fix: userId already defined at top of function? No, let's check.
    // It was defined as `const userId = req.user`. Wait, that's an object?
    // Let's look at line 108: `const userId = req.user`. That is WRONG typings if req.user is the object.
    // We should use req.user?._id.

    // Fetch approval result once for the entire batch
    const uploaderId = req.user?._id;
    // @ts-ignore - Handle possible type mismatch in req.user
    const approvalResult = await validatePermissionsAndGetApproval(eventId, typeof uploaderId === 'string' ? uploaderId : uploaderId?._id);

    // Resolve the function tag once for the whole batch (one query, not one per
    // file). An id from another event — or a function since deleted — resolves
    // to null (the whole-event gallery) rather than failing the upload. (Phase 1)
    const subEventTag = subEventId && await isValidSubEventForEvent(eventId, subEventId)
      ? new mongoose.Types.ObjectId(subEventId)
      : null;
    if (subEventId && !subEventTag) {
      logger.warn(`Ignoring unknown sub_event_id '${subEventId}' for event ${eventId} — tagging batch to the whole event`);
    }

    // Process files in batches to control concurrency
    for (let i = 0; i < files.length; i += CONCURRENT_LIMIT) {
      const batch = files.slice(i, i + CONCURRENT_LIMIT);

      const batchPromises = batch.map(async (file, index) => {
        const globalIndex = i + index;

        try {
          // Generate unique filename with UUID
          const fileExtension = file.fileName.split('.').pop() || 'jpg';
          const uploadId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
          const key = `events/${eventId}/original/${uploadId}.${fileExtension}`;

          // Create PUT command for S3
          const command = new PutObjectCommand({
            Bucket: keys.s3BucketName as string,
            Key: key,
            ContentType: file.fileType,
            CacheControl: 'max-age=31536000, immutable' // Enable aggressive caching
          });

          // Generate presigned URL (expires in 10 minutes)
          const signedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 600, // 10 minutes
          });


          // Create Media Record
          const isVideo = file.fileType.startsWith('video/');
          const media = new Media({
            upload_id: uploadId,
            type: isVideo ? 'video' : 'image',
            event_id: eventId,
            album_id: eventId,
            sub_event_id: subEventTag,

            owner: {
              type: req.user?.role === 'guest' ? 'guest' : 'registered_user',
              user_id: req.user?.role !== 'guest' ? req.user?._id : undefined,
              guest_id: req.user?.role === 'guest' ? req.user?._id : undefined
            },

            original: {
              public_id: key,
              filename: file.fileName,
              format: fileExtension,
              width: isVideo ? undefined : 0,     // Placeholder — images only
              height: isVideo ? undefined : 0,    // Placeholder — images only
              duration: isVideo ? 0 : undefined,  // Placeholder — videos only
              size_mb: 0  // Placeholder
            },

            processing: {
              status: 'pending',
              stage: 'uploading',
              progress: 0,
            },

            approval: approvalResult, // We need to fetch this outside the loop
            deleteGroup: `event-${eventId}-upload-${uploadId}`
          });

          await media.save();

          return {
            uploadUrl: signedUrl,
            key: key,
            fileName: file.fileName,
            uploadId: uploadId,
            expiresIn: 600,
          };
        } catch (error: any) {
          logger.error(`Failed to generate URL for file ${globalIndex}:`, error);
          throw new Error(`Failed to generate URL for ${file.fileName}: ${error.message}`);
        }
      });

      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    logger.info(`Successfully generated ${results.length} presigned URLs for event ${eventId}`);

    return res.status(200).json({
      status: true,
      message: `Generated ${results.length} upload URLs successfully`,
      data: {
        uploadUrls: results,
        batchSize: results.length,
        expiresIn: 600, // seconds
        eventId: eventId
      }
    });

  } catch (error: any) {
    logger.error('Failed to generate batch upload URLs:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to generate batch upload URLs',
      error: error.message
    });
  }
};
import { Request, Response } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Media } from '@models/media.model';
import { getWebSocketService } from '@services/websocket/websocket.service';
import { S3Client } from '@aws-sdk/client-s3';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import { validatePermissionsAndGetApproval } from '@utils/media.utils';
import { rekognitionService } from '@services/aws/rekognition.service';

// Initialize S3 client
const s3Client = new S3Client({
  region: keys.awsRegion as string,
  credentials: {
    accessKeyId: keys.awsAccessKeyId as string,
    secretAccessKey: keys.awsSecretAccessKey as string,
  },
});

interface UploadCompleteRequest {
  key: string;
  eventId: string;
  upload_id: string;
  width?: number;
  height?: number;
}

interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    role?: string;
  };
}

/**
 * Handle upload completion - save to MongoDB and emit WebSocket event
 * POST /api/upload-complete
 */
export const uploadCompleteController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?._id;
    console.log(userId, 'User ID');
    const { key, eventId, upload_id, width, height }: UploadCompleteRequest = req.body;

    console.log('key:', key, 'eventId:', eventId, 'upload_id:', upload_id, 'dims:', width, 'x', height);
    // ────────────────────── VALIDATION ──────────────────────
    if (!key || !eventId || !upload_id) {
      return res.status(400).json({
        status: false,
        message: 'Missing required fields: key, eventId, upload_id',
      });
    }

    // Validate S3 key format (events/{eventId}/original/{upload_id}.ext)
    const keyParts = key.split('/');
    if (
      keyParts.length !== 4 ||
      keyParts[0] !== 'events' ||
      keyParts[2] !== 'original'
    ) {
      return res.status(400).json({
        status: false,
        message: 'Invalid S3 key format',
      });
    }

    const fileKey = keyParts[3]; // e.g., "a1b2c3d4.jpg"
    const extension = fileKey.split('.').pop()?.toLowerCase() || 'jpg';
    const originalFileName = fileKey.replace(upload_id, '').replace(/^\./, '') || 'image.jpg';

    // ────────────────────── PRESIGNED URL (7 days) ──────────────────────
    const originalUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: keys.s3BucketName as string,
        Key: key,
      }),
      { expiresIn: 604800 } // 7 days
    );

    const approvalResult = await validatePermissionsAndGetApproval(eventId, userId);
    console.log(approvalResult, 'Approval result');

    // ────────────────────── SAVE/UPDATE MONGODB ──────────────────────
    let savedMedia;

    // Check if media already exists
    const existingMedia = await Media.findOne({ upload_id });

    if (existingMedia) {
      // Update approval if still pending
      if (existingMedia.approval.status === 'pending') {
        existingMedia.approval = {
          status: approvalResult.status as 'pending' | 'approved' | 'rejected' | 'hidden',
          reason: '',
        };
      }

      // Update dimensions if provided and currently missing
      if (width && height && (existingMedia.original.width === 0 || !existingMedia.original.width)) {
        existingMedia.original.width = width;
        existingMedia.original.height = height;
      }

      savedMedia = await existingMedia.save();
      logger.info(`Media updated: ${savedMedia._id}, upload_id: ${upload_id}`);
    } else {
      // Fallback: Create new media if not found (universal schema)
      const owner = req.user?.role === 'guest'
        ? { type: 'guest' as const, guest_id: req.user._id }
        : { type: 'registered_user' as const, user_id: req.user?._id };

      const media = new Media({
        upload_id,
        type: extension.match(/^(mp4|mov|avi|mkv)$/i) ? 'video' : 'image',
        event_id: eventId,
        album_id: eventId,
        owner,
        original: {
          public_id: key,
          filename: originalFileName,
          width: width || (extension.match(/^(mp4|mov|avi|mkv)$/i) ? undefined : 0), // Use provided width or default
          height: height || (extension.match(/^(mp4|mov|avi|mkv)$/i) ? undefined : 0), // Use provided height or default
          duration: extension.match(/^(mp4|mov|avi|mkv)$/i) ? 0 : undefined, // Videos only
          format: extension as 'jpeg' | 'webp' | 'heic' | 'mp4' | 'mov' | 'avi' | 'mkv',
          size_mb: 0,
        },
        variants: {}, // Empty initially
        processing: {
          status: 'processing',
          stage: 'uploading',
          progress: 10,
        },
        approval: {
          status: approvalResult.status,
          reason: '',
        },
      });

      savedMedia = await media.save();
      logger.info(`Media created (fallback): ${savedMedia._id}, upload_id: ${upload_id}`);
    }

    // ────────────────────── ASYNC: INDEX FACES ──────────────────────
    if (savedMedia.type === 'image') {
      rekognitionService.indexFaces(
        keys.s3BucketName as string,
        key,
        savedMedia._id.toString(),
        eventId
      ).catch(err => logger.error(`Background indexing failed for ${savedMedia._id}:`, err));
    }

    // ────────────────────── WEBSOCKET: photo-uploading ──────────────────────
    const webSocketService = getWebSocketService();
    const payload = {
      mediaId: savedMedia._id.toString(),
      eventId,
      originalUrl,
      fileName: originalFileName,
      status: 'uploaded',
      approval: savedMedia.approval,
      approval_status: savedMedia.approval?.status === 'approved',
      timestamp: new Date(),
      uploader: {
        type: savedMedia.owner.type,
        id: req.user?._id || null,
      },
    };

    const adminRoom = `admin_${eventId}`;
    const guestRoom = `guest_${eventId}`;

    webSocketService.io.to(adminRoom).emit('photo-uploading', payload);
    webSocketService.io.to(guestRoom).emit('photo-uploading', payload);

    logger.info(`WebSocket 'photo-uploading' emitted for event ${eventId}`);
    // ────────────────────── RESPONSE ──────────────────────
    const responseData = {
      mediaId: savedMedia._id.toString(),
      originalUrl,
      upload_id,
      status: 'uploaded',
      approval: savedMedia.approval,
      approval_status: savedMedia.approval?.status === 'approved',
    };

    console.log('🔍 UPLOAD-COMPLETE RESPONSE DATA:', JSON.stringify(responseData, null, 2));

    return res.status(200).json({
      status: true,
      message: 'Upload completed',
      data: responseData,
    });
  } catch (error: any) {
    logger.error('Upload complete failed:', error);
    return res.status(500).json({
      status: false,
      message: 'Upload failed',
      error: error.message,
    });
  }
};

/**
 * Handle batch upload completion
 * Reduces API calls and WebSocket chatter
 * POST /api/batch-upload-complete
 */
export const uploadBatchCompleteController = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventId, uploads } = req.body as {
      eventId: string;
      uploads: Array<{
        key: string;
        upload_id: string;
        width?: number;
        height?: number;
      }>
    };

    if (!eventId || !uploads || !Array.isArray(uploads) || uploads.length === 0) {
      return res.status(400).json({
        status: false,
        message: 'Event ID and uploads array are required'
      });
    }

    const userId = req.user?._id;
    const approvalResult = await validatePermissionsAndGetApproval(eventId, userId);

    const completedMedia: any[] = [];
    const eventsToEmit: any[] = [];

    // Process all uploads in parallel
    await Promise.all(uploads.map(async (uploadData) => {
      try {
        const { key, upload_id, width, height } = uploadData;

        // 🚀 FIXED: Use CloudFront or Presigned URL instead of raw S3
        let finalUrl = '';

        if (keys.useCloudFront && keys.cloudFrontDomain) {
          finalUrl = `https://${keys.cloudFrontDomain}/${key}`;
        } else {
          // Fallback to S3 Presigned URL (7 days)
          finalUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: keys.s3BucketName as string,
              Key: key,
            }),
            { expiresIn: 604800 }
          );
        }

        const s3Url = finalUrl; // Keep variable name for minimal diff, but it holds the accessible URL now

        // Find and update media
        let savedMedia;
        const existingMedia = await Media.findOne({
          $or: [
            { upload_id },
            { 'original.public_id': key }
          ]
        });

        if (existingMedia) {
          // Update dimensions if provided
          if (width && height) {
            existingMedia.original.width = width;
            existingMedia.original.height = height;
          }

          // Ensure URL is set
          if (!('url' in existingMedia.original) || !(existingMedia.original as any).url) {
            (existingMedia.original as any).url = s3Url;
          }

          // Update approval if currently pending (batch approval logic)
          if (existingMedia.approval.status === 'pending') {
            existingMedia.approval = {
              status: approvalResult.status as 'pending' | 'approved' | 'rejected' | 'hidden',
              reason: '',
            };
            existingMedia.markModified('approval'); // Ensure mongoose tracks the change
          }

          existingMedia.markModified('original');
          savedMedia = await existingMedia.save();
        } else {
          // Fallback logic for safety, though typically existingMedia should exist
          return;
        }

        if (savedMedia) {
          completedMedia.push({
            mediaId: savedMedia._id,
            originalUrl: s3Url,
            upload_id: savedMedia.upload_id,
            status: 'uploaded',
            width: savedMedia.original.width,
            height: savedMedia.original.height,
            // 🚀 ADDED: Approval status for frontend
            approval: savedMedia.approval,
            approval_status: savedMedia.approval?.status === 'approved',
          });

          // 🚀 Background Indexing
          if (savedMedia.type === 'image') {
            rekognitionService.indexFaces(
              keys.s3BucketName as string,
              key,
              savedMedia._id.toString(),
              eventId
            ).catch(err => logger.error(`Batch indexing failed for ${savedMedia._id}:`, err));
          }

          // Prepare event data
          eventsToEmit.push({
            mediaId: savedMedia._id,
            eventId: savedMedia.event_id,
            media: {
              url: s3Url,
              thumbnailUrl: s3Url,
              filename: savedMedia.original.filename,
              width: savedMedia.original.width,
              height: savedMedia.original.height
            },
            uploadedBy: {
              id: req.user?._id || 'guest',
              name: 'User', // Simplified for mass upload
              type: req.user?.role === 'guest' ? 'guest' : 'admin'
            },
            processingStatus: 'processing',
            isInstantPreview: true,
            // 🚀 ADDED: Approval status for WebSocket
            approval: savedMedia.approval,
            approval_status: savedMedia.approval?.status === 'approved',
          });
        }
      } catch (err) {
        logger.error(`Failed to process item in batch upload: ${uploadData.upload_id}`, err);
      }
    }));

    // Emit SINGLE batch event to WebSocket
    if (eventsToEmit.length > 0) {
      const webSocketService = getWebSocketService();

      const adminRoom = `admin_${eventId}`;
      const guestRoom = `guest_${eventId}`;

      const batchPayload = {
        eventId,
        count: eventsToEmit.length,
        items: eventsToEmit
      };

      webSocketService.io.to(adminRoom).emit('batch_media_uploaded', batchPayload);
      webSocketService.io.to(guestRoom).emit('batch_media_uploaded', batchPayload);

      logger.info(`WebSocket 'batch_media_uploaded' emitted for event ${eventId} with ${eventsToEmit.length} items`);
    }

    return res.status(200).json({
      status: true,
      message: `Batch upload completed for ${completedMedia.length} items`,
      data: {
        completedCount: completedMedia.length,
        results: completedMedia
      }
    });

  } catch (error: any) {
    logger.error('Error in batch upload completion:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

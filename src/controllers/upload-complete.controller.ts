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
    const { key, eventId, upload_id }: UploadCompleteRequest = req.body;

    console.log('key:', key, 'eventId:', eventId, 'upload_id:', upload_id);
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

    // Use atomic update with pipeline to prevent race conditions with Lambda
    // This ensures we don't overwrite 'completed' status/variants if Lambda beat us to it
    const existingMedia = await Media.findOneAndUpdate(
      { upload_id },
      [
        {
          $set: {
            // Update approval only if it's not already set
            approval: {
              $cond: {
                if: {
                  $or: [
                    { $not: ["$approval"] },
                    { $not: ["$approval.status"] },
                    { $eq: ["$approval.status", "pending"] } // Optional: Update if pending? Prefer safe update.
                  ]
                },
                then: {
                  status: approvalResult.status,
                  approved_by: approvalResult.approved_by,
                  approved_at: approvalResult.approved_at,
                  rejection_reason: '',
                  auto_approval_reason: approvalResult.auto_approval_reason || null
                },
                else: "$approval"
              }
            },
            approval_status: {
              $cond: {
                if: {
                  $or: [
                    { $not: ["$approval"] },
                    { $not: ["$approval.status"] },
                    { $eq: ["$approval.status", "pending"] }
                  ]
                },
                then: approvalResult.status === 'approved',
                else: "$approval_status"
              }
            },
            // Update processing status ONLY if variants haven't been generated yet
            "processing.status": {
              $cond: {
                if: { $eq: ["$processing.variants_generated", true] },
                then: "completed",
                else: "processing"
              }
            },
            "processing.current_stage": {
              $cond: {
                if: { $eq: ["$processing.variants_generated", true] },
                then: "completed",
                else: "processing"
              }
            },
            // Ensure other processing fields are set if we are in processing mode
            "processing.progress_percentage": {
              $cond: {
                if: { $eq: ["$processing.variants_generated", true] },
                then: "$processing.progress_percentage",
                else: 10
              }
            }
          }
        }
      ],
      { new: true }
    );

    if (existingMedia) {
      savedMedia = existingMedia;
      logger.info(`Media updated: ${savedMedia._id}, upload_id: ${upload_id}`);
    } else {
      // Fallback: Create new media if not found (old behavior)
      const media = new Media({
        url: key, // Store key instead of signed URL
        public_id: key,
        type: 'image',
        upload_id,
        event_id: eventId,
        album_id: eventId,
        original_filename: originalFileName,
        format: extension,
        guest_session_id: req.user?.role === 'guest' ? req.user?._id : null,
        uploaded_by: req.user?._id,
        size_mb: 0,
        processing: {
          status: 'processing',
          current_stage: 'processing',
          progress_percentage: 10,
          last_updated: new Date(),
        },
        approval: {
          ...approvalResult,
          rejection_reason: '', // Default
          auto_approval_reason: (approvalResult.auto_approval_reason as any) || null // Ensure compatible type
        } as any,
        approval_status: approvalResult.status === 'approved',
        uploader_type: req.user?.role === 'guest' ? 'guest' : 'registered_user',
        created_at: new Date(),
        updated_at: new Date(),
        deleteGroup: `event-${eventId}-upload-${upload_id}`
      });

      savedMedia = await media.save();
      logger.info(`Media created (fallback): ${savedMedia._id}, upload_id: ${upload_id}`);
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
      approval_status: savedMedia.approval?.status === 'approved' || savedMedia.approval?.status === 'auto_approved',
      timestamp: new Date(),
      uploader: {
        type: savedMedia.uploader_type,
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
      approval_status: savedMedia.approval?.status === 'approved' || savedMedia.approval?.status === 'auto_approved',
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


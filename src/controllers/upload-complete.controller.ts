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
          width: extension.match(/^(mp4|mov|avi|mkv)$/i) ? undefined : 0, // Images only
          height: extension.match(/^(mp4|mov|avi|mkv)$/i) ? undefined : 0, // Images only
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


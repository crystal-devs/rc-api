import { Request, Response } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Media } from '@models/media.model';
import { getWebSocketService } from '@services/websocket/websocket.service';
import { S3Client } from '@aws-sdk/client-s3';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';

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

    // ────────────────────── SAVE TO MONGODB ──────────────────────
    const media = new Media({
      url: originalUrl,                    // ← Presigned for 7 days
      public_id: key,                      // ← Raw S3 key (permanent reference)
      type: 'image',
      upload_id,                           // ← Unique UUID
      event_id: eventId,
      album_id: eventId,
      original_filename: originalFileName,
      format: extension,
      guest_session_id: req.user?.role === 'guest' ? req.user?._id : null,
      uploaded_by: req.user?._id,
      size_mb: 0, // You can get from S3 HeadObject if needed
      processing: {
        status: 'processing',
        current_stage: 'uploading',
        progress_percentage: 100,
        last_updated: new Date(),
      },
      approval: approvalResult,
      uploader_type: req.user?.role === 'guest' ? 'guest' : 'registered_user',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const savedMedia = await media.save();

    logger.info(`Media saved: ${savedMedia._id}, upload_id: ${upload_id}, key: ${key}`);

    // ────────────────────── WEBSOCKET: photo-uploading ──────────────────────
    const webSocketService = getWebSocketService();
    const payload = {
      mediaId: savedMedia._id.toString(),
      eventId,
      originalUrl,
      fileName: originalFileName,
      status: 'uploaded',
      timestamp: new Date(),
      uploader: {
        type: media.uploader_type,
        id: req.user?._id || null,
      },
    };

    const adminRoom = `admin_${eventId}`;
    const guestRoom = `guest_${eventId}`;

    webSocketService.io.to(adminRoom).emit('photo-uploading', payload);
    webSocketService.io.to(guestRoom).emit('photo-uploading', payload);

    logger.info(`WebSocket 'photo-uploading' emitted for event ${eventId}`);

    // ────────────────────── RESPONSE ──────────────────────
    return res.status(200).json({
      status: true,
      message: 'Upload completed',
      data: {
        mediaId: savedMedia._id.toString(),
        originalUrl,
        upload_id,
        status: 'uploaded',
      },
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

const validatePermissionsAndGetApproval = async (eventId: string, userId: string) => {
  const event = await Event.findById(eventId)
    .select('permissions created_by')
    .lean();

  console.log(event, userId, eventId, 'Event from validatePermissionsAndGetApproval');
  if (!event) {
    throw new Error('Event not found');
  }
  if (event.created_by.toString() === userId.toString()) {
    return { status: 'approved', auto_approval_reason: 'authenticated_user', approved_by: userId, approved_at: new Date() };
  }

  return { status: 'pending', auto_approval_reason: null, approved_by: null, approved_at: null };
};
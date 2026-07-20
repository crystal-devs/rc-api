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
import { videoProcessingQueue } from '@queues/video-processing.queue';

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

// DPDP: face indexing only runs for events whose host opted in
const isFaceIndexingEnabled = async (eventId: string): Promise<boolean> => {
  try {
    const event = await Event.findById(eventId).select('face_recognition.enabled').lean();
    return !!event?.face_recognition?.enabled;
  } catch (error) {
    logger.error(`Failed to read face_recognition setting for event ${eventId}:`, error);
    return false;
  }
};

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
    const { key, eventId, upload_id, width, height }: UploadCompleteRequest = req.body;

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

    const fileKey = keyParts[3]; 
    const extension = fileKey.split('.').pop()?.toLowerCase() || 'jpg';
    const originalFileName = fileKey.replace(upload_id, '').replace(/^\./, '') || 'image.jpg';

    // ────────────────────── PRESIGNED URL (7 days) ──────────────────────
    const originalUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: keys.s3BucketName as string,
        Key: key,
      }),
      { expiresIn: 604800 } 
    );

    const approvalResult = await validatePermissionsAndGetApproval(eventId, userId);

    // ────────────────────── SAVE/UPDATE MONGODB ──────────────────────
    let savedMedia;

    // Check if media already exists
    const existingMedia = await Media.findOne({ upload_id });

    if (existingMedia) {
      if (existingMedia.approval.status === 'pending') {
        existingMedia.approval = {
          status: approvalResult.status as 'pending' | 'approved' | 'rejected' | 'hidden',
          reason: '',
        };
      }

      if (width && height && (existingMedia.original.width === 0 || !existingMedia.original.width)) {
        existingMedia.original.width = width;
        existingMedia.original.height = height;
      }

      savedMedia = await existingMedia.save();
      logger.info(`Media updated: ${savedMedia._id}, upload_id: ${upload_id}`);
    } else {
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
          width: width || (extension.match(/^(mp4|mov|avi|mkv)$/i) ? undefined : 0),
          height: height || (extension.match(/^(mp4|mov|avi|mkv)$/i) ? undefined : 0),
          duration: extension.match(/^(mp4|mov|avi|mkv)$/i) ? 0 : undefined,
          format: extension as any,
          size_mb: 0,
        },
        variants: {},
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

    // ────────────────────── ASYNC: INDEX FACES (consent-gated) ──────────────────────
    if (savedMedia.type === 'image' && await isFaceIndexingEnabled(eventId)) {
      rekognitionService.queueIndexFaces(
        keys.s3BucketName as string,
        key,
        savedMedia._id.toString(),
        eventId
      );
    }

    // ────────────────────── ASYNC: VIDEO PROCESSING (poster + 720p) ──────────────────────
    if (savedMedia.type === 'video') {
      videoProcessingQueue.add('process-video', {
        mediaId: savedMedia._id.toString(),
        eventId,
        uploadId: upload_id,
        s3Key: key,
      });
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

    return res.status(200).json({
      status: true,
      message: 'Upload completed',
      data: {
        mediaId: savedMedia._id.toString(),
        originalUrl,
        upload_id,
        status: 'uploaded',
        approval: savedMedia.approval,
        approval_status: savedMedia.approval?.status === 'approved',
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

/**
 * Handle batch upload completion - Optimized with MongoDB bulkWrite
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
    const bulkOps: any[] = [];

    // 1. Prepare URLs for all uploads (Parallel but non-DB)
    const processedItems = await Promise.all(uploads.map(async (upload) => {
      let finalUrl = '';
      if (keys.useCloudFront && keys.cloudFrontDomain) {
        finalUrl = `https://${keys.cloudFrontDomain}/${upload.key}`;
      } else {
        finalUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: keys.s3BucketName as string,
            Key: upload.key,
          }),
          { expiresIn: 604800 }
        );
      }
      return { ...upload, finalUrl };
    }));

    // 2. Fetch all media records in ONE query
    const uploadIds = uploads.map(u => u.upload_id);
    const s3Keys = uploads.map(u => u.key);
    
    const existingMediaRecords = await Media.find({
      $or: [
        { upload_id: { $in: uploadIds } },
        { 'original.public_id': { $in: s3Keys } }
      ]
    });

    // 3. Process records in memory and build bulk operations
    const faceIndexingEnabled = await isFaceIndexingEnabled(eventId);
    for (const item of processedItems) {
      const media = existingMediaRecords.find(m => 
        m.upload_id === item.upload_id || m.original?.public_id === item.key
      );

      if (media) {
        const mediaIdStr = media._id.toString();
        
        // Prepare update object
        const updateData: any = {
          'original.url': item.finalUrl,
        };
        
        if (item.width) updateData['original.width'] = item.width;
        if (item.height) updateData['original.height'] = item.height;
        
        // Approval logic
        if (media.approval?.status === 'pending') {
          updateData['approval.status'] = approvalResult.status;
          updateData['approval.reason'] = '';
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: media._id },
            update: { $set: updateData }
          }
        });

        // Response Data
        completedMedia.push({
          mediaId: mediaIdStr,
          originalUrl: item.finalUrl,
          upload_id: item.upload_id,
          status: 'uploaded',
          width: item.width || media.original?.width,
          height: item.height || media.original?.height,
          approval: {
            status: updateData['approval.status'] || media.approval?.status,
            reason: ''
          },
          approval_status: (updateData['approval.status'] || media.approval?.status) === 'approved'
        });

        // Queue Rekognition (consent-gated)
        if (media.type === 'image' && faceIndexingEnabled) {
          rekognitionService.queueIndexFaces(
            keys.s3BucketName as string,
            item.key,
            mediaIdStr,
            eventId
          );
        }

        // Queue video processing (poster + 720p)
        if (media.type === 'video') {
          videoProcessingQueue.add('process-video', {
            mediaId: mediaIdStr,
            eventId,
            uploadId: item.upload_id,
            s3Key: item.key,
          });
        }

        // WebSocket events
        eventsToEmit.push({
          mediaId: mediaIdStr,
          eventId,
          media: {
            url: item.finalUrl,
            thumbnailUrl: item.finalUrl,
            filename: media.original?.filename,
            width: item.width || media.original?.width,
            height: item.height || media.original?.height
          },
          uploadedBy: {
            id: req.user?._id || 'guest',
            name: 'User',
            type: req.user?.role === 'guest' ? 'guest' : 'admin'
          },
          processingStatus: 'processing',
          isInstantPreview: true,
          approval: {
            status: updateData['approval.status'] || media.approval?.status,
            reason: ''
          },
          approval_status: (updateData['approval.status'] || media.approval?.status) === 'approved'
        });
      }
    }

    // 4. EXECUTE BULK WRITE
    if (bulkOps.length > 0) {
      await Media.bulkWrite(bulkOps);
      logger.info(`✅ Executed bulkWrite for ${bulkOps.length} media items in event ${eventId}`);
    }

    // 5. EMIT WEBSOCKET BATCH
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
      logger.info(`WebSocket 'batch_media_uploaded' emitted for ${eventsToEmit.length} items`);
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

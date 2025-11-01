import { Request, Response } from 'express';
import { uploadCompleteService } from '@services/upload-complete.service';
import { logger } from '@utils/logger';

interface UploadCompleteRequest {
  originalUrl: string;
  eventId: string;
  upload_id: string;
  filename: string;
  size_mb: number;
  format: string;
  width?: number;
  height?: number;
}

interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    role?: string;
    name?: string;
  };
  guestSession?: {
    _id: string;
    guestInfo?: any;
  };
}

/**
 * Handle upload completion - process direct URL uploads
 * POST /api/upload-complete
 */
export const uploadCompleteController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const {
      originalUrl,
      eventId,
      upload_id,
      filename,
      size_mb,
      format,
      width,
      height
    }: UploadCompleteRequest = req.body;

    logger.info(`Upload complete request: ${filename}, event: ${eventId}`);

    // ────────────────────── VALIDATION ──────────────────────
    if (!originalUrl || !eventId || !upload_id || !filename || !size_mb || !format) {
      return res.status(400).json({
        status: false,
        message: 'Missing required fields: originalUrl, eventId, upload_id, filename, size_mb, format',
      });
    }

    // Determine user context
    const userId = req.user?._id;
    const userName = req.user?.name || 'Unknown';
    const isGuestUpload = req.user?.role === 'guest' || !!req.guestSession;
    const guestSessionId = req.guestSession?._id || (req.user?.role === 'guest' ? req.user._id : null);
    const guestInfo = req.guestSession?.guestInfo;

    // ────────────────────── PROCESS UPLOAD ──────────────────────
    const result = await uploadCompleteService.processUploadComplete({
      originalUrl,
      eventId,
      upload_id,
      filename,
      size_mb,
      format,
      width,
      height,
      userId,
      userName,
      isGuestUpload,
      guestSessionId,
      guestInfo
    });

    logger.info(`Upload completed successfully: ${result.mediaId}`);

    // ────────────────────── RESPONSE ──────────────────────
    return res.status(200).json({
      status: true,
      message: 'Upload completed successfully',
      data: {
        mediaId: result.mediaId,
        originalUrl: result.url,
        upload_id,
        filename: result.filename,
        size_mb: result.size_mb,
        format: result.format,
        approval: result.approval,
        status: 'completed'
      },
    });

  } catch (error: any) {
    logger.error('Upload complete failed:', error);

    // Handle specific error types
    if (error.message.includes('not allowed') ||
        error.message.includes('does not have access') ||
        error.message.includes('does not have upload permissions')) {
      return res.status(403).json({
        status: false,
        message: 'Upload not permitted',
        error: error.message,
      });
    }

    if (error.message.includes('Event not found')) {
      return res.status(404).json({
        status: false,
        message: 'Event not found',
        error: error.message,
      });
    }

    return res.status(500).json({
      status: false,
      message: 'Upload processing failed',
      error: error.message,
    });
  }
};
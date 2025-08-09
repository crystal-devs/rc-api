// types/queue.ts - Type definitions for image processing queue

export interface ImageProcessingJobData {
  mediaId: string;
  userId: string;
  eventId: string;
  albumId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
}

export interface ProcessedImageVariant {
  url: string;
  width: number;
  height: number;
  size_mb: number;
  format: 'webp' | 'jpeg';
}

export interface ImageProcessingResult {
  mediaId: string;
  original: {
    url: string;
    width: number;
    height: number;
    size_mb: number;
    format: string;
  };
  variants: {
    small: {
      webp: ProcessedImageVariant;
      jpeg: ProcessedImageVariant;
    };
    medium: {
      webp: ProcessedImageVariant;
      jpeg: ProcessedImageVariant;
    };
    large: {
      webp: ProcessedImageVariant;
      jpeg: ProcessedImageVariant;
    };
  };
}

export interface VariantConfig {
  name: 'small' | 'medium' | 'large';
  width: number;
  quality: number;
  format: 'webp' | 'jpeg';
}

export interface UploadResult {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'queued';
  jobId?: string;
  estimatedProcessingTime?: number;
  processingMode: 'sync' | 'queue';
  data?: any;
}

export interface UploadResponse {
  status: boolean;
  message: string;
  data: {
    uploads: UploadResult[];
    errors?: Array<{
      filename: string;
      error: string;
    }>;
    summary: {
      total: number;
      success: number;
      failed: number;
    };
    processingMode: 'sync' | 'queue';
    note?: string;
  };
}
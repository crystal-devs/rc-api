// types/queue.ts - Queue job data types

export interface ImageProcessingJobData {
  mediaId: string;
  userId: string;
  eventId: string;
  albumId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  hasPreview?: boolean; // Flag to indicate preview exists
}

export interface ImageProcessingJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  removeOnComplete?: number;
  removeOnFail?: number;
}

export interface ImageVariant {
  url: string;
  width: number;
  height: number;
  size_mb: number;
  format: 'webp' | 'jpeg';
}

export interface ProcessingResult {
  success: boolean;
  mediaId: string;
  processingTime: number;
  variants: number;
  originalUrl: string;
  variantUrls: {
    small_webp?: string;
    small_jpeg?: string;
    medium_webp?: string;
    medium_jpeg?: string;
    large_webp?: string;
    large_jpeg?: string;
  };
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
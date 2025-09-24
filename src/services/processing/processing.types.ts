// 1. services/processing/processing.types.ts
// ====================================

export interface ImageProcessingJobData {
    mediaId: string;
    eventId: string;
    filePath: string;
    originalFilename: string;
    userId?: string;
    userName?: string;
    albumId?: string;
    fileSize?: number;
    mimeType?: string;
    isGuestUpload?: boolean;
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
            webp: ProcessedImageVariant | null; 
            jpeg: ProcessedImageVariant | null; 
        };
        medium: { 
            webp: ProcessedImageVariant | null; 
            jpeg: ProcessedImageVariant | null; 
        };
        large: { 
            webp: ProcessedImageVariant | null; 
            jpeg: ProcessedImageVariant | null; 
        };
    };
}

export interface VariantConfig {
    name: 'small' | 'medium' | 'large';
    width: number;
    quality: number;
    format: 'webp' | 'jpeg';
}

export interface ImageMetadata {
    width: number;
    height: number;
    format?: string;
    size: number;
}
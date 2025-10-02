// ====================================
// 3. services/external/imagekit/types.ts
// ====================================

export interface ImageKitUploadOptions {
    eventId: string;
    mediaId: string;
    isGuestUpload?: boolean;
}

export interface ImageKitUploadResult {
    url: string;
    fileId: string;
    size?: number;
}

export interface ImageKitVariantUpload {
    name: string;
    format: string;
    buffer: Buffer;
    width: number;
    height: number;
    size_mb: number;
}
// 1. services/guest/guest.types.ts
// ====================================

export interface GuestUploadResult {
    success: boolean;
    media_id?: string;
    url?: string;
    approval_status?: string;
    message?: string;
    error?: string;
    processing_status?: string;
    estimated_processing_time?: string;
}

export interface GuestUploadInfo {
    name?: string;
    email?: string;
    phone?: string;
    sessionId?: string;
    deviceFingerprint?: string;
    uploadMethod?: string;
    platformInfo?: any;
}

export interface GuestUploadPermission {
    allowed: boolean;
    event?: any;
    reason?: string;
}

export interface GuestUploadStats {
    totalGuestUploads: number;
    totalGuestUploaders: number;
    recentUploads: number;
    avgUploadsPerGuest: number;
}

export interface ImageMetadata {
    width: number;
    height: number;
    aspect_ratio: number;
}

export interface ProcessingJobData {
    mediaId: string;
    userId: string;
    userName: string;
    eventId: string;
    albumId: string;
    filePath: string;
    originalFilename: string;
    fileSize: number;
    mimeType: string;
    hasPreview: boolean;
    previewBroadcasted: boolean;
    isGuestUpload: boolean;
}
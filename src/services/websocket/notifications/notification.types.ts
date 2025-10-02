export interface MediaNotificationPayload {
    eventId: string;
    uploadedBy: {
        id: string;
        name: string;
        type: string;
        email?: string;
    };
    mediaData: {
        mediaId: string;
        url: string;
        filename: string;
        type: string;
        size: number;
        approvalStatus: string;
    };
    requiresApproval: boolean;
}

export interface BulkMediaNotificationPayload {
    eventId: string;
    uploadedBy: {
        id: string;
        name: string;
        type: string;
        email?: string;
    };
    mediaItems: Array<{
        mediaId: string;
        url: string;
        filename: string;
        type: string;
        size: number;
        approvalStatus: string;
    }>;
    totalCount: number;
    requiresApproval: boolean;
}

export interface MediaBroadcastPayload {
    mediaId: string;
    eventId: string;
    uploadedBy: { id: string; name: string; type: any };
    mediaData: {
        hasInstantPreview: boolean;
        url: string;
        filename: string;
        type: string;
        size: number;
        format?: string;
    };
}

export interface ProcessingCompletePayload {
    mediaId: string;
    eventId: string;
    newUrl: string;
    variants?: {
        thumbnail?: string;
        display?: string;
        full?: string;
    };
    processingTimeMs?: number;
}

export interface ProcessingFailedPayload {
    mediaId: string;
    eventId: string;
    errorMessage: string;
}

export interface MediaRemovedPayload {
    mediaId: string;
    eventId: string;
    reason: string;
    adminName?: string;
}

// notification.types.ts - Add this interface
export interface BulkMediaUploadPayload {
    batchId: string;
    eventId: string;
    uploadedBy: {
        id: string;
        name: string;
        type: string;
    };
    fileCount: number;
    estimatedCompletionTime: string;
}

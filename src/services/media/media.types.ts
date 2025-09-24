// 1. services/media/media.types.ts
// ====================================

export interface ServiceResponse<T> {
    status: boolean;
    code: number;
    message: string;
    data: T | null;
    error: any;
    other?: any;
}

export interface MediaQueryOptions {
    includeProcessing?: boolean;
    includePending?: boolean;
    page?: number;
    limit?: number;
    since?: string;
    status?: string;
    cursor?: string;
    scrollType?: 'pagination' | 'infinite';
    quality?: 'small' | 'medium' | 'large' | 'original' | 'thumbnail' | 'display' | 'full';
    format?: 'webp' | 'jpeg' | 'auto';
    context?: 'mobile' | 'desktop' | 'lightbox';
}

export interface StatusUpdateOptions {
    adminId?: string;
    adminName?: string;
    reason?: string;
    hideReason?: string;
}

export interface MediaItem {
    _id: string;
    url: string;
    type: string;
    original_filename: string;
    metadata?: {
        width?: number;
        height?: number;
        aspect_ratio?: number;
    };
    approval?: {
        status: string;
        approved_at?: Date;
    };
    image_variants?: any;
    created_at: Date;
    updated_at: Date;
}
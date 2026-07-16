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
    quality?: 'small' | 'medium' | 'large' | 'original'
    format?: 'webp' | 'jpeg' | 'auto';
    context?: 'mobile' | 'desktop' | 'lightbox';
    /**
     * Sub-event (function) filter — Phase 1. An ObjectId limits results to that
     * function; the literal 'none' returns only media not tagged to any function
     * (the whole-event / main gallery). Omit for every item in the event.
     */
    subEventId?: string;
    /** Favorites-only filter — Phase 3 (host curation / keepsake source). */
    favoritesOnly?: boolean;
    /** Sort order — Phase 3. 'oldest' flips the default newest-first upload sort. */
    sort?: 'newest' | 'oldest';
    /** Case-insensitive filename search — Phase 3. */
    search?: string;
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
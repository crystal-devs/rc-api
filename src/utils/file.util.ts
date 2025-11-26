// utils/file.util.ts - Updated to use your existing getCachedSignedUrl()

import { logger } from './logger';
import { getCachedSignedUrl } from './signedUrl'; // ← Import your existing function

/**
 * Determine file type based on MIME type
 */
export function getFileType(file: Express.Multer.File): 'image' | 'video' | null {
    if (file.mimetype.startsWith("image/")) return "image";
    if (file.mimetype.startsWith("video/")) return "video";
    return null;
}

/**
 * Validate if file is a supported image format
 */
export function isValidImageFormat(file: Express.Multer.File): boolean {
    const validImageTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'image/tiff',
        'image/tif'
    ];
    return validImageTypes.includes(file.mimetype.toLowerCase());
}

/**
 * Validate if file is a supported video format
 */
export function isValidVideoFormat(file: Express.Multer.File): boolean {
    const validVideoTypes = [
        'video/mp4',
        'video/mpeg',
        'video/quicktime',
        'video/x-msvideo',
        'video/webm',
        'video/x-ms-wmv'
    ];
    return validVideoTypes.includes(file.mimetype.toLowerCase());
}

/**
 * Convert bytes to MB with precision
 */
export function bytesToMB(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/**
 * Convert MB to bytes
 */
export function mbToBytes(mb: number): number {
    return Math.round(mb * 1024 * 1024);
}

/**
 * Select best format URL using your getCachedSignedUrl function
 * Prefers WebP (97% browser support) and falls back to JPEG
 */
async function selectBestFormatUrl(variant: any): Promise<string | null> {
    // Prefer WebP
    if (variant.webp?.public_id) {
        return await getCachedSignedUrl(variant.webp.public_id);
    }

    // Fallback to JPEG
    if (variant.jpeg?.public_id) {
        return await getCachedSignedUrl(variant.jpeg.public_id);
    }

    return null;
}

/**
 * Get responsive image URLs for a media item
 * Returns WebP or JPEG URLs with signed access, all cached
 */
export async function getResponsiveImageUrls(
    mediaItem: any
): Promise<{
    thumbnail: string | null;
    display: string | null;
    full: string | null;
    original: string | null;
}> {
    // If we have a public_id, we can at least return the original
    const originalUrl = mediaItem.public_id
        ? await getCachedSignedUrl(mediaItem.public_id)
        : null;

    if (!mediaItem?.image_variants || mediaItem.type !== 'image') {
        // Fallback to original for all sizes if no variants
        return {
            thumbnail: originalUrl,
            display: originalUrl,
            full: originalUrl,
            original: originalUrl,
        };
    }

    const variants = mediaItem.image_variants;

    return {
        thumbnail: await selectBestFormatUrl(variants.small) || originalUrl,
        display: await selectBestFormatUrl(variants.medium) || originalUrl,
        full: await selectBestFormatUrl(variants.large) || originalUrl,
        original: originalUrl,
    };
}

/**
 * Check if media item has completed variants
 */
export function hasImageVariants(mediaItem: any): boolean {
    return !!(
        mediaItem?.image_variants &&
        mediaItem.type === 'image' &&
        mediaItem.processing?.status === 'completed' &&
        mediaItem.processing?.variants_generated === true
    );
}

/**
 * Get uploader display name
 */
function getUploaderDisplayName(mediaItem: any): string {
    if (mediaItem.uploader_type === 'registered_user' && mediaItem.uploaded_by) {
        if (typeof mediaItem.uploaded_by === 'object' && mediaItem.uploaded_by.name) {
            return mediaItem.uploaded_by.name;
        }
        return 'Registered User';
    } else if (mediaItem.uploader_type === 'guest' && mediaItem.guest_uploader) {
        return mediaItem.guest_uploader.name || 'Anonymous Guest';
    }
    return 'Unknown User';
}

/**
 * Media metadata interface for API response
 */
export interface MediaMetadata {
    _id: string;
    type: string;
    url: string;
    processing_status: string;
    approval_status: string;
    size_mb: number;
    format: string;
    uploader_display_name: string;
    dimensions: {
        width: number;
        height: number;
        aspect_ratio: number;
    } | null;
    stats: any;
    created_at: string;
    responsive_urls: {
        thumbnail: string | null;
        display: string | null;
        full: string | null;
        original: string | null;
    };
}

/**
 * Get media metadata for API response
 * Calls getResponsiveImageUrls which uses your getCachedSignedUrl()
 */
export async function getMediaMetadata(mediaItem: any): Promise<MediaMetadata> {
    // Always regenerate signed URL if public_id exists
    // This fixes the issue of expired URLs stored in the database
    let mainUrl = mediaItem.url;
    if (mediaItem.public_id) {
        mainUrl = await getCachedSignedUrl(mediaItem.public_id);
    }

    return {
        _id: mediaItem._id?.toString() || mediaItem._id,
        type: mediaItem.type,
        url: mainUrl,
        processing_status: mediaItem.processing?.status || 'unknown',
        approval_status: mediaItem.approval?.status || 'pending',
        size_mb: mediaItem.size_mb || 0,
        format: mediaItem.format || '',
        uploader_display_name: getUploaderDisplayName(mediaItem),
        dimensions: mediaItem.metadata ? {
            width: mediaItem.metadata.width || 0,
            height: mediaItem.metadata.height || 0,
            aspect_ratio: mediaItem.metadata.aspect_ratio || 1
        } : null,
        stats: mediaItem.stats || {
            views: 0,
            downloads: 0,
            shares: 0,
            likes: 0,
            comments_count: 0
        },
        created_at: mediaItem.created_at,
        responsive_urls: await getResponsiveImageUrls(mediaItem), // ← Uses cached URLs
    };
}

/**
 * Transform media array for API response
 * Each item gets responsive_urls from cache
 */
export async function transformMediaForResponse(
    mediaItems: any[]
): Promise<MediaMetadata[]> {
    return Promise.all(mediaItems.map((item) => getMediaMetadata(item)));
}
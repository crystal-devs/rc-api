// utils/file.util.ts - Updated with Redis-backed signed URL cache and batch operations

import { logger } from './logger';
import { getCachedSignedUrl, getCachedSignedUrlsBatch } from './cloudfront-url.util';
import fs from 'fs';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);

export const cleanupFile = async (file: Express.Multer.File | { path: string }) => {
    if (!file || !file.path) return;
    try {
        await unlinkAsync(file.path);
    } catch (error) {
        logger.warn(`Failed to delete temporary file: ${file.path}`, error);
    }
};

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
/**
 * Get uploader display name
 */
function getUploaderDisplayName(mediaItem: any): string {
    // Check for owner field (Schema compliant)
    if (mediaItem.owner) {
        if (mediaItem.owner.type === 'registered_user') {
            // Note: Since we are using lean(), populated user data might not be here.
            // If user_id is populated as an object with name:
            if (mediaItem.owner.user_id && typeof mediaItem.owner.user_id === 'object' && mediaItem.owner.user_id.name) {
                return mediaItem.owner.user_id.name;
            }
            return 'User';
        } else if (mediaItem.owner.type === 'guest') {
            // Priority: Snapshot display_name (new) > guest_id (fallback)
            return mediaItem.owner.display_name || 'Anonymous Guest';
        }
    }

    // Fallback for legacy or loose objects
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
    processing?: {
        status: string;
        stage?: string;
        progress?: number;
        error?: string;
    };
    approval_status: string;
    size_mb: number;
    format: string;
    uploaded_by?: string;
    uploader_type?: string;
    guest_uploader?: any;
    uploader_display_name: string;
    dimensions: {
        width: number;
        height: number;
    } | null;
    stats: any;
    created_at: string;
    responsive_urls: {
        thumbnail: string | null;
        display: string | null;
        full: string | null;
        original: string | null;
    };
    // image_variants removed for optimization
}

/**
 * Get responsive image URLs using pre-generated cache
 */
async function getResponsiveImageUrlsWithCache(
    mediaItem: any,
    urlCache: Map<string, string>
): Promise<{
    thumbnail: string | null;
    display: string | null;
    full: string | null;
    original: string | null;
}> {
    const publicId = mediaItem.public_id || mediaItem.original?.public_id;
    const originalUrl = publicId
        ? (urlCache.get(publicId) || await getCachedSignedUrl(publicId))
        : null;

    // Unified Schema Support (variants.images OR variants.thumbnails for videos)
    if (mediaItem.variants) {
        // VIDEO HANDLING
        if (mediaItem.type === 'video' && mediaItem.variants.thumbnails) {
            const thumbs = mediaItem.variants.thumbnails;

            // Prefer poster for static grid, preview for hover
            const posterUrl = thumbs.poster?.public_id ? (urlCache.get(thumbs.poster.public_id) || await getCachedSignedUrl(thumbs.poster.public_id)) : null;
            const previewUrl = thumbs.preview?.public_id ? (urlCache.get(thumbs.preview.public_id) || await getCachedSignedUrl(thumbs.preview.public_id)) : null;

            return {
                thumbnail: posterUrl || previewUrl || originalUrl, // Lightweight preview
                display: posterUrl || previewUrl || originalUrl,   // Lightweight preview
                full: originalUrl, // Click to play full video
                original: originalUrl,
            };
        }

        // IMAGE HANDLING
        if (mediaItem.variants.images) {
            const images = mediaItem.variants.images;
            const getUrl = async (variant: any) => {
                if (!variant?.public_id) return null;
                return urlCache.get(variant.public_id) || await getCachedSignedUrl(variant.public_id);
            };

            return {
                thumbnail: await getUrl(images.small) || originalUrl,
                display: await getUrl(images.medium) || originalUrl,
                full: await getUrl(images.large) || originalUrl,
                original: originalUrl,
            };
        }
    }

    // Legacy Schema Support (image_variants)
    if (!mediaItem?.image_variants || mediaItem.type !== 'image') {
        return {
            thumbnail: originalUrl,
            display: originalUrl,
            full: originalUrl,
            original: originalUrl,
        };
    }

    const variants = mediaItem.image_variants;

    const getVariantUrl = async (variant: any): Promise<string | null> => {
        if (variant?.webp?.public_id) {
            return urlCache.get(variant.webp.public_id) || await getCachedSignedUrl(variant.webp.public_id);
        }
        if (variant?.jpeg?.public_id) {
            return urlCache.get(variant.jpeg.public_id) || await getCachedSignedUrl(variant.jpeg.public_id);
        }
        return null;
    };

    return {
        thumbnail: await getVariantUrl(variants.small) || originalUrl,
        display: await getVariantUrl(variants.medium) || originalUrl,
        full: await getVariantUrl(variants.large) || originalUrl,
        original: originalUrl,
    };
}

/**
 * Get media metadata using pre-generated URL cache
 */
async function getMediaMetadataWithCache(mediaItem: any, urlCache: Map<string, string>): Promise<MediaMetadata> {
    // Get main URL from cache or generate
    // Get main URL from cache or generate
    let mainUrl = mediaItem.url;
    const publicId = mediaItem.public_id || mediaItem.original?.public_id;

    if (publicId) {
        mainUrl = urlCache.get(publicId) || await getCachedSignedUrl(publicId);
    }

    // Get responsive URLs using cache
    const responsiveUrls = await getResponsiveImageUrlsWithCache(mediaItem, urlCache);

    // Construct authorized image_variants with signed URLs
    // REMOVED to save bandwidth as per optimization request. 
    // responsive_urls provides sufficient data for frontend display.
    /* 
    let authorizedVariants = null;
    if (mediaItem.image_variants) {
        authorizedVariants = JSON.parse(JSON.stringify(mediaItem.image_variants)); // Deep copy

        // Helper to update variant URL
        const updateVariantUrl = async (variant: any) => {
            if (variant?.webp?.public_id) {
                variant.webp.url = urlCache.get(variant.webp.public_id) || await getCachedSignedUrl(variant.webp.public_id);
            }
            if (variant?.jpeg?.public_id) {
                variant.jpeg.url = urlCache.get(variant.jpeg.public_id) || await getCachedSignedUrl(variant.jpeg.public_id);
            }
        };

        if (authorizedVariants.small) await updateVariantUrl(authorizedVariants.small);
        if (authorizedVariants.medium) await updateVariantUrl(authorizedVariants.medium);
        if (authorizedVariants.large) await updateVariantUrl(authorizedVariants.large);

        // Also update original
        if (authorizedVariants.original && mediaItem.public_id) {
            authorizedVariants.original.url = mainUrl;
        }
    }
    */

    return {
        _id: mediaItem._id?.toString() || mediaItem._id,
        type: mediaItem.type,
        url: mainUrl,
        processing_status: mediaItem.processing?.status || 'unknown',
        processing: {
            status: mediaItem.processing?.status || 'unknown',
            stage: mediaItem.processing?.stage,
            progress: mediaItem.processing?.progress,
            error: mediaItem.processing?.error
        },
        approval_status: mediaItem.approval?.status || 'pending',
        size_mb: mediaItem.original?.size_mb || mediaItem.size_mb || 0,
        format: mediaItem.original?.format || mediaItem.format || '',

        // Owner / Uploader mapping
        uploaded_by: mediaItem.owner?.user_id?.toString() || mediaItem.uploaded_by,
        uploader_type: mediaItem.owner?.type || mediaItem.uploader_type,
        guest_uploader: mediaItem.owner?.type === 'guest' ? { guest_id: mediaItem.owner.guest_id } : mediaItem.guest_uploader,
        uploader_display_name: getUploaderDisplayName(mediaItem),

        dimensions: {
            // Priority: original schema > metadata logic > default
            width: mediaItem.original?.width || mediaItem.metadata?.width || 0,
            height: mediaItem.original?.height || mediaItem.metadata?.height || 0
        },
        stats: mediaItem.stats || {
            views: 0,
            downloads: 0,
            shares: 0,
            likes: 0,
            comments_count: 0
        },
        created_at: mediaItem.created_at,
        responsive_urls: responsiveUrls,
        // image_variants: authorizedVariants // Removed for bandwidth optimization
    };
}

/**
 * Transform media array for API response with batch URL generation
 * Optimized to generate all URLs in a single batch operation
 */
export async function transformMediaForResponse(
    mediaItems: any[]
): Promise<MediaMetadata[]> {
    if (mediaItems.length === 0) return [];

    // Collect all unique public_ids for batch URL generation
    const urlsToGenerate: Array<{ s3Key: string; expiresIn: number }> = [];
    const seenKeys = new Set<string>();

    mediaItems.forEach(item => {
        const publicId = item.public_id || item.original?.public_id;
        if (publicId && !seenKeys.has(publicId)) {
            urlsToGenerate.push({ s3Key: publicId, expiresIn: 3600 });
            seenKeys.add(publicId);
        }

        // Collect unified variants (variants.images AND variants.thumbnails)
        if (item.variants) {
            // Images
            if (item.variants.images) {
                ['small', 'medium', 'large'].forEach(size => {
                    const variant = item.variants.images[size];
                    if (variant?.public_id && !seenKeys.has(variant.public_id)) {
                        urlsToGenerate.push({ s3Key: variant.public_id, expiresIn: 3600 });
                        seenKeys.add(variant.public_id);
                    }
                });
            }
            // Video Thumbnails
            if (item.variants.thumbnails) {
                ['poster', 'preview'].forEach(type => {
                    const variant = item.variants.thumbnails[type];
                    if (variant?.public_id && !seenKeys.has(variant.public_id)) {
                        urlsToGenerate.push({ s3Key: variant.public_id, expiresIn: 3600 });
                        seenKeys.add(variant.public_id);
                    }
                });
            }
        }

        // Collect legacy variants (image_variants)
        if (item.image_variants) {
            ['small', 'medium', 'large'].forEach(size => {
                const variant = item.image_variants[size];
                if (variant?.webp?.public_id && !seenKeys.has(variant.webp.public_id)) {
                    urlsToGenerate.push({ s3Key: variant.webp.public_id, expiresIn: 3600 });
                    seenKeys.add(variant.webp.public_id);
                }
                if (variant?.jpeg?.public_id && !seenKeys.has(variant.jpeg.public_id)) {
                    urlsToGenerate.push({ s3Key: variant.jpeg.public_id, expiresIn: 3600 });
                    seenKeys.add(variant.jpeg.public_id);
                }
            });
        }
    });

    // Batch generate all URLs at once
    let urlCache = new Map<string, string>();
    if (urlsToGenerate.length > 0) {
        try {
            urlCache = await getCachedSignedUrlsBatch(urlsToGenerate);
            logger.debug(`Batch generated ${urlCache.size} signed URLs for ${mediaItems.length} media items`);
        } catch (error) {
            logger.error('Error in batch URL generation, falling back to individual generation:', error);
        }
    }

    // Transform each item using the cached URLs
    return Promise.all(mediaItems.map((item) => getMediaMetadataWithCache(item, urlCache)));
}

/**
 * Get media metadata for API response (single item)
 * For backward compatibility
 */
export async function getMediaMetadata(mediaItem: any): Promise<MediaMetadata> {
    return getMediaMetadataWithCache(mediaItem, new Map());
}

/**
 * Get responsive image URLs for a media item (single item)
 * For backward compatibility
 */
export async function getResponsiveImageUrls(
    mediaItem: any
): Promise<{
    thumbnail: string | null;
    display: string | null;
    full: string | null;
    original: string | null;
}> {
    return getResponsiveImageUrlsWithCache(mediaItem, new Map());
}
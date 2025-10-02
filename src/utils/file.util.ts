// utils/file.util.ts - Consolidated file and media utilities

import fs from 'fs/promises';
import { logger } from './logger';

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
        'video/x-msvideo', // .avi
        'video/webm',
        'video/x-ms-wmv'
    ];
    return validVideoTypes.includes(file.mimetype.toLowerCase());
}

/**
 * Clean up temporary file with error handling
 */
export async function cleanupFile(file: Express.Multer.File): Promise<void> {
    try {
        if (file?.path) {
            await fs.unlink(file.path);
            logger.debug(`🗑️ Cleaned up temp file: ${file.path}`);
        }
    } catch (error) {
        logger.warn(`Failed to cleanup file ${file.path}:`, error);
    }
}

/**
 * Calculate total size of variants in MB
 */
export function calculateTotalVariantsSize(variants: any): number {
    if (!variants) return 0;

    let total = 0;
    try {
        Object.values(variants).forEach((sizeVariants: any) => {
            if (sizeVariants && typeof sizeVariants === 'object') {
                Object.values(sizeVariants).forEach((formatVariant: any) => {
                    if (formatVariant && formatVariant.size_mb) {
                        total += formatVariant.size_mb;
                    }
                });
            }
        });
    } catch (error) {
        logger.warn('Error calculating variants size:', error);
    }
    return Math.round(total * 100) / 100;
}

/**
 * Calculate number of variants
 */
export function calculateVariantsCount(variants: any): number {
    if (!variants) return 0;

    let count = 0;
    try {
        Object.values(variants).forEach((sizeVariants: any) => {
            if (sizeVariants && typeof sizeVariants === 'object') {
                Object.keys(sizeVariants).forEach(() => {
                    count++;
                });
            }
        });
    } catch (error) {
        logger.warn('Error calculating variants count:', error);
    }
    return count;
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
 * Detect user context from User-Agent
 */
export function detectContextFromUserAgent(userAgent?: string): 'mobile' | 'desktop' | 'lightbox' {
    if (!userAgent) return 'desktop';

    const mobileRegex = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i;
    return mobileRegex.test(userAgent) ? 'mobile' : 'desktop';
}

/**
 * Detect WebP support from User-Agent
 */
export function supportsWebP(userAgent?: string): boolean {
    if (!userAgent) return true; // Default to true for modern browsers

    // WebP is supported by Chrome, Firefox, Edge, Opera, and Android browsers
    // But not by Safari on iOS/macOS (yet)
    return /Chrome|Firefox|Edge|Opera|Android/.test(userAgent) && !/Safari|iPhone|iPad/.test(userAgent);
}

/**
 * Get optimized image URL for a single media item (updated for your model structure)
 */
export function getOptimizedImageUrlForItem(
    mediaItem: any,
    quality: string = 'medium',
    format: string = 'auto',
    context: string = 'desktop',
    userAgent?: string
): string {
    // Fallback to original URL if no variants or not an image
    if (!mediaItem.image_variants || mediaItem.type !== 'image') {
        return mediaItem.url;
    }

    const variants = mediaItem.image_variants;

    // Map quality options for backward compatibility
    let targetVariant;
    switch (quality) {
        case 'thumbnail':
        case 'small':
            targetVariant = variants.small;
            break;
        case 'display':
        case 'medium':
            targetVariant = variants.medium;
            break;
        case 'full':
        case 'large':
            targetVariant = variants.large;
            break;
        case 'original':
            return variants.original?.url || mediaItem.url;
        default:
            // Smart selection based on context
            if (context === 'mobile') {
                targetVariant = variants.small;
            } else if (context === 'lightbox') {
                targetVariant = variants.large;
            } else {
                targetVariant = variants.medium;
            }
    }

    if (!targetVariant) {
        return mediaItem.url; // Fallback to original
    }

    // Format selection logic
    if (format === 'webp' && targetVariant.webp?.url) {
        return targetVariant.webp.url;
    } else if (format === 'jpeg' && targetVariant.jpeg?.url) {
        return targetVariant.jpeg.url;
    } else if (format === 'auto') {
        // Auto-detect WebP support from User-Agent
        const webpSupported = supportsWebP(userAgent);

        if (webpSupported && targetVariant.webp?.url) {
            return targetVariant.webp.url;
        } else if (targetVariant.jpeg?.url) {
            return targetVariant.jpeg.url;
        }
    }

    // Final fallback
    return targetVariant.jpeg?.url || targetVariant.webp?.url || mediaItem.url;
}

/**
 * Check if media item has variants available (updated for your model)
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
 * Media metadata interface for better type safety
 */
interface MediaMetadata {
    _id: any;
    type: any;
    url: any;
    optimized_url: any;
    has_variants: boolean;
    processing_status: any;
    approval_status: any;
    size_mb: any;
    original_filename: any;
    format: any;
    uploader_type: any;
    uploader_display_name: string;
    dimensions: {
        width: number;
        height: number;
        aspect_ratio: number;
    } | null;
    stats: any;
    created_at: any;
    updated_at: any;
    // Optional properties that might be added
    responsive_urls?: {
        thumbnail: string;
        medium: string;
        large: string;
        original: string;
        preferred: string;
    };
    available_variants?: {
        small: {
            webp: boolean;
            jpeg: boolean;
        };
        medium: {
            webp: boolean;
            jpeg: boolean;
        };
        large: {
            webp: boolean;
            jpeg: boolean;
        };
    };
    requested_optimized_url?: string;
}

/**
 * Get media metadata for response (updated for your model structure)
 */
export function getMediaMetadata(mediaItem: any, userAgent?: string): MediaMetadata {
    const hasVariants = hasImageVariants(mediaItem);

    return {
        _id: mediaItem._id,
        type: mediaItem.type,
        url: mediaItem.url, // Original URL
        optimized_url: hasVariants ?
            getOptimizedImageUrlForItem(mediaItem, 'medium', 'auto', 'desktop', userAgent) :
            mediaItem.url,
        has_variants: hasVariants,
        processing_status: mediaItem.processing?.status || 'unknown',
        approval_status: mediaItem.approval?.status || 'pending',
        size_mb: mediaItem.size_mb || 0,
        original_filename: mediaItem.original_filename || '',
        format: mediaItem.format || '',
        uploader_type: mediaItem.uploader_type || 'guest',
        uploader_display_name: getUploaderDisplayName(mediaItem),
        dimensions: mediaItem.metadata ? {
            width: mediaItem.metadata.width || 0,
            height: mediaItem.metadata.height || 0,
            aspect_ratio: mediaItem.metadata.aspect_ratio || 1
        } : null,
        stats: mediaItem.stats || { views: 0, downloads: 0, shares: 0, likes: 0 },
        created_at: mediaItem.created_at,
        updated_at: mediaItem.updated_at
    };
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
 * Get multiple optimized URLs for responsive images (updated for your model)
 */
export function getResponsiveImageUrls(
    mediaItem: any,
    userAgent?: string
): {
    thumbnail: string;
    medium: string;
    large: string;
    original: string;
    preferred: string;
} {
    const context = detectContextFromUserAgent(userAgent);

    return {
        thumbnail: getOptimizedImageUrlForItem(mediaItem, 'small', 'auto', 'mobile', userAgent),
        medium: getOptimizedImageUrlForItem(mediaItem, 'medium', 'auto', 'desktop', userAgent),
        large: getOptimizedImageUrlForItem(mediaItem, 'large', 'auto', 'lightbox', userAgent),
        original: mediaItem.url,
        preferred: getOptimizedImageUrlForItem(mediaItem, 'medium', 'auto', context, userAgent)
    };
}

/**
 * Transform media array for API response (updated for your model)
 */
export function transformMediaForResponse(
    mediaItems: any[],
    options: {
        quality?: string;
        format?: string;
        context?: string;
        includeVariants?: boolean;
    } = {},
    userAgent?: string
): any[] {
    return mediaItems.map(item => {
        const transformed: MediaMetadata = getMediaMetadata(item, userAgent);

        // Add variant information if requested
        if (options.includeVariants && hasImageVariants(item)) {
            transformed.responsive_urls = getResponsiveImageUrls(item, userAgent);
            transformed.available_variants = {
                small: {
                    webp: !!item.image_variants?.small?.webp?.url,
                    jpeg: !!item.image_variants?.small?.jpeg?.url
                },
                medium: {
                    webp: !!item.image_variants?.medium?.webp?.url,
                    jpeg: !!item.image_variants?.medium?.jpeg?.url
                },
                large: {
                    webp: !!item.image_variants?.large?.webp?.url,
                    jpeg: !!item.image_variants?.large?.jpeg?.url
                }
            };
        }

        // Add specific optimized URL if quality/format/context specified
        if (options.quality || options.format || options.context) {
            transformed.requested_optimized_url = getOptimizedImageUrlForItem(
                item,
                options.quality || 'medium',
                options.format || 'auto',
                options.context || 'desktop',
                userAgent
            );
        }

        return transformed;
    });
}

export const extractImageKitFileId = (url: string): string | null => {
    try {
        if (!url || !url.includes('imagekit.io')) {
            return null;
        }

        // Your ImageKit URL format: 
        // https://ik.imagekit.io/roseclick/events/{eventId}/originals/original_{mediaId}.jpg
        // We need everything after 'roseclick': events/{eventId}/originals/original_{mediaId}.jpg

        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(part => part !== '');

        // pathParts = ['roseclick', 'events', '68d2ac7c...', 'originals', 'original_68d2aca...jpg']
        // Remove 'roseclick' (your ImageKit ID) and join the rest
        if (pathParts.length > 1 && pathParts[0] === 'roseclick') {
            pathParts.shift(); // Remove 'roseclick'
            const filePath = pathParts.join('/');

            logger.debug('Extracted ImageKit file path:', {
                originalUrl: url,
                extractedPath: filePath
            });

            return filePath;
        }

        // Fallback: try regex approach
        const match = url.match(/imagekit\.io\/[^\/]+\/(.+)$/);
        if (match && match[1]) {
            logger.debug('Extracted ImageKit file path (regex):', {
                originalUrl: url,
                extractedPath: match[1]
            });
            return match[1];
        }

        logger.warn('Could not extract file path from URL:', url);
        return null;
    } catch (error) {
        logger.error('Failed to extract ImageKit file path:', error);
        return null;
    }
};

/**
 * NEW: Extract file directory from ImageKit URL
 * Useful for batch operations
 */
export const extractImageKitDirectory = (url: string): string | null => {
    const filePath = extractImageKitFileId(url);
    if (!filePath) return null;
    
    const parts = filePath.split('/');
    parts.pop(); // Remove filename
    return parts.join('/');
};

/**
 * NEW: Extract event ID from ImageKit URL
 */
export const extractEventIdFromImageKitUrl = (url: string): string | null => {
    const filePath = extractImageKitFileId(url);
    if (!filePath) return null;
    
    // Path format: events/{eventId}/originals/file.jpg
    const parts = filePath.split('/');
    if (parts.length >= 2 && parts[0] === 'events') {
        return parts[1];
    }
    
    return null;
};

/**
 * NEW: Validate ImageKit URL format
 */
export const isValidImageKitUrl = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.includes('imagekit.io');
    } catch {
        return false;
    }
};

/**
 * NEW: Get file type from ImageKit URL
 */
export const getFileTypeFromImageKitUrl = (url: string): 'original' | 'variant' | 'unknown' => {
    const filePath = extractImageKitFileId(url);
    if (!filePath) return 'unknown';
    
    if (filePath.includes('/originals/')) return 'original';
    if (filePath.includes('/variants/')) return 'variant';
    
    return 'unknown';
};

/**
 * NEW: Group URLs by event ID for batch processing
 */
export const groupUrlsByEvent = (urls: string[]): Map<string, string[]> => {
    const grouped = new Map<string, string[]>();
    
    urls.forEach(url => {
        const eventId = extractEventIdFromImageKitUrl(url);
        if (eventId) {
            if (!grouped.has(eventId)) {
                grouped.set(eventId, []);
            }
            grouped.get(eventId)!.push(url);
        } else {
            logger.warn('Could not extract event ID from URL:', url);
        }
    });
    
    return grouped;
};

/**
 * NEW: Validate and clean URLs before deletion
 */
export const validateAndCleanUrls = (urls: string[]): {
    validUrls: string[];
    invalidUrls: string[];
} => {
    const validUrls: string[] = [];
    const invalidUrls: string[] = [];
    
    urls.forEach(url => {
        if (isValidImageKitUrl(url)) {
            validUrls.push(url);
        } else {
            invalidUrls.push(url);
        }
    });
    
    if (invalidUrls.length > 0) {
        logger.warn(`Found ${invalidUrls.length} invalid ImageKit URLs`, {
            sample: invalidUrls.slice(0, 3)
        });
    }
    
    return { validUrls, invalidUrls };
};
/**
 * Legacy function name - keeping for backward compatibility
 * @deprecated Use extractImageKitFileId instead
 */
export const getImageKitFileId = extractImageKitFileId;
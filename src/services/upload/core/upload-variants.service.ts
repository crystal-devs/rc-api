// services/upload/core/upload-variants.service.ts - UPDATED with proper folder paths

import { uploadToImageKit } from './imagekit.service';
import type { ImageKitUploadOptions } from './imagekit.service';

/**
 * Upload original image with proper folder structure
 */
export const uploadOriginalImage = async (
    buffer: Buffer,
    mediaId: string,
    eventId: string,
    originalFormat: string = 'jpg',
    additionalTags: string[] = []
): Promise<string> => {
    const fileName = `original_${mediaId}.${originalFormat}`;

    return uploadToImageKit(buffer, {
        fileName,
        folder: '', // Will be overridden by imagekit.service.ts
        format: originalFormat,
        quality: 100,
        eventId,
        mediaId,
        variantType: 'original', // This determines the folder path
        tags: additionalTags
    });
};

/**
 * Upload variant image with proper folder structure
 */
export const uploadVariantImage = async (
    buffer: Buffer,
    mediaId: string,
    eventId: string,
    size: 'small' | 'medium' | 'large',
    format: 'webp' | 'jpeg',
    quality: number = 85,
    additionalTags: string[] = []
): Promise<string> => {
    const fileName = `${mediaId}_${size}.${format}`;

    return uploadToImageKit(buffer, {
        fileName,
        folder: '', // Will be overridden by imagekit.service.ts
        format,
        quality,
        eventId,
        mediaId,
        variantType: size, // This determines the folder path: events/{eventId}/variants/{size}
        tags: additionalTags
    });
};

/**
 * Upload preview image with proper folder structure
 */
export const uploadPreviewImage = async (
    buffer: Buffer,
    mediaId: string,
    eventId: string,
    additionalTags: string[] = []
): Promise<string> => {
    const fileName = `preview_${mediaId}.jpg`;

    return uploadToImageKit(buffer, {
        fileName,
        folder: '', // Will be overridden by imagekit.service.ts
        format: 'jpeg',
        quality: 85,
        eventId,
        mediaId,
        variantType: 'preview', // This determines the folder path: events/{eventId}/previews
        tags: additionalTags
    });
};

/**
 * Batch upload variants with proper folder structure
 */
export const uploadMultipleVariants = async (
    variants: Array<{
        buffer: Buffer;
        options: ImageKitUploadOptions;
    }>
): Promise<Array<{ success: boolean; url?: string; error?: string }>> => {
    const uploadPromises = variants.map(async ({ buffer, options }) => {
        try {
            const url = await uploadToImageKit(buffer, options);
            return { success: true, url };
        } catch (error: any) {
            return { 
                success: false, 
                error: error.message,
                fileName: options.fileName 
            };
        }
    });

    return await Promise.all(uploadPromises);
};
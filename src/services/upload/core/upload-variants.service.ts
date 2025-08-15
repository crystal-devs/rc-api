// 2. services/upload/core/upload-variants.service.ts (SHARED)
// ====================================

import { uploadToImageKit } from './imagekit.service';
import type { ImageKitUploadOptions } from './imagekit.service';

/**
 * 🚀 UPLOAD ORIGINAL IMAGE
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
        folder: '',
        format: originalFormat,
        quality: 100,
        eventId,
        mediaId,
        variantType: 'original',
        tags: additionalTags
    });
};

/**
 * 🚀 UPLOAD VARIANT IMAGE
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
        folder: '',
        format,
        quality,
        eventId,
        mediaId,
        variantType: size,
        tags: additionalTags
    });
};

/**
 * 🚀 UPLOAD PREVIEW IMAGE
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
        folder: '',
        format: 'jpeg',
        quality: 85,
        eventId,
        mediaId,
        variantType: 'preview',
        tags: additionalTags
    });
};

/**
 * 🚀 BATCH UPLOAD VARIANTS
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

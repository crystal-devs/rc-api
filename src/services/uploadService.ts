// services/uploadService.ts - Centralized upload service to avoid circular dependencies

import ImageKit from 'imagekit';
import { logger } from '@utils/logger';

// 🚀 IMAGEKIT SETUP
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});
/**
 * 🚀 CORE UPLOAD FUNCTION: Centralized ImageKit upload
 */
export async function uploadToImageKit(
    buffer: Buffer,
    options: {
        fileName: string;
        folder: string;
        format: string;
        quality: number;
        eventId?: string;
        mediaId?: string;
        variantType?: 'original' | 'small' | 'medium' | 'large' | 'preview';
    }
): Promise<string> {
    try {
        console.log(`📤 Uploading ${options.fileName} to ${options.folder}`);

        // 🔧 BUILD FOLDER PATH: events/[eventId]/variants/[size] or events/[eventId]/originals
        let folderPath: string;
        if (options.eventId) {
            switch (options.variantType) {
                case 'original':
                    folderPath = `/events/${options.eventId}/originals`;
                    break;
                case 'preview':
                    folderPath = `/events/${options.eventId}/previews`;
                    break;
                case 'small':
                case 'medium':
                case 'large':
                    folderPath = `/events/${options.eventId}/variants/${options.variantType}`;
                    break;
                default:
                    folderPath = options.folder;
            }
        } else {
            folderPath = options.folder;
        }

        // 🚀 IMAGEKIT UPLOAD
        const uploadResult = await imagekit.upload({
            file: buffer,
            fileName: options.fileName,
            folder: folderPath,
            useUniqueFileName: false,
            overwriteFile: true,
            tags: [
                options.variantType || 'unknown',
                options.format,
                options.eventId || 'no-event'
            ],
            transformation: {
                pre: 'q_auto,f_auto'
            }
        });

        console.log(`✅ Upload successful: ${uploadResult.url}`);
        return uploadResult.url;

    } catch (error: any) {
        console.error('❌ ImageKit upload failed:', error);
        throw new Error(`ImageKit upload failed: ${error.message}`);
    }
}

/**
 * 🚀 SPECIALIZED: Upload original image
 */
export async function uploadOriginalImage(
    buffer: Buffer,
    mediaId: string,
    eventId: string,
    originalFormat: string = 'jpg'
): Promise<string> {
    const fileName = `original_${mediaId}.${originalFormat}`;

    return uploadToImageKit(buffer, {
        fileName,
        folder: '', // Will be built from eventId
        format: originalFormat,
        quality: 100,
        eventId,
        mediaId,
        variantType: 'original'
    });
}

/**
 * 🚀 SPECIALIZED: Upload variant image
 */
export async function uploadVariantImage(
    buffer: Buffer,
    mediaId: string,
    eventId: string,
    size: 'small' | 'medium' | 'large',
    format: 'webp' | 'jpeg',
    quality: number = 85
): Promise<string> {
    const fileName = `${mediaId}_${size}.${format}`;

    return uploadToImageKit(buffer, {
        fileName,
        folder: '', // Will be built from eventId and size
        format,
        quality,
        eventId,
        mediaId,
        variantType: size
    });
}

/**
 * 🚀 SPECIALIZED: Upload preview image
 */
export async function uploadPreviewImage(
    buffer: Buffer,
    mediaId: string,
    eventId: string
): Promise<string> {
    const fileName = `preview_${mediaId}.jpg`;

    return uploadToImageKit(buffer, {
        fileName,
        folder: '', // Will be built from eventId
        format: 'jpeg',
        quality: 85,
        eventId,
        mediaId,
        variantType: 'preview'
    });
}
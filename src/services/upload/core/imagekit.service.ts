// 1. services/upload/core/imagekit.service.ts (SHARED CORE)
// ====================================

import ImageKit from 'imagekit';
import { logger } from '@utils/logger';

// ImageKit configuration
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

export interface ImageKitUploadOptions {
    fileName: string;
    folder: string;
    format: string;
    quality: number;
    eventId?: string;
    mediaId?: string;
    variantType?: 'original' | 'small' | 'medium' | 'large' | 'preview';
    tags?: string[];
}

export interface ImageKitUploadResult {
    url: string;
    fileId: string;
    size?: number;
}

/**
 * 🚀 CORE IMAGEKIT UPLOAD FUNCTION (SHARED)
 */
export const uploadToImageKit = async (
    buffer: Buffer,
    options: ImageKitUploadOptions
): Promise<string> => {
    try {
        logger.info(`📤 Uploading ${options.fileName}`, {
            folder: buildFolderPath(options),
            variant: options.variantType,
            size: `${(buffer.length / 1024 / 1024).toFixed(2)}MB`
        });

        const uploadResult = await imagekit.upload({
            file: buffer,
            fileName: options.fileName,
            folder: buildFolderPath(options),
            useUniqueFileName: false,
            overwriteFile: true,
            tags: buildUploadTags(options),
            transformation: {
                pre: 'q_auto,f_auto'
            }
        });

        logger.info(`✅ Upload successful: ${uploadResult.url}`);
        return uploadResult.url;

    } catch (error: any) {
        logger.error('❌ ImageKit upload failed:', error);
        throw new Error(`ImageKit upload failed: ${error.message}`);
    }
};

/**
 * 🔧 BUILD FOLDER PATH
 */
const buildFolderPath = (options: ImageKitUploadOptions): string => {
    if (!options.eventId) {
        return options.folder;
    }

    switch (options.variantType) {
        case 'original':
            return `/events/${options.eventId}/originals`;
        case 'preview':
            return `/events/${options.eventId}/previews`;
        case 'small':
        case 'medium':
        case 'large':
            return `/events/${options.eventId}/variants/${options.variantType}`;
        default:
            return options.folder;
    }
};

/**
 * 🔧 BUILD UPLOAD TAGS
 */
const buildUploadTags = (options: ImageKitUploadOptions): string[] => {
    const baseTags = [
        options.variantType || 'unknown',
        options.format,
        options.eventId || 'no-event'
    ];
    
    return [...baseTags, ...(options.tags || [])];
};
// 3. services/upload/image-processing.service.ts (SHARED)
// ====================================

import sharp from 'sharp';
import { logger } from '@utils/logger';
import { ImageMetadata } from '@services/guest';
import { uploadPreviewImage } from '../core/upload-variants.service';

export const createInstantPreview = async (
    file: Express.Multer.File,
    mediaId: string,
    eventId: string
): Promise<string> => {
    try {
        const previewBuffer = await sharp(file.path)
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({
                quality: 85,
                progressive: true
            })
            .toBuffer();

        const previewUrl = await uploadPreviewImage(previewBuffer, mediaId, eventId);
        logger.info(`✅ Preview created: ${mediaId} -> ${previewUrl}`);
        return previewUrl;

    } catch (error) {
        logger.error('Preview creation failed:', error);
        return '/placeholder-image.jpg';
    }
};

export const getBasicImageMetadata = async (filePath: string): Promise<ImageMetadata> => {
    try {
        const metadata = await sharp(filePath).metadata();
        return {
            width: metadata.width || 0,
            height: metadata.height || 0,
            aspect_ratio: metadata.height && metadata.width ? metadata.height / metadata.width : 1
        };
    } catch (error) {
        logger.warn('Failed to get image metadata:', error);
        return { width: 0, height: 0, aspect_ratio: 1 };
    }
};

export const calculateTotalVariantsSize = (variants: any): number => {
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
};

export const getFileExtension = (file: Express.Multer.File): string => {
    return file.mimetype.split('/')[1] || 'jpg';
};

export const getEstimatedProcessingTime = (fileSizeBytes: number): string => {
    const sizeMB = fileSizeBytes / (1024 * 1024);
    const seconds = Math.max(5, Math.min(sizeMB * 2, 30));
    return `${Math.round(seconds)}s`;
};

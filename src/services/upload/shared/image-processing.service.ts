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
    let sharpInstance: sharp.Sharp | null = null;
    try {
        // 🛡️ MEMORY PROTECTION: Check memory pressure before preview creation
        if (checkMemoryPressure()) {
            logger.warn('High memory pressure detected during preview creation, using lower quality');
        }

        // 🚀 SHARP PIPELINE: Optimized settings with memory protection
        sharpInstance = sharp(file.path, {
            sequentialRead: true,
            limitInputPixels: 268402689  // 🛡️ 16MP limit (268M pixels) - prevents OOM
        })
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true,
                kernel: sharp.kernel.lanczos3  // Better quality
            })
            .jpeg({
                quality: checkMemoryPressure() ? 75 : 85, // Lower quality under memory pressure
                progressive: true,
                mozjpeg: true,
                optimizeScans: true
            });

        const previewBuffer = await sharpInstance.toBuffer();
        
        // 🧹 CLEANUP: Destroy Sharp instance immediately after processing
        sharpInstance.destroy();
        sharpInstance = null;

        const previewUrl = await uploadPreviewImage(previewBuffer, mediaId, eventId);
        logger.info(`✅ Preview created: ${mediaId} -> ${previewUrl}`);
        return previewUrl;

    } catch (error) {
        logger.error('Preview creation failed:', error);
        return '/placeholder-image.jpg';
    } finally {
        // 🧹 CLEANUP: Ensure Sharp instance is always destroyed
        if (sharpInstance) {
            try {
                sharpInstance.destroy();
            } catch (cleanupError) {
                logger.warn('Error destroying Sharp instance in preview creation:', cleanupError);
            }
        }
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

/**
 * 🛡️ MEMORY MONITORING: Check if system is under memory pressure
 */
function checkMemoryPressure(): boolean {
    try {
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
        const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
        const rssMB = memUsage.rss / 1024 / 1024;

        // Check multiple memory pressure indicators
        const heapPressure = heapUsedMB > 1536; // 1.5GB heap used
        const rssPressure = rssMB > 2048; // 2GB RSS
        const heapRatioPressure = (heapUsedMB / heapTotalMB) > 0.85; // 85% heap utilization

        const isUnderPressure = heapPressure || rssPressure || heapRatioPressure;

        if (isUnderPressure) {
            logger.warn('Memory pressure detected in shared service:', {
                heapUsedMB: Math.round(heapUsedMB),
                heapTotalMB: Math.round(heapTotalMB),
                rssMB: Math.round(rssMB),
                heapRatio: Math.round((heapUsedMB / heapTotalMB) * 100) + '%'
            });
        }

        return isUnderPressure;
    } catch (error) {
        logger.warn('Failed to check memory pressure in shared service:', error);
        return false; // Default to no pressure if check fails
    }
}

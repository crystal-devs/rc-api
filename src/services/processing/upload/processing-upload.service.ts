// 4. services/processing/upload/processing-upload.service.ts
// ====================================

import ImageKit from 'imagekit';
import path from 'path';
import { logger } from '@utils/logger';
import type { ImageProcessingJobData, ProcessedImageVariant } from '../processing.types';

// 🚀 IMAGEKIT: Reuse connection
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

export class ProcessingUploadService {
    /**
     * 🚀 UPLOAD ORIGINAL: Optimized original upload
     */
    async uploadOriginal(
        buffer: Buffer,
        jobData: ImageProcessingJobData
    ): Promise<{ url: string; size: number }> {
        try {
            const fileName = `${jobData.mediaId}_original${path.extname(jobData.originalFilename)}`;

            const result = await imagekit.upload({
                file: buffer,
                fileName,
                folder: `/events/${jobData.eventId}/originals`,
                useUniqueFileName: false,
                tags: ['original', jobData.eventId, jobData.isGuestUpload ? 'guest' : 'admin'],
                transformation: {
                    pre: 'q_90,f_auto'
                }
            });

            logger.debug(`✅ Uploaded original: ${fileName} (${this.bytesToMB(buffer.length)}MB)`);

            return { url: result.url, size: buffer.length };
        } catch (error) {
            logger.error('❌ Failed to upload original:', error);
            throw error;
        }
    }

    /**
     * 🚀 UPLOAD VARIANT: Upload processed variant
     */
    async uploadVariant(
        buffer: Buffer,
        variant: ProcessedImageVariant & { name: string },
        eventId: string,
        mediaId: string,
        isGuestUpload: boolean = false
    ): Promise<string> {
        try {
            const fileName = `${mediaId}_${variant.name}.${variant.format}`;

            const result = await imagekit.upload({
                file: buffer,
                fileName,
                folder: `/events/${eventId}/variants`,
                useUniqueFileName: false,
                tags: [variant.name, variant.format, eventId, isGuestUpload ? 'guest' : 'admin'],
                transformation: {
                    pre: 'q_auto,f_auto'
                }
            });

            logger.debug(`✅ Uploaded variant: ${fileName}`);
            return result.url;
        } catch (error) {
            logger.error(`❌ Failed to upload variant ${variant.name}-${variant.format}:`, error);
            throw error;
        }
    }

    /**
     * 🚀 BATCH UPLOAD: Upload all variants in parallel
     */
    async uploadAllVariants(
        processedVariants: (ProcessedImageVariant & { name: string; buffer: Buffer })[],
        eventId: string,
        mediaId: string,
        isGuestUpload: boolean = false
    ): Promise<(ProcessedImageVariant & { name: string })[]> {
        try {
            const uploadPromises = processedVariants.map(async (variant) => {
                const url = await this.uploadVariant(
                    variant.buffer,
                    variant,
                    eventId,
                    mediaId,
                    isGuestUpload
                );

                // Remove buffer and add URL
                const { buffer, ...variantWithoutBuffer } = variant;
                return {
                    ...variantWithoutBuffer,
                    url
                };
            });

            const results = await Promise.all(uploadPromises);
            logger.debug(`✅ Uploaded ${results.length} variants in parallel`);

            return results;
        } catch (error) {
            logger.error('❌ Failed to upload variants:', error);
            throw error;
        }
    }

    /**
     * 🛠️ UTILITY: Convert bytes to MB
     */
    private bytesToMB(bytes: number): number {
        return Math.round((bytes / (1024 * 1024)) * 100) / 100;
    }
}

// Singleton instance
export const processingUploadService = new ProcessingUploadService();
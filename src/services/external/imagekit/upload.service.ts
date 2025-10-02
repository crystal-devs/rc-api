// ====================================
// 1. services/external/imagekit/upload.service.ts
// ====================================

import { imagekit } from '@configs/imagekit.config';
import { logger } from '@utils/logger';
import type { ProcessedImageVariant } from '@services/processing/processing.types';

interface ImageKitUploadResult {
    url: string;
    fileId: string;
    size?: number;
}

class ImageKitUploadServiceClass {
    /**
     * Upload optimistic preview (low quality) to ImageKit
     */
    async uploadOptimisticPreview(
        buffer: Buffer,
        mediaId: string,
        eventId: string,
        originalFilename: string
    ): Promise<ImageKitUploadResult> {
        try {
            const result = await imagekit.upload({
                file: buffer,
                fileName: `${mediaId}_preview_${originalFilename}`,
                folder: `/events/${eventId}/temp`,
                useUniqueFileName: false,
                tags: ['optimistic', 'preview', eventId],
                transformation: {
                    pre: 'q_60,w_800,h_800,c_limit,f_auto'
                }
            });

            logger.debug(`✅ Uploaded optimistic preview: ${result?.url || ''}`);
            return { url: result.url, fileId: result.fileId };
        } catch (error) {
            logger.error('❌ Failed to upload optimistic preview:', error);
            throw error;
        }
    }

    /**
     * Upload original image to ImageKit
     */
    async uploadOriginal(
        buffer: Buffer,
        jobData: any
    ): Promise<ImageKitUploadResult> {
        try {
            const fileName = `${jobData.mediaId}_original.${jobData.format || 'jpg'}`;

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
            return {
                url: result.url,
                fileId: result.fileId,
                size: buffer.length
            };
        } catch (error) {
            logger.error('❌ Failed to upload original:', error);
            throw error;
        }
    }

    /**
     * Upload single variant to ImageKit with proper folder structure
     */
    async uploadVariant(
        buffer: Buffer,
        variant: ProcessedImageVariant & { name: string },
        eventId: string,
        mediaId: string,
        isGuestUpload: boolean = false
    ): Promise<ImageKitUploadResult> {
        try {
            const fileName = `${mediaId}_${variant.name}.${variant.format}`;

            // FIX: Use proper folder structure - variants/size/
            const folder = `/events/${eventId}/variants/${variant.name}`;

            const result = await imagekit.upload({
                file: buffer,
                fileName,
                folder,
                useUniqueFileName: false,
                tags: [variant.name, variant.format, eventId, isGuestUpload ? 'guest' : 'admin'],
                transformation: {
                    pre: 'f_auto'
                }
            });

            logger.debug(`✅ Uploaded variant: ${fileName} to ${folder}`);
            return { url: result.url, fileId: result.fileId };
        } catch (error) {
            logger.error(`❌ Failed to upload variant ${variant.name}-${variant.format}:`, error);
            throw error;
        }
    }

    /**
     * Upload all variants in parallel with proper folder structure
     */
    async uploadAllVariants(
        processedVariants: (ProcessedImageVariant & { name: string; buffer: Buffer })[],
        eventId: string,
        mediaId: string,
        isGuestUpload: boolean = false
    ): Promise<(ProcessedImageVariant & { name: string; fileId?: string })[]> {
        try {
            const uploadPromises = processedVariants.map(async (variant) => {
                const { url, fileId } = await this.uploadVariant(
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
                    url,
                    fileId
                };
            });

            const results = await Promise.all(uploadPromises);
            logger.debug(`✅ Uploaded ${results.length} variants to ImageKit`);
            return results;
        } catch (error) {
            logger.error('❌ Failed to upload variants:', error);
            throw error;
        }
    }

    /**
     * Delete file from ImageKit
     */
    async deleteFile(fileId: string): Promise<void> {
        try {
            await imagekit.deleteFile(fileId);
            logger.debug(`🗑️ Deleted ImageKit file: ${fileId}`);
        } catch (error) {
            logger.warn(`Failed to delete ImageKit file ${fileId}:`, error);
        }
    }

    /**
     * Delete multiple files from ImageKit
     */
    async deleteFiles(fileIds: string[]): Promise<void> {
        const deletePromises = fileIds.map(fileId => this.deleteFile(fileId));
        await Promise.all(deletePromises);
    }

    /**
     * Utility: Convert bytes to MB
     */
    private bytesToMB(bytes: number): number {
        return Math.round((bytes / (1024 * 1024)) * 100) / 100;
    }
}

// Export singleton instance
export const ImageKitUploadService = new ImageKitUploadServiceClass();
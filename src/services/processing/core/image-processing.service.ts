// 6. services/processing/core/image-processing.service.ts - MAIN SERVICE
// ====================================

import fs from 'fs/promises';
import { logger } from '@utils/logger';

// Import our modular services
import { variantConfigService } from '../config/variant-config.service';
import { imageOptimizerService } from './image-optimizer.service';
import { processingUploadService } from '../upload/processing-upload.service';
import { variantOrganizerService } from '../organizer/variant-organizer.service';

import type { 
    ImageProcessingJobData, 
    ImageProcessingResult 
} from '../processing.types';

export class ImageProcessingService {
    /**
     * 🚀 MAIN PROCESSING METHOD: Complete image processing pipeline
     */
    async processImage(jobData: ImageProcessingJobData): Promise<ImageProcessingResult> {
        const { mediaId, eventId, filePath, originalFilename, isGuestUpload = false } = jobData;
        const startTime = Date.now();

        try {
            logger.info(`🔄 Processing: ${originalFilename}`, {
                mediaId: mediaId.substring(0, 8) + '...',
                isGuestUpload
            });

            // 🚀 STEP 1: Read and validate file
            const fileBuffer = await fs.readFile(filePath);
            const metadata = await imageOptimizerService.getImageMetadata(fileBuffer);

            logger.debug(`📐 Image dimensions: ${metadata.width}x${metadata.height}`);

            // 🚀 STEP 2: Process variants and upload original in parallel
            const [originalResult, processedVariants] = await Promise.all([
                processingUploadService.uploadOriginal(fileBuffer, jobData),
                this.processAndUploadVariants(fileBuffer, metadata, eventId, mediaId, isGuestUpload)
            ]);

            // 🚀 STEP 3: Organize results to match schema
            const organizedVariants = variantOrganizerService.organizeVariantsForSchema(processedVariants);

            const processingTime = Date.now() - startTime;
            logger.info(`✅ Processing completed: ${originalFilename} in ${processingTime}ms`);

            return {
                mediaId,
                original: {
                    url: originalResult.url,
                    width: metadata.width,
                    height: metadata.height,
                    size_mb: this.bytesToMB(originalResult.size),
                    format: metadata.format || 'jpeg'
                },
                variants: organizedVariants
            };

        } finally {
            // 🧹 CLEANUP: Remove temp file
            await this.cleanupTempFile(filePath);
        }
    }

    /**
     * 🚀 PROCESS AND UPLOAD: Handle variant processing and uploading
     */
    private async processAndUploadVariants(
        fileBuffer: Buffer,
        metadata: any,
        eventId: string,
        mediaId: string,
        isGuestUpload: boolean
    ) {
        // Get all variant configurations
        const variants = variantConfigService.variants;

        // Process all variants
        const processedVariants = await imageOptimizerService.processAllVariants(
            fileBuffer,
            variants,
            metadata
        );

        // Upload all variants
        const uploadedVariants = await processingUploadService.uploadAllVariants(
            processedVariants,
            eventId,
            mediaId,
            isGuestUpload
        );

        return uploadedVariants;
    }

    /**
     * 🧹 CLEANUP: Remove temporary file
     */
    private async cleanupTempFile(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
            logger.debug(`🗑️ Cleaned up temp file: ${filePath}`);
        } catch (error) {
            logger.warn(`Failed to cleanup file ${filePath}:`, error);
        }
    }

    /**
     * 🛠️ UTILITY: Convert bytes to MB
     */
    private bytesToMB(bytes: number): number {
        return Math.round((bytes / (1024 * 1024)) * 100) / 100;
    }

    /**
     * 🔧 VALIDATION: Check if file format is supported
     */
    isValidImageFormat(file: Express.Multer.File): boolean {
        return variantConfigService.isValidImageFormat(file);
    }

    /**
     * 🔧 ESTIMATION: Get processing time estimate
     */
    getEstimatedProcessingTime(fileSizeBytes: number): number {
        return variantConfigService.getEstimatedProcessingTime(fileSizeBytes);
    }
}

// Singleton instance
export const imageProcessingService = new ImageProcessingService();
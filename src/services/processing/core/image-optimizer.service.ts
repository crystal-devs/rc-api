// ====================================
// 3. services/processing/core/image-optimizer.service.ts
// ====================================

import sharp from 'sharp';
import { logger } from '@utils/logger';
import type { VariantConfig, ProcessedImageVariant, ImageMetadata } from '../processing.types';

export class ImageOptimizerService {
    /**
     * 🚀 OPTIMIZED: Single variant processing with Sharp
     */
    async processVariant(
        originalBuffer: Buffer,
        variant: VariantConfig,
        originalMetadata: ImageMetadata
    ): Promise<ProcessedImageVariant & { name: string }> {
        try {
            const aspectRatio = originalMetadata.height / originalMetadata.width;
            const targetHeight = Math.round(variant.width * aspectRatio);

            // 🚀 SHARP PIPELINE: Optimized settings
            let sharpInstance = sharp(originalBuffer, {
                sequentialRead: true,
                limitInputPixels: false
            })
                .resize(variant.width, targetHeight, {
                    fit: 'inside',
                    withoutEnlargement: true,
                    kernel: sharp.kernel.lanczos3
                });

            // 🔧 FORMAT-SPECIFIC OPTIMIZATIONS
            if (variant.format === 'webp') {
                sharpInstance = sharpInstance.webp({
                    quality: variant.quality,
                    effort: 4,
                    smartSubsample: true,
                    nearLossless: false
                });
            } else {
                sharpInstance = sharpInstance.jpeg({
                    quality: variant.quality,
                    progressive: true,
                    mozjpeg: true,
                    optimizeScans: true
                });
            }

            // 🚀 PROCESS: Convert to buffer
            const processedBuffer = await sharpInstance.toBuffer();
            const processedMetadata = await sharp(processedBuffer).metadata();

            logger.debug(`✅ Processed variant: ${variant.name}-${variant.format} (${this.bytesToMB(processedBuffer.length)}MB)`);

            return {
                name: variant.name,
                url: '', // Will be set after upload
                width: processedMetadata.width!,
                height: processedMetadata.height!,
                size_mb: this.bytesToMB(processedBuffer.length),
                format: variant.format,
                buffer: processedBuffer // Temporary field for upload
            } as any;

        } catch (error) {
            logger.error(`❌ Failed to process variant ${variant.name}-${variant.format}:`, error);
            throw error;
        }
    }

    /**
     * 🚀 PARALLEL: Process all variants simultaneously
     */
    async processAllVariants(
        originalBuffer: Buffer,
        variants: VariantConfig[],
        originalMetadata: ImageMetadata
    ): Promise<(ProcessedImageVariant & { name: string; buffer: Buffer })[]> {
        try {
            // 🚀 PARALLEL: Process all variants at once
            const variantPromises = variants.map(variant =>
                this.processVariant(originalBuffer, variant, originalMetadata)
            );

            const results = await Promise.all(variantPromises);
            logger.debug(`✅ Processed ${results.length} variants in parallel`);

            return results as any;
        } catch (error) {
            logger.error('❌ Failed to process variants:', error);
            throw error;
        }
    }

    /**
     * 🚀 METADATA: Extract image metadata using Sharp
     */
    async getImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
        try {
            const metadata = await sharp(buffer).metadata();

            if (!metadata.width || !metadata.height) {
                throw new Error('Invalid image: Could not read dimensions');
            }

            return {
                width: metadata.width,
                height: metadata.height,
                format: metadata.format || 'jpeg',
                size: buffer.length
            };
        } catch (error) {
            logger.error('❌ Failed to extract metadata:', error);
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
export const imageOptimizerService = new ImageOptimizerService();
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
        let sharpInstance: sharp.Sharp | null = null;
        try {
            // 🛡️ MEMORY PROTECTION: Check memory pressure before processing
            if (this.checkMemoryPressure()) {
                logger.warn('High memory pressure detected, delaying processing');
                await this.waitForMemoryRelief();
            }

            const aspectRatio = originalMetadata.height / originalMetadata.width;
            const targetHeight = Math.round(variant.width * aspectRatio);

            // 🚀 SHARP PIPELINE: Optimized settings with memory protection
            sharpInstance = sharp(originalBuffer, {
                sequentialRead: true,
                limitInputPixels: 268402689  // 🛡️ 16MP limit (268M pixels) - prevents OOM
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
            
            // 🧹 CLEANUP: Destroy Sharp instance immediately after processing
            sharpInstance.destroy();
            sharpInstance = null;

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
        } finally {
            // 🧹 CLEANUP: Ensure Sharp instance is always destroyed
            if (sharpInstance) {
                try {
                    sharpInstance.destroy();
                } catch (cleanupError) {
                    logger.warn('Error destroying Sharp instance:', cleanupError);
                }
            }
        }
    }

    /**
     * 🚀 BATCH PROCESSING: Process variants in batches to reduce memory pressure
     */
    async processAllVariants(
        originalBuffer: Buffer,
        variants: VariantConfig[],
        originalMetadata: ImageMetadata
    ): Promise<(ProcessedImageVariant & { name: string; buffer: Buffer })[]> {
        try {
            // 🛡️ MEMORY PROTECTION: Check memory pressure before batch processing
            if (this.checkMemoryPressure()) {
                logger.warn('High memory pressure detected before batch processing, using smaller batches');
            }

            const batchSize = this.checkMemoryPressure() ? 2 : 3; // Smaller batches under memory pressure
            const results: (ProcessedImageVariant & { name: string; buffer: Buffer })[] = [];

            // 🔄 BATCH PROCESSING: Process variants in smaller batches
            for (let i = 0; i < variants.length; i += batchSize) {
                const batch = variants.slice(i, i + batchSize);
                
                logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(variants.length / batchSize)} (${batch.length} variants)`);

                // Process batch in parallel
                const batchPromises = batch.map(variant =>
                    this.processVariant(originalBuffer, variant, originalMetadata)
                );

                const batchResults = await Promise.all(batchPromises);
                results.push(...(batchResults as any));

                // 🧹 MEMORY CLEANUP: Force garbage collection between batches if available
                if (global.gc && i + batchSize < variants.length) {
                    global.gc();
                    logger.debug('Forced garbage collection between batches');
                }

                // Small delay between batches to allow memory cleanup
                if (i + batchSize < variants.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            logger.debug(`✅ Processed ${results.length} variants in ${Math.ceil(variants.length / batchSize)} batches`);
            return results as any;

        } catch (error) {
            logger.error('❌ Failed to process variants in batches:', error);
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

    /**
     * 🛡️ MEMORY MONITORING: Check if system is under memory pressure
     */
    private checkMemoryPressure(): boolean {
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
                logger.warn('Memory pressure detected:', {
                    heapUsedMB: Math.round(heapUsedMB),
                    heapTotalMB: Math.round(heapTotalMB),
                    rssMB: Math.round(rssMB),
                    heapRatio: Math.round((heapUsedMB / heapTotalMB) * 100) + '%'
                });
            }

            return isUnderPressure;
        } catch (error) {
            logger.warn('Failed to check memory pressure:', error);
            return false; // Default to no pressure if check fails
        }
    }

    /**
     * ⏳ MEMORY RELIEF: Wait for memory pressure to reduce
     */
    private async waitForMemoryRelief(): Promise<void> {
        const maxWaitTime = 5000; // 5 seconds max wait
        const checkInterval = 500; // Check every 500ms
        let waitTime = 0;

        while (this.checkMemoryPressure() && waitTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waitTime += checkInterval;

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
        }

        if (waitTime >= maxWaitTime) {
            logger.warn('Memory pressure timeout reached, proceeding with processing');
        } else {
            logger.info(`Memory pressure relieved after ${waitTime}ms`);
        }
    }
}

// Singleton instance
export const imageOptimizerService = new ImageOptimizerService();
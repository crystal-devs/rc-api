// 2. services/processing/config/variant-config.service.ts
// ====================================

import type { VariantConfig } from '../processing.types';

export class VariantConfigService {
    // 🔧 SCHEMA COMPATIBLE: Match your database structure (small/medium/large)
    public readonly variants: VariantConfig[] = [
        // Small variants (thumbnails)
        { name: 'small', width: 400, quality: 70, format: 'webp' },
        { name: 'small', width: 400, quality: 75, format: 'jpeg' },

        // Medium variants (display)
        { name: 'medium', width: 800, quality: 80, format: 'webp' },
        { name: 'medium', width: 800, quality: 85, format: 'jpeg' },

        // Large variants (full size)
        { name: 'large', width: 1600, quality: 85, format: 'webp' },
        { name: 'large', width: 1600, quality: 90, format: 'jpeg' },
    ];

    /**
     * Get variants by size
     */
    getVariantsBySize(size: 'small' | 'medium' | 'large'): VariantConfig[] {
        return this.variants.filter(v => v.name === size);
    }

    /**
     * Get all variant names
     */
    getAllSizes(): ('small' | 'medium' | 'large')[] {
        return ['small', 'medium', 'large'];
    }

    /**
     * Get variant config by name and format
     */
    getVariantConfig(size: 'small' | 'medium' | 'large', format: 'webp' | 'jpeg'): VariantConfig | null {
        return this.variants.find(v => v.name === size && v.format === format) || null;
    }

    /**
     * Validate if format is supported
     */
    isValidImageFormat(file: Express.Multer.File): boolean {
        const supportedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
            'image/heic', 'image/heif', 'image/tiff', 'image/tif'
        ];
        return supportedMimeTypes.includes(file.mimetype.toLowerCase());
    }

    /**
     * Estimate processing time based on file size
     */
    getEstimatedProcessingTime(fileSizeBytes: number): number {
        const sizeMB = fileSizeBytes / (1024 * 1024);
        return Math.max(3, Math.min(sizeMB * 1.2, 20)); // 3-20 seconds
    }
}

// Singleton instance
export const variantConfigService = new VariantConfigService();
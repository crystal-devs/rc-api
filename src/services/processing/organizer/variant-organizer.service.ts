// ====================================
// 5. services/processing/organizer/variant-organizer.service.ts
// ====================================

import { logger } from '@utils/logger';
import type { ProcessedImageVariant } from '../processing.types';

export class VariantOrganizerService {
    /**
     * 🚀 ORGANIZE: Convert processed variants to schema structure
     */
    organizeVariantsForSchema(variants: (ProcessedImageVariant & { name: string })[]) {
        const organized = {
            small: { webp: null as ProcessedImageVariant | null, jpeg: null as ProcessedImageVariant | null },
            medium: { webp: null as ProcessedImageVariant | null, jpeg: null as ProcessedImageVariant | null },
            large: { webp: null as ProcessedImageVariant | null, jpeg: null as ProcessedImageVariant | null }
        };

        variants.forEach(variant => {
            const { name, ...variantData } = variant;

            if ((name === 'small' || name === 'medium' || name === 'large') &&
                (variantData.format === 'webp' || variantData.format === 'jpeg')) {
                organized[name][variantData.format] = variantData;
            }
        });

        // 🔧 VALIDATION: Ensure all variants exist
        this.validateOrganizedVariants(organized);

        return organized;
    }

    /**
     * 🔧 VALIDATION: Check if all expected variants are present
     */
    private validateOrganizedVariants(organized: any): void {
        const sizeNames: Array<keyof typeof organized> = ['small', 'medium', 'large'];
        
        for (const sizeName of sizeNames) {
            const formats = organized[sizeName];
            if (!formats.webp || !formats.jpeg) {
                logger.warn(`⚠️ Missing variant: ${sizeName.toString()} - some formats may be incomplete`);
            }
        }
    }

    /**
     * 📊 CALCULATE: Count total variants
     */
    calculateVariantsCount(variants: any): number {
        if (!variants || typeof variants !== 'object') return 0;

        let count = 0;
        for (const size of ['small', 'medium', 'large']) {
            if (variants[size]) {
                if (variants[size].webp) count++;
                if (variants[size].jpeg) count++;
            }
        }
        return count;
    }

    /**
     * 📊 CALCULATE: Total size of all variants
     */
    calculateTotalVariantsSize(variants: any): number {
        if (!variants || typeof variants !== 'object') return 0;

        let total = 0;
        for (const size of ['small', 'medium', 'large']) {
            if (variants[size]) {
                if (variants[size].webp?.size_mb) total += variants[size].webp.size_mb;
                if (variants[size].jpeg?.size_mb) total += variants[size].jpeg.size_mb;
            }
        }
        return Math.round(total * 100) / 100;
    }
}

// Singleton instance
export const variantOrganizerService = new VariantOrganizerService();
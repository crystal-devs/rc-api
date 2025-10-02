// ====================================
// 7. services/processing/index.ts - UNIFIED EXPORT
// ====================================

import { variantOrganizerService } from '../organizer/variant-organizer.service';

// Main processing service

// Individual services for advanced usage
export { variantConfigService } from '../config/variant-config.service';
export { imageOptimizerService } from '../core/image-optimizer.service';
export { variantOrganizerService } from '../organizer/variant-organizer.service';

// Export types
export type {
    ImageProcessingJobData,
    ImageProcessingResult,
    ProcessedImageVariant,
    VariantConfig,
    ImageMetadata
} from '../processing.types.ts';

// Utility functions (backwards compatibility)
export const calculateVariantsCount = variantOrganizerService.calculateVariantsCount.bind(variantOrganizerService);
export const calculateTotalVariantsSize = variantOrganizerService.calculateTotalVariantsSize.bind(variantOrganizerService);

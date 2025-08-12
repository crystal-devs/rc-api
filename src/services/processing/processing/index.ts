// ====================================
// 7. services/processing/index.ts - UNIFIED EXPORT
// ====================================

import { imageProcessingService } from '../core/image-processing.service';
import { variantOrganizerService } from '../organizer/variant-organizer.service';

// Main processing service
export { imageProcessingService } from '../core/image-processing.service';

// Individual services for advanced usage
export { variantConfigService } from '../config/variant-config.service';
export { imageOptimizerService } from '../core/image-optimizer.service';
export { processingUploadService } from '../upload/processing-upload.service';
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

// Convenience exports
export const processImage = imageProcessingService.processImage.bind(imageProcessingService);
export const isValidImageFormat = imageProcessingService.isValidImageFormat.bind(imageProcessingService);
export const getEstimatedProcessingTime = imageProcessingService.getEstimatedProcessingTime.bind(imageProcessingService);
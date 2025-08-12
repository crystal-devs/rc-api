// 7. services/guest/index.ts - UNIFIED EXPORT
// ====================================

import { getGuestUploadStats } from './guest-stats.service';
import { validateGuestUploadPermission } from './guest-validation.service';

// Re-export all guest services
export { uploadGuestMedia } from './guest-upload.service';
export { 
    validateGuestUploadPermission, 
    validateGuestFile, 
    validateShareToken 
} from './guest-validation.service';
export { getGuestUploadStats } from './guest-stats.service';

// Re-export shared upload services
export { 
    createInstantPreview, 
    getBasicImageMetadata, 
    calculateTotalVariantsSize,
    getFileExtension,
    getEstimatedProcessingTime
} from '../upload/image-processing.service';
export { queueImageProcessing } from '../upload/shared/queue-processing.service';

// Export types
export type {
    GuestUploadResult,
    GuestUploadInfo,
    GuestUploadPermission,
    GuestUploadStats,
    ImageMetadata,
    ProcessingJobData
} from './guest.types';

// Convenience exports for common use cases
export const checkGuestUploadPermission = validateGuestUploadPermission;
export const getGuestStats = getGuestUploadStats;
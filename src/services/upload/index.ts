// 8. services/upload/index.ts - SHARED UPLOAD UTILITIES
// ====================================

// Re-export shared upload services that can be used by both admin and guest uploads
// export { 
//     createInstantPreview, 
//     getBasicImageMetadata, 
//     calculateTotalVariantsSize,
//     getFileExtension,
//     getEstimatedProcessingTime
// } from './image-processing.service';

export { queueImageProcessing } from './shared/queue-processing.service';

// Original upload service exports
// export { 
//     uploadToImageKit,
//     uploadOriginalImage,
//     uploadVariantImage,
//     uploadPreviewImage
// } from '@services/uploadService';
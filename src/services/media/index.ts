// 5. services/media/index.ts - UNIFIED EXPORT
// ====================================

// Re-export all media services
export { 
    getMediaByEventService, 
    getMediaByAlbumService, 
    getGuestMediaService 
} from './media-query.service';

export { 
    updateMediaStatusService, 
    bulkUpdateMediaStatusService, 
    deleteMediaService 
} from './media-management.service';

export { 
    uploadCoverImageService 
} from './media-upload.service';

export { mediaProcessingService } from './media-processing.service';

// Export types
export type {
    ServiceResponse,
    MediaQueryOptions,
    StatusUpdateOptions,
    MediaItem
} from './media.types';

// Convenience exports for common use cases
import { getMediaByEventService } from './media-query.service';
import { updateMediaStatusService } from './media-management.service';

export const getEventMedia = getMediaByEventService;
export const updateMediaStatus = updateMediaStatusService;
// ====================================
// 7. services/album/index.ts - UNIFIED EXPORT
// ====================================

import { albumCoreService } from './album-core.service';
import { albumDefaultService } from './album-default.service';
import { albumQueryService } from './album-query.service';

// Main services
export { albumCoreService } from './album-core.service';
export { albumQueryService } from './album-query.service';
export { albumDefaultService } from './album-default.service';
export { albumValidationService } from './album-validation.service';
export { albumPermissionsService } from './album-permissions.service';

// Export types
export type {
    AlbumCreationType,
    AlbumType,
    AlbumQueryParams,
    AlbumUpdateData,
    AlbumPermissions,
    AlbumServiceResponse
} from './album.types';

// Convenience exports (backwards compatibility)
export const createAlbumService = albumCoreService.createAlbum.bind(albumCoreService);
export const updateAlbumService = albumCoreService.updateAlbum.bind(albumCoreService);
export const deleteAlbumService = albumCoreService.deleteAlbum.bind(albumCoreService);
export const getAlbumsByParams = albumQueryService.getAlbumsByParams.bind(albumQueryService);
export const getDefaultAlbum = albumQueryService.getDefaultAlbum.bind(albumQueryService);
export const createDefaultAlbumForEvent = albumDefaultService.createDefaultAlbum.bind(albumDefaultService);
export const getOrCreateDefaultAlbum = albumDefaultService.getOrCreateDefaultAlbum.bind(albumDefaultService);
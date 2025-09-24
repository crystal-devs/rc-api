// ====================================
// 6. services/event/index.ts - UNIFIED EXPORT
// ====================================

// Re-export all event services
export {
    createEventService,
    deleteEventService,
    updateEventService
} from './event-core.service';

export {
    getUserEventsService,
    getEventDetailService
} from './event-query.service';

export {
    generateUniqueSlug,
    processLocationData,
    processCoverImageData,
    processPermissionsData,
    processShareSettingsData,
    validateCoHosts,
    addCreatorAsParticipant,
    checkUpdatePermission,
    getUserEventStats,
    recordEventActivity,
    handleVisibilityTransition
} from './event-utils.service';

export {
    processEventUpdateData
} from './event-management.service';

// Export types
export type {
    EventCreationData,
    EventType,
    EventFilters,
    EventWithExtras,
    EventStats,
    VisibilityTransitionResult,
    LocationData,
    CoverImageData,
    PermissionsData,
    ShareSettingsData
} from './event.types';

export {
    shareTokenService,
    getShareTokenDetailsService,
    validateGuestShareToken,
    validateShareToken
} from './access';

export type {
    UserRole,
    EventVisibility,
    UserAccess,
    EventResponse,
    ShareTokenValidation,
    EventPermissions
} from './access';

// Convenience exports for common use cases
import { createEventService } from './event-core.service';
import { getUserEventsService } from './event-query.service';
import { getUserEventStats } from './event-utils.service';

export const createEvent = createEventService;
export const getUserEvents = getUserEventsService;
export const getEventStats = getUserEventStats;

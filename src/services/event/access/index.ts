// ====================================
// 6. services/event/access/index.ts - UNIFIED EXPORT
// ====================================

import { shareTokenService } from './share-token.service';

// Main service
export { shareTokenService } from './share-token.service';

// Individual services for advanced usage
export { shareValidationService } from './share-validation.service';
export { accessControlService } from './access-control.service';
export { eventResponseService } from './event-response.service';

// Export types
export type {
    UserRole,
    EventVisibility,
    UserAccess,
    EventResponse,
    ShareTokenValidation,
    EventPermissions,
    AccessCheckResult
} from './access.types';

// Convenience exports (backwards compatibility)
export const getShareTokenDetailsService = shareTokenService.getShareTokenDetails.bind(shareTokenService);
export const validateGuestShareToken = shareTokenService.validateGuestShareToken.bind(shareTokenService);
export const validateShareToken = shareTokenService.validateShareToken.bind(shareTokenService);
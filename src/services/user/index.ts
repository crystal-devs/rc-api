// 6. services/user/index.ts - UNIFIED EXPORT
// ====================================

// Re-export all user services
export { 
    getUserByIdService, 
    getUserProfileService 
} from './user-profile.service';

export { 
    getUserSubscriptionService, 
    upgradeSubscriptionService 
} from './user-subscription.service';

export { 
    getUserUsageService, 
    checkUserLimitsService 
} from './user-usage.service';

export { 
    getUserStatisticsService 
} from './user-statistics.service';

// Export types
export type {
    ServiceResponse,
    UserProfile,
    FormattedSubscription,
    FormattedUsage,
    UserStatistics,
    LimitCheckType,
    UpgradeSubscriptionOptions
} from './user.types';

// Convenience exports for common use cases
import { getUserProfileService } from './user-profile.service';
import { getUserSubscriptionService } from './user-subscription.service';
import { checkUserLimitsService } from './user-usage.service';

export const getUserProfile = getUserProfileService;
export const getUserSubscription = getUserSubscriptionService;
export const checkUserLimits = checkUserLimitsService;
// ====================================
// 2. services/event/access/share-validation.service.ts
// ====================================

import { logger } from "@utils/logger";
import type { EventVisibility, AccessCheckResult } from './access.types';

export class ShareValidationService {
    /**
     * Validate share settings (expiration, active status)
     */
    validateShareSettings(shareSettings: any) {
        if (!shareSettings?.is_active) {
            return {
                status: false,
                code: 403,
                message: 'Share link is inactive',
                data: null as any,
                error: { message: 'This share link has been deactivated' },
                other: null as any,
            };
        }

        if (shareSettings?.expires_at && new Date(shareSettings.expires_at) < new Date()) {
            return {
                status: false,
                code: 403,
                message: 'Share link has expired',
                data: null,
                error: { message: 'This invitation has expired' },
                other: null,
            };
        }

        return null;
    }

    /**
     * Check if user has access based on event visibility
     */
    checkVisibilityAccess(
        visibility: EventVisibility,
        authToken?: string,
        userEmail?: string
    ): AccessCheckResult {
        switch (visibility) {
            case 'private':
                return {
                    valid: false,
                    reason: "This is a private event. Please use the direct event link if you're an owner or co-host."
                };

            case 'invited_only':
                if (!authToken || !userEmail) {
                    return {
                        valid: false,
                        reason: "This event requires you to log in to access.",
                        requiresAuth: true
                    };
                }

                const isInvited = this.checkIfUserIsInvited(userEmail);
                if (!isInvited) {
                    return {
                        valid: false,
                        reason: "You are not invited to this event. Please contact the event host for access."
                    };
                }
                break;

            case 'anyone_with_link':
            default:
                break;
        }

        return { valid: true };
    }

    /**
     * Check if user is invited to the event
     */
    private checkIfUserIsInvited(userEmail: string): boolean {
        // TODO: Add invited user logic later
        // For now, any authenticated user can access invited_only events
        return true;
    }
}

// Singleton instance
export const shareValidationService = new ShareValidationService();
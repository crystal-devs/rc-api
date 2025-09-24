// ====================================
// 3. services/event/access/access-control.service.ts
// ====================================

import type { UserAccess, EventPermissions, UserRole, EventVisibility } from './access.types';

export class AccessControlService {
    /**
     * Determine user access level based on their relationship to the event
     */
    determineUserAccess(event: any, requesterId?: string): UserAccess {
        const access: UserAccess = {
            canJoin: false,
            requiresAuth: false,
            role: 'guest',
            isOwner: false,
            isCoHost: false
        };

        // Check if user is owner or co-host
        if (requesterId) {
            if (event.created_by && event.created_by.toString() === requesterId) {
                access.isOwner = true;
                access.role = 'owner';
            } else if (event.co_hosts && event.co_hosts.length > 0) {
                const coHost = event.co_hosts.find(
                    (ch: any) => ch.user_id.toString() === requesterId && ch.status === 'approved'
                );
                if (coHost) {
                    access.isCoHost = true;
                    access.role = 'co_host';
                }
            }
        }

        // Determine access based on visibility
        access.canJoin = this.canUserJoinEvent(event.visibility, access);
        access.requiresAuth = this.doesUserNeedAuth(event.visibility, requesterId);

        return access;
    }

    /**
     * Check if user can join event based on visibility
     */
    private canUserJoinEvent(visibility: EventVisibility, access: UserAccess): boolean {
        switch (visibility) {
            case 'anyone_with_link':
                return true;
            case 'invited_only':
                return access.isOwner || access.isCoHost; // Simplified for now
            case 'private':
                return access.isOwner || access.isCoHost;
            default:
                return false;
        }
    }

    /**
     * Check if user needs authentication
     */
    private doesUserNeedAuth(visibility: EventVisibility, requesterId?: string): boolean {
        switch (visibility) {
            case 'anyone_with_link':
                return false;
            case 'invited_only':
            case 'private':
                return !requesterId;
            default:
                return true;
        }
    }

    /**
     * Get user permissions for the event
     */
    getEventPermissions(event: any, userAccess: UserAccess): EventPermissions {
        const basePermissions: EventPermissions = {
            view: event.permissions?.can_view ?? true,
            upload: event.permissions?.can_upload ?? false,
            download: event.permissions?.can_download ?? true,
            moderate: false,
            delete: false,
            requireApproval: event.permissions?.require_approval ?? false
        };

        // Enhance permissions based on user role
        if (userAccess.isOwner) {
            return {
                ...basePermissions,
                moderate: true,
                delete: true,
                upload: true,
                requireApproval: false // Owners don't need approval
            };
        }

        if (userAccess.isCoHost) {
            return {
                ...basePermissions,
                moderate: true,
                delete: false, // Co-hosts can't delete events
                upload: true,
                requireApproval: false // Co-hosts don't need approval
            };
        }

        // Guest permissions (use event defaults)
        return basePermissions;
    }
}

// Singleton instance
export const accessControlService = new AccessControlService();
// 1. services/event/access/access.types.ts
// ====================================

export type UserRole = 'guest' | 'owner' | 'co_host';
export type EventVisibility = 'anyone_with_link' | 'invited_only' | 'private';

export interface UserAccess {
    canJoin: boolean;
    requiresAuth: boolean;
    role: UserRole;
    isOwner: boolean;
    isCoHost: boolean;
}

export interface EventResponse {
    _id: string;
    title: string;
    description: string;
    start_date: string;
    visibility: EventVisibility;
    cover_image?: { url: string } | null;
    location?: { name: string } | null;
    permissions?: {
        can_upload: boolean;
        can_download: boolean;
        require_approval: boolean;
    };
    styling_config?: any;
}

export interface ShareTokenValidation {
    valid: boolean;
    reason?: string;
    event_id?: string;
    permissions?: any;
    eventData?: any;
    requiresAuth?: boolean;
    visibility?: EventVisibility;
}

export interface EventPermissions {
    view: boolean;
    upload: boolean;
    download: boolean;
    moderate: boolean;
    delete: boolean;
    requireApproval: boolean;
}

export interface AccessCheckResult {
    valid: boolean;
    reason?: string;
    requiresAuth?: boolean;
}
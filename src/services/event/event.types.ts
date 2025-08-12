// 1. services/event/event.types.ts
// ====================================

import { Event } from "@models/event.model";
import mongoose from "mongoose";

export type EventCreationData = typeof Event.schema extends mongoose.Schema<infer T> ? Omit<T, '_id'> : never;
export type EventType = typeof Event.schema extends mongoose.Schema<infer T> ? T : never;

export interface EventFilters {
    userId: string;
    page: number;
    limit: number;
    sort: string;
    status: string;
    privacy: string;
    template?: string;
    search?: string;
    tags?: string[];
}

export interface EventWithExtras extends EventType {
    user_role?: string;
    user_permissions?: Record<string, boolean> | null;
}

export interface EventStats {
    total_events: number;
    active_events: number;
    archived_events: number;
    owned_events: number;
    co_hosted_events: number;
}

export interface VisibilityTransitionResult {
    from: string;
    to: string;
    anonymous_users_affected: number;
    actions_taken: string[];
}

export interface LocationData {
    name: string;
    address: string;
    coordinates: number[];
}

export interface CoverImageData {
    url: string;
    public_id: string;
    uploaded_by: string | null;
    thumbnail_url: string;
}

export interface PermissionsData {
    can_view?: boolean;
    can_upload?: boolean;
    can_download?: boolean;
    require_approval?: boolean;
    allowed_media_types?: {
        images: boolean;
        videos: boolean;
    };
}

export interface ShareSettingsData {
    is_active?: boolean;
    password?: string | null;
    expires_at?: Date | null;
}

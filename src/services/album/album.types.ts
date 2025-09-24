// 1. services/album/album.types.ts
// ====================================

import type { AlbumCreationType, AlbumType } from "@models/album.model";
import { ServiceResponse } from "types/service.types";

export interface AlbumQueryParams {
    album_id?: string;
    event_id?: string;
    user_id?: string;
}

export interface AlbumUpdateData {
    title?: string;
    description?: string;
    cover_image?: string;
    is_private?: boolean;
    tags?: string[];
}

export interface AlbumPermissions {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canManageContent: boolean;
}

export interface DefaultAlbumData {
    title: string;
    description: string;
    event_id: string;
    created_by: string;
    is_default: boolean;
}

// Re-export model types for convenience
export type { AlbumCreationType, AlbumType };
export type AlbumServiceResponse<T> = ServiceResponse<T>;
// ====================================
// 6. services/album/album-default.service.ts
// ====================================

import mongoose from "mongoose";
import { logger } from "@utils/logger";

// Import our modular services
import { albumCoreService } from './album-core.service';
import { albumQueryService } from './album-query.service';
import { albumValidationService } from './album-validation.service';

import type { AlbumCreationType, AlbumType, AlbumServiceResponse } from './album.types';

export class AlbumDefaultService {
    /**
     * 🚀 CREATE: Default album for event
     */
    async createDefaultAlbum(eventId: string, userId: string): Promise<AlbumServiceResponse<AlbumType>> {
        try {
            // Check if default album already exists
            const exists = await albumValidationService.defaultAlbumExists(eventId);
            if (exists) {
                const existingAlbum = await albumQueryService.getDefaultAlbum(eventId);
                if (existingAlbum.status && existingAlbum.data) {
                    return {
                        status: true,
                        code: 200,
                        message: "Default album already exists",
                        data: existingAlbum.data,
                        error: null,
                        other: null
                    };
                }
            }

            // Create default album data
            const defaultAlbumData: AlbumCreationType = {
                title: "All Photos",
                description: "Default album for event photos",
                event_id: new mongoose.Types.ObjectId(eventId),
                created_by: new mongoose.Types.ObjectId(userId),
                created_at: new Date(),
                is_default: true,
                cover_image: ""
            };

            return await albumCoreService.createAlbum(defaultAlbumData);
        } catch (err: any) {
            logger.error('Error creating default album:', err);

            return {
                status: false,
                code: 500,
                message: "Failed to create default album",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        }
    }

    /**
     * 🔍 GET OR CREATE: Default album for event
     */
    async getOrCreateDefaultAlbum(eventId: string, userId: string): Promise<AlbumServiceResponse<AlbumType>> {
        try {
            // First try to find existing default album
            const existingAlbum = await albumQueryService.getDefaultAlbum(eventId);
            
            if (existingAlbum.status && existingAlbum.data) {
                return {
                    status: true,
                    code: 200,
                    message: "Default album found",
                    data: existingAlbum.data,
                    error: null,
                    other: null
                };
            }

            // If no default album exists, create one
            return await this.createDefaultAlbum(eventId, userId);
        } catch (err: any) {
            logger.error('Error getting or creating default album:', err);

            return {
                status: false,
                code: 500,
                message: "Failed to get or create default album",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        }
    }
}

// Singleton instance
export const albumDefaultService = new AlbumDefaultService();

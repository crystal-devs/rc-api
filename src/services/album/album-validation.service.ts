// 2. services/album/album-validation.service.ts
// ====================================

import mongoose from "mongoose";
import { Album } from "@models/album.model";
import { logger } from "@utils/logger";
import type { AlbumPermissions } from './album.types';

export class AlbumValidationService {
    /**
     * Validate album ID format
     */
    validateAlbumId(albumId: string): boolean {
        return mongoose.Types.ObjectId.isValid(albumId);
    }

    /**
     * Validate event ID format
     */
    validateEventId(eventId: string): boolean {
        return mongoose.Types.ObjectId.isValid(eventId);
    }

    /**
     * Check if album exists
     */
    async albumExists(albumId: string): Promise<boolean> {
        try {
            const album = await Album.findById(albumId).lean();
            return !!album;
        } catch (error) {
            logger.error('Error checking album existence:', error);
            return false;
        }
    }

    /**
     * Check if default album exists for event
     */
    async defaultAlbumExists(eventId: string): Promise<boolean> {
        try {
            const album = await Album.findOne({
                event_id: new mongoose.Types.ObjectId(eventId),
                is_default: true
            }).lean();
            return !!album;
        } catch (error) {
            logger.error('Error checking default album existence:', error);
            return false;
        }
    }

    /**
     * Validate album update data
     */
    validateUpdateData(updateData: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (updateData.title !== undefined) {
            if (typeof updateData.title !== 'string' || updateData.title.trim().length === 0) {
                errors.push('Title must be a non-empty string');
            } else if (updateData.title.length > 100) {
                errors.push('Title must be less than 100 characters');
            }
        }

        if (updateData.description !== undefined) {
            if (typeof updateData.description !== 'string') {
                errors.push('Description must be a string');
            } else if (updateData.description.length > 500) {
                errors.push('Description must be less than 500 characters');
            }
        }

        if (updateData.is_private !== undefined) {
            if (typeof updateData.is_private !== 'boolean') {
                errors.push('is_private must be a boolean');
            }
        }

        if (updateData.tags !== undefined) {
            if (!Array.isArray(updateData.tags)) {
                errors.push('Tags must be an array');
            } else if (updateData.tags.length > 10) {
                errors.push('Maximum 10 tags allowed');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Singleton instance
export const albumValidationService = new AlbumValidationService();
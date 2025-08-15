// ====================================
// 4. services/album/album-core.service.ts
// ====================================

import mongoose from "mongoose";
import { Album } from "@models/album.model";
import { ActivityLog } from "@models/activity-log.model";
import { logger } from "@utils/logger";

// Import our modular services
import { albumValidationService } from './album-validation.service';
import { albumPermissionsService } from './album-permissions.service';

import type { 
    AlbumCreationType, 
    AlbumType, 
    AlbumServiceResponse, 
    AlbumUpdateData 
} from './album.types';

export class AlbumCoreService {
    /**
     * 🚀 CREATE: Create a new album
     */
    async createAlbum(albumData: AlbumCreationType): Promise<AlbumServiceResponse<AlbumType>> {
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            // Create the album
            const album = await Album.create([albumData], { session });

            if (!album[0]?._id || !albumData?.created_by) {
                throw new Error("Invalid album or creator ID");
            }

            // Create activity log entry
            await ActivityLog.create([{
                user_id: new mongoose.Types.ObjectId(albumData.created_by),
                resource_id: new mongoose.Types.ObjectId(album[0]._id),
                resource_type: "album",
                action: "created",
                details: { event_id: albumData.event_id }
            }], { session });

            await session.commitTransaction();

            return {
                status: true,
                code: 201,
                message: "Album created successfully",
                data: album[0],
                error: null,
                other: null
            };
        } catch (err: any) {
            logger.error('Error creating album:', err);
            await session.abortTransaction();
            
            return {
                status: false,
                code: 500,
                message: "Failed to create album",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        } finally {
            await session.endSession();
        }
    }

    /**
     * 🔄 UPDATE: Update an existing album
     */
    async updateAlbum(
        albumId: string,
        updateData: AlbumUpdateData,
        userId: string
    ): Promise<AlbumServiceResponse<AlbumType>> {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Validate album ID
            if (!albumValidationService.validateAlbumId(albumId)) {
                return {
                    status: false,
                    code: 400,
                    message: "Invalid album ID",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Validate update data
            const validation = albumValidationService.validateUpdateData(updateData);
            if (!validation.valid) {
                return {
                    status: false,
                    code: 400,
                    message: "Invalid update data",
                    data: null,
                    error: { message: validation.errors.join(', ') },
                    other: null
                };
            }

            // Get album with populated event
            const album = await Album.findById(albumId).populate('event_id').session(session);
            if (!album) {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 404,
                    message: "Album not found",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Check permissions
            const canEdit = await albumPermissionsService.canUserPerformOperation(
                album, 
                userId, 
                'edit'
            );

            if (!canEdit) {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 403,
                    message: "You don't have permission to update this album",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Update the album
            const updatedAlbum = await Album.findOneAndUpdate(
                { _id: albumId },
                { $set: updateData },
                { new: true, session }
            );

            // Log the update activity
            await ActivityLog.create([{
                user_id: new mongoose.Types.ObjectId(userId),
                resource_id: new mongoose.Types.ObjectId(albumId),
                resource_type: "album",
                action: "edited",
                details: { updated_fields: Object.keys(updateData) }
            }], { session });

            await session.commitTransaction();

            return {
                status: true,
                code: 200,
                message: "Album updated successfully",
                data: updatedAlbum!,
                error: null,
                other: null
            };
        } catch (err: any) {
            logger.error('Error updating album:', err);
            await session.abortTransaction();

            return {
                status: false,
                code: 500,
                message: "Failed to update album",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        } finally {
            await session.endSession();
        }
    }

    /**
     * 🗑️ DELETE: Delete an album
     */
    async deleteAlbum(albumId: string, userId: string): Promise<AlbumServiceResponse<null>> {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Validate album ID
            if (!albumValidationService.validateAlbumId(albumId)) {
                return {
                    status: false,
                    code: 400,
                    message: "Invalid album ID",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Get album with populated event
            const album = await Album.findById(albumId).populate('event_id').session(session);
            if (!album) {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 404,
                    message: "Album not found",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Check if this is a default album
            if (album.is_default) {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 400,
                    message: "Cannot delete the default album",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Check permissions
            const canDelete = await albumPermissionsService.canUserPerformOperation(
                album, 
                userId, 
                'delete'
            );

            if (!canDelete) {
                await session.abortTransaction();
                return {
                    status: false,
                    code: 403,
                    message: "You don't have permission to delete this album",
                    data: null,
                    error: null,
                    other: null
                };
            }

            // Delete the album
            await Album.deleteOne({ _id: albumId }, { session });

            // Log the deletion activity
            await ActivityLog.create([{
                user_id: new mongoose.Types.ObjectId(userId),
                resource_id: new mongoose.Types.ObjectId(albumId),
                resource_type: "album",
                action: "deleted",
                details: { event_id: album.event_id }
            }], { session });

            await session.commitTransaction();

            return {
                status: true,
                code: 200,
                message: "Album deleted successfully",
                data: null,
                error: null,
                other: null
            };
        } catch (err: any) {
            logger.error('Error deleting album:', err);
            await session.abortTransaction();

            return {
                status: false,
                code: 500,
                message: "Failed to delete album",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        } finally {
            await session.endSession();
        }
    }
}

// Singleton instance
export const albumCoreService = new AlbumCoreService();
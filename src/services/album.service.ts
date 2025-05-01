// services/album.service.ts

import { AccessControl } from "@models/access.model";
import { ActivityLog } from "@models/activity-log.model";
import { Album, AlbumCreationType, AlbumType } from "@models/album.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "types/service.types";

/**
 * Create a new album
 * @param albumData Album data to create
 * @returns Service response with created album or error
 */
export const createAlbumService = async (albumData: AlbumCreationType): Promise<ServiceResponse<AlbumType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        console.log(albumData, 'album being created');
        
        // Create the album
        const album = await Album.create([albumData], { session });
        console.log(album, 'album created');
        
        if (!album[0]?._id || !albumData?.created_by) {
            throw new Error("Invalid album or creator ID");
        }

        // Create access control record for the album
        await AccessControl.create([{
            resource_id: new mongoose.Types.ObjectId(album[0]._id),
            resource_type: "album",
            permissions: [{
                user_id: new mongoose.Types.ObjectId(albumData.created_by),
                role: "owner",
            }],
        }], { session });

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
    } catch (err) {
        logger.error(err);
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
};

/**
 * Get albums by album ID, event ID, or user ID
 * @param params Parameters to filter albums
 * @returns Service response with albums or error
 */
export const getAlbumsByParams = async ({ 
    album_id, 
    event_id, 
    user_id 
}: { 
    album_id?: string, 
    event_id?: string, 
    user_id?: string 
}): Promise<ServiceResponse<AlbumType[]>> => {
    try {
        let albums: AlbumType[] = [];

        // Fetch albums by user ID through access control
        if (user_id) {
            albums = await AccessControl.aggregate([
                {
                    $match: {
                        "permissions.user_id": new mongoose.Types.ObjectId(user_id),
                        resource_type: "album"
                    }
                },
                {
                    $lookup: {
                        from: MODEL_NAMES.ALBUM,
                        localField: "resource_id",
                        foreignField: "_id",
                        as: "albumData"
                    }
                },
                { $unwind: "$albumData" },
                { $replaceRoot: { newRoot: "$albumData" } },
            ]);
        }

        // Fetch albums by event ID
        if (event_id) {
            const eventAlbums = await Album.find({ 
                event_id: new mongoose.Types.ObjectId(event_id) 
            }).lean();
            
            if (eventAlbums.length > 0) {
                // If we already have albums from user_id, merge them rather than replace
                if (albums.length > 0) {
                    // Get IDs of existing albums to avoid duplicates
                    const existingIds = new Set(albums.map(a => a._id.toString()));
                    // Add only new albums (no duplicates)
                    eventAlbums.forEach(album => {
                        if (!existingIds.has(album._id.toString())) {
                            albums.push(album);
                        }
                    });
                } else {
                    albums = eventAlbums;
                }
            }
        }

        // Fetch a specific album by ID
        if (album_id) {
            const album = await Album.findById(album_id).lean();
            if (album) {
                // If we already have this album from previous queries, don't add duplicate
                const exists = albums.some(a => a._id.toString() === album._id.toString());
                if (!exists) {
                    albums.push(album);
                }
            }
        }

        return {
            status: true,
            code: 200,
            message: "Albums fetched successfully",
            data: albums,
            error: null,
            other: null
        };
    } catch (err: any) {
        logger.error(`[getAlbumsByParams] Error fetching albums: ${err.message}`);
        if (process.env.NODE_ENV === "development") console.error(err.stack);

        return {
            status: false,
            code: 500,
            message: "Failed to get albums",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            },
            other: null
        };
    }
};

/**
 * Update an existing album
 * @param album_id ID of the album to update
 * @param dataToUpdate Data to update
 * @returns Service response with updated album or error
 */
export const updateAlbumService = async (
    album_id: string,
    dataToUpdate: Record<string, any>,
    user_id: string
): Promise<ServiceResponse<AlbumType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const objectId = new mongoose.Types.ObjectId(album_id);

        // First verify user has permission to update this album
        const accessControl = await AccessControl.findOne({
            resource_id: objectId,
            resource_type: "album",
            "permissions.user_id": new mongoose.Types.ObjectId(user_id),
            "permissions.role": "owner"
        });

        if (!accessControl) {
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
        const album = await Album.findOneAndUpdate(
            { _id: objectId },
            { $set: dataToUpdate },
            { new: true, session }
        );

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

        // Log the update activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(user_id),
            resource_id: objectId,
            resource_type: "album",
            action: "edited",
            details: { updated_fields: Object.keys(dataToUpdate) }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: "Album updated successfully",
            data: album,
            error: null,
            other: null
        };
    } catch (err) {
        logger.error(`[updateAlbumService] Error updating album: ${err.message}`);
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
};

/**
 * Delete an album
 * @param album_id ID of the album to delete
 * @param user_id ID of the user performing the deletion
 * @returns Service response with success or error
 */
export const deleteAlbumService = async (
    album_id: string,
    user_id: string
): Promise<ServiceResponse<null>> => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const objectId = new mongoose.Types.ObjectId(album_id);

        // First verify user has permission to delete this album
        const accessControl = await AccessControl.findOne({
            resource_id: objectId,
            resource_type: "album",
            "permissions.user_id": new mongoose.Types.ObjectId(user_id),
            "permissions.role": "owner"
        });

        if (!accessControl) {
            return {
                status: false,
                code: 403,
                message: "You don't have permission to delete this album",
                data: null,
                error: null,
                other: null
            };
        }

        // Get album details before deletion (for event_id)
        const album = await Album.findById(objectId);
        if (!album) {
            return {
                status: false,
                code: 404,
                message: "Album not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Delete the album
        await Album.deleteOne({ _id: objectId }, { session });

        // Delete related access controls
        await AccessControl.deleteMany({ 
            resource_id: objectId,
            resource_type: "album"
        }, { session });

        // Log the deletion activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(user_id),
            resource_id: objectId,
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
    } catch (err) {
        logger.error(`[deleteAlbumService] Error deleting album: ${err.message}`);
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
};
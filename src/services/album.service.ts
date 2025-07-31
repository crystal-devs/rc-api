// services/album.service.ts (updated with default album functionality)

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
 * Create a default album for an event
 * @param event_id ID of the event
 * @param user_id ID of the user creating the album
 * @returns Service response with created default album or error
 */
export const createDefaultAlbumForEvent = async (
    event_id: string,
    user_id: string
): Promise<ServiceResponse<AlbumType>> => {
    try {
        // Check if a default album already exists for this event
        const existingDefaultAlbum = await Album.findOne({
            event_id: new mongoose.Types.ObjectId(event_id),
            is_default: true
        });

        if (existingDefaultAlbum) {
            return {
                status: true,
                code: 200,
                message: "Default album already exists",
                data: existingDefaultAlbum,
                error: null,
                other: null
            };
        }

        // Create a new default album
        const defaultAlbumData: AlbumCreationType = {
            title: "All Photos",
            description: "Default album for event photos",
            event_id: new mongoose.Types.ObjectId(event_id),
            created_by: new mongoose.Types.ObjectId(user_id),
            created_at: new Date(),
            is_default: true,
            cover_image: ""
        };

        return await createAlbumService(defaultAlbumData);
    } catch (err) {
        logger.error(`[createDefaultAlbumForEvent] Error creating default album: ${err.message}`);

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
};

/**
 * Get or create a default album for an event
 * @param event_id ID of the event
 * @param user_id ID of the user
 * @returns Service response with default album or error
 */
export const getOrCreateDefaultAlbum = async (
    event_id: string,
    user_id: string
): Promise<ServiceResponse<AlbumType>> => {
    try {
        // First try to find an existing default album
        const defaultAlbum = await Album.findOne({
            event_id: new mongoose.Types.ObjectId(event_id),
            is_default: true
        });

        if (defaultAlbum) {
            return {
                status: true,
                code: 200,
                message: "Default album found",
                data: defaultAlbum,
                error: null,
                other: null
            };
        }

        // If no default album exists, create one
        return await createDefaultAlbumForEvent(event_id, user_id);
    } catch (err) {
        logger.error(`[getOrCreateDefaultAlbum] Error getting or creating default album: ${err.message}`);

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

        // Fetch albums by user ID using aggregation
        if (user_id) {
            const userObjectId = new mongoose.Types.ObjectId(user_id);

            albums = await Album.aggregate([
                {
                    $lookup: {
                        from: MODEL_NAMES.EVENT,
                        localField: "event_id",
                        foreignField: "_id",
                        as: "event"
                    }
                },
                { $unwind: "$event" },
                {
                    $match: {
                        $or: [
                            { "event.created_by": userObjectId },
                            {
                                "event.co_hosts.user_id": userObjectId,
                                "event.co_hosts.status": "approved"
                            }
                        ]
                    }
                },
                {
                    $project: {
                        event: 0 // Remove the event data, keep only album fields
                    }
                }
            ]);
        }

        // Fetch albums by event ID
        if (event_id) {
            const eventAlbums = await Album.find({
                event_id: new mongoose.Types.ObjectId(event_id)
            }).lean();

            if (eventAlbums.length > 0) {
                if (albums.length > 0) {
                    const existingIds = new Set(albums.map(a => a._id.toString()));
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
 * Get default album for an event or create one if it doesn't exist
 * @param event_id ID of the event
 * @param user_id ID of the user
 * @returns Service response with default album or error
 */
export const getDefaultAlbum = async (
    event_id: string
): Promise<ServiceResponse<AlbumType | null>> => {
    try {
        const defaultAlbum = await Album.findOne({
            event_id: new mongoose.Types.ObjectId(event_id),
            is_default: true
        });

        if (!defaultAlbum) {
            return {
                status: false,
                code: 404,
                message: "Default album not found",
                data: null,
                error: null,
                other: null
            };
        }

        return {
            status: true,
            code: 200,
            message: "Default album found",
            data: defaultAlbum,
            error: null,
            other: null
        };
    } catch (err) {
        logger.error(`[getDefaultAlbum] Error getting default album: ${err.message}`);

        return {
            status: false,
            code: 500,
            message: "Failed to get default album",
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

        // Get the album and populate the event to check permissions
        const album = await Album.findById(objectId).populate('event_id').session(session);

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

        const event = album.event_id as any; // TypeScript casting needed due to populate

        if (!event) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Associated event not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Check if user has permission to update this album
        // User can update if they are event owner or approved co-host
        const isEventOwner = event.created_by && event.created_by.toString() === user_id;
        const isApprovedCoHost = event.co_hosts.some((coHost: any) => 
            coHost.user_id.toString() === user_id && 
            coHost.status === 'approved'
        );

        if (!isEventOwner && !isApprovedCoHost) {
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
            { _id: objectId },
            { $set: dataToUpdate },
            { new: true, session }
        );

        // Log the update activity (if you still have ActivityLog)
        if (typeof ActivityLog !== 'undefined') {
            await ActivityLog.create([{
                user_id: new mongoose.Types.ObjectId(user_id),
                resource_id: objectId,
                resource_type: "album",
                action: "edited",
                details: { updated_fields: Object.keys(dataToUpdate) }
            }], { session });
        }

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

        // Get the album and populate the event to check permissions
        const album = await Album.findById(objectId).populate('event_id').session(session);

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

        // Check if this is a default album - don't allow deleting default albums
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

        const event = album.event_id as any; // TypeScript casting needed due to populate

        if (!event) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Associated event not found",
                data: null,
                error: null,
                other: null
            };
        }

        // Check if user has permission to delete this album
        // User can delete if they are event owner or approved co-host with manage_content permission
        const isEventOwner = event.created_by && event.created_by.toString() === user_id;
        const approvedCoHost = event.co_hosts.find((coHost: any) => 
            coHost.user_id.toString() === user_id && 
            coHost.status === 'approved'
        );
        const canManageContent = approvedCoHost && approvedCoHost.permissions.manage_content;

        if (!isEventOwner && !canManageContent) {
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
        await Album.deleteOne({ _id: objectId }, { session });

        // Log the deletion activity (if you still have ActivityLog)
        if (typeof ActivityLog !== 'undefined') {
            await ActivityLog.create([{
                user_id: new mongoose.Types.ObjectId(user_id),
                resource_id: objectId,
                resource_type: "album",
                action: "deleted",
                details: { event_id: album.event_id }
            }], { session });
        }

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
import { AccessControl } from "@models/access.model";
import { ActivityLog } from "@models/activity-log.model";
import { Album, AlbumCreationType, AlbumType } from "@models/album.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "types/service.types";


export const createAlbumService = async (albumData: AlbumCreationType): Promise<ServiceResponse<AlbumType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {

        const album = await Album.create([albumData], { session });

        if (!album[0]?._id || !albumData?.created_by) throw new Error("Invalid album or creator ID");

        await AccessControl.create([{             
            resource_id: new mongoose.Types.ObjectId(album[0]._id),
            resource_type: "album",
            permissions: [{
                user_id: new mongoose.Types.ObjectId(albumData.created_by),
                role: "owner",
            }],
        }], { session });

        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(albumData.created_by),
            resource_id: new mongoose.Types.ObjectId(album[0]._id),
            resource_type: "album",
            action: "created",
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
}

export const getAlbumsByAlbumIdOrUserId = async ({ album_id, user_id }: { album_id?: string, user_id?: string }): Promise<ServiceResponse<AlbumType[]>> => {
    try {
        let albums: AlbumType[] = [];

         if (user_id) {
            albums = await AccessControl.aggregate([
                { 
                    $match: {
                        "permissions.user_id": new mongoose.Types.ObjectId(user_id),
                        "permissions.role": { $in: ["owner", "viewer"] },
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

        if (album_id) {
            const album = await Album.findById(album_id).lean();
            if (album) albums.push(album);
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
        logger.error(`[getAlbumService] Error fetching albums: ${err.message}`);
        if (process.env.NODE_ENV === "development") console.error(err.stack);

        return {
            status: false,
            code: 500,
            message: "Failed to get album",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            },
            other: null
        };
    }
}


import accessModel from "@models/access.model";
import albumModel, { AlbumCreationType, AlbumType } from "@models/album.model";
import mongoose from "mongoose";
import { ServiceResponse } from "types/service.types";


export const createAlbumService = async (albumData: AlbumCreationType): Promise<ServiceResponse<AlbumType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {

        const album = await albumModel.create([albumData], { session });

        await accessModel.create({
            album_id: album[0]._id,
            user_id: albumData.created_by,
            role: "owner",
        }, { session });

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
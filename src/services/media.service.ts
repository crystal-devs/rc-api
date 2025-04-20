import fs from "fs/promises";
import mongoose from "mongoose";
import ImageKit from "imagekit";
import { Media, MediaCreationType } from "@models/media.model";
import { ServiceResponse } from "types/service.types";

const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

export const uploadMediaToImageKitService = async (
    file: Express.Multer.File,
    user_id: string,
    album_id: string,
    page_id?: string,
): Promise<ServiceResponse<MediaCreationType>> => {
    try {
        const fileBuffer = await fs.readFile(file.path);

        const fileType = (() => {
            if (file.mimetype.startsWith("image/")) return "image";
            if (file.mimetype.startsWith("video/")) return "video";
            return null;
        })();

        if (!fileType) {
            await fs.unlink(file.path);
            return {
                status: false,
                code: 400,
                message: "Unsupported file type",
                data: null,
                error: { message: "Only image and video files are supported" },
                other: null,
            };
        }

        const uploadResult = await imagekit.upload({
            file: fileBuffer,
            fileName: `${Date.now()}_${file.originalname}`,
            folder: `/album_${album_id}`,
        });

        await fs.unlink(file.path); // Always clean up

        const media = await Media.create({
            url: uploadResult.url,
            type: fileType,
            album_id: new mongoose.Types.ObjectId(album_id),
            page_id: page_id ? new mongoose.Types.ObjectId(page_id) : false,
            uploaded_by: new mongoose.Types.ObjectId(user_id),
        });

        return {
            status: true,
            code: 200,
            message: "Upload successful",
            data: media,
            error: null,
            other: null,
        };

    } catch (err: any) {
        if (file?.path) await fs.unlink(file.path).catch(() => {});
        return {
            status: false,
            code: 500,
            message: "Failed to upload media",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
            },
            other: null,
        };
    }
};
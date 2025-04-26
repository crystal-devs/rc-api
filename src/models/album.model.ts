import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";
const albumSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: "" },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, required: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    created_at: { type: Date, default: Date.now },
});

export const Album = mongoose.model(MODEL_NAMES.ALBUM, albumSchema, MODEL_NAMES.ALBUM);

export type AlbumType = InferSchemaType<typeof albumSchema>;
export type AlbumCreationType = Omit<AlbumType, '_id'>;
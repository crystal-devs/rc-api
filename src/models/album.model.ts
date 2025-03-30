import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";
const albumSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, "Title is required"] },
    description: { type: String, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, "Created by is required"] },
    start_date: { type: Date, default: Date.now },
    end_date: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    is_private: { type: Boolean, default: false },
});

export const Album = mongoose.model(MODEL_NAMES.ALBUM, albumSchema, MODEL_NAMES.ALBUM);

export type AlbumType = InferSchemaType<typeof albumSchema>;
export type AlbumCreationType = Omit<AlbumType, '_id'>;
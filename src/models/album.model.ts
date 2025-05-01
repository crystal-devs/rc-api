import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";
const albumSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    cover_image: { type: String, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    created_at: { type: Date, default: Date.now },
    is_private: { type: Boolean, default: false },
});

export const Album = mongoose.model(MODEL_NAMES.ALBUM, albumSchema, MODEL_NAMES.ALBUM);

export type AlbumType = InferSchemaType<typeof albumSchema>;
export type AlbumCreationType = Omit<AlbumType, '_id'>;
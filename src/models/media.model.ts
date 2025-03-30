import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const mediaSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], required: true },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref:   MODEL_NAMES.ALBUM , required: true },
    page_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.PAGE },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    created_at: { type: Date, default: Date.now },
});

export const Media = mongoose.model(MODEL_NAMES.MEDIA, mediaSchema, MODEL_NAMES.MEDIA);

export type MediaType = InferSchemaType<typeof mediaSchema>;
export type MediaCreationType = Omit<MediaType, '_id'>;
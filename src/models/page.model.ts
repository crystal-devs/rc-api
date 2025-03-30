import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";
const pageSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: "" },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, required: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    created_at: { type: Date, default: Date.now },
});

export const Page = mongoose.model(MODEL_NAMES.PAGE, pageSchema, MODEL_NAMES.PAGE);

export type PageType = InferSchemaType<typeof pageSchema>;
export type PageCreationType = Omit<PageType, '_id'>;
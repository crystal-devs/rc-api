import mongoose, { InferSchemaType } from "mongoose";
import userModel from "./user.model";

const albumSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, "Title is required"] },
    description: { type: String, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: userModel, required: [true, "Created by is required"] },
    start_date: { type: Date, required: [true, "Start date is required"] },
    end_date: { type: Date, required: false },
    created_at: { type: Date, default: Date.now },
    is_private: { type: Boolean, default: false },
});

export default mongoose.model("Album", albumSchema, "albums");

export type AlbumType = InferSchemaType<typeof albumSchema>;
export type AlbumCreationType = Omit<AlbumType, '_id'>;
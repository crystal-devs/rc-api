import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const eventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, "Title is required"] },
    description: { type: String, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, "Created by is required"] },
    start_date: { type: Date, default: Date.now },
    end_date: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    is_private: { type: Boolean, default: false },
    cover_image: { type: String, default: "" },
    location: { type: String, default: "" },
    template: { type: String, enum: ['wedding', 'birthday', 'concert', 'corporate', 'vacation', 'custom'], default: 'custom' },
    access_code: { type: String, default: "" }
});

export const Event = mongoose.model(MODEL_NAMES.EVENT, eventSchema, MODEL_NAMES.EVENT);

export type EventType = InferSchemaType<typeof eventSchema>;
export type EventCreationType = Omit<EventType, '_id'>;
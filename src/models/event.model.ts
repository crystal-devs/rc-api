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
    access_code: { type: String, default: "" },
    
    // Sharing-related fields
    is_shared: { type: Boolean, default: false }, // Indicates if the event has any active share tokens
    share_settings: {
        restricted_to_guests: { type: Boolean, default: false }, // True if any active share token has guest restrictions
        has_password_protection: { type: Boolean, default: false }, // True if any active share token has password protection
        guest_count: { type: Number, default: 0 }, // Total number of invited guests across all active share tokens
        last_shared_at: { type: Date, default: null }, // Timestamp of the most recent share token creation
        active_share_tokens: { type: Number, default: 0 } // Count of non-revoked, non-expired share tokens
    }
});

export const Event = mongoose.model(MODEL_NAMES.EVENT, eventSchema, MODEL_NAMES.EVENT);

export type EventType = InferSchemaType<typeof eventSchema>;
export type EventCreationType = Omit<EventType, '_id'> & {
    // Make the new fields optional for creation
    is_shared?: boolean;
    share_settings?: {
        restricted_to_guests?: boolean;
        has_password_protection?: boolean;
        guest_count?: number;
        last_shared_at?: Date | null;
        active_share_tokens?: number;
    };
};
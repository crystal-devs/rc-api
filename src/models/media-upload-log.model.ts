// models/media-upload-log.model.ts - Upload Audit / Context (TTL-based)
import mongoose, { InferSchemaType, Document } from "mongoose";
import { MODEL_NAMES } from "./names";

const mediaUploadLogSchema = new mongoose.Schema({
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.MEDIA, required: true, index: true },
    ip_address: { type: String, default: "" },
    user_agent: { type: String, default: "" },
    platform: { type: String, default: "web" },
    referrer_url: { type: String, default: "" },
    upload_method: { type: String, default: "web" },
    device_info: {
        brand: { type: String, default: "" },
        model: { type: String, default: "" },
        os: { type: String, default: "" }
    },
    created_at: { type: Date, default: Date.now }
}, {
    collection: 'media_upload_logs',
    expires: 2592000 // TTL: 30 days in seconds
});

// Indexes
mediaUploadLogSchema.index({ media_id: 1, created_at: -1 });
mediaUploadLogSchema.index({ ip_address: 1 });
mediaUploadLogSchema.index({ platform: 1 });

export const MediaUploadLog = mongoose.model('MediaUploadLog', mediaUploadLogSchema, 'media_upload_logs');

// Export types
export type MediaUploadLogType = InferSchemaType<typeof mediaUploadLogSchema>;
export type MediaUploadLogDocument = Document & MediaUploadLogType;
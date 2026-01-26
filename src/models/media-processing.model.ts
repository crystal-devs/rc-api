// models/media-processing.model.ts - Processing Details (cold, optional)
import mongoose, { InferSchemaType, Document } from "mongoose";
import { MODEL_NAMES } from "./names";

const mediaProcessingSchema = new mongoose.Schema({
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.MEDIA, required: true, index: true },
    job_id: { type: String, index: true },
    retries: { type: Number, default: 0 },
    timing_ms: { type: Number, default: 0 },
    variants_generated: { type: Boolean, default: false },
    completed_at: { type: Date },
    logs: [{
        timestamp: { type: Date, default: Date.now },
        level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
        message: { type: String },
        metadata: { type: mongoose.Schema.Types.Mixed }
    }],
    error_details: { type: String, default: "" },
    lambda_version: { type: String, default: "" },
    processing_node: { type: String, default: "" }
}, {
    timestamps: true,
    collection: 'media_processing'
});

// Indexes
mediaProcessingSchema.index({ media_id: 1 }, { unique: true });
mediaProcessingSchema.index({ job_id: 1 });
mediaProcessingSchema.index({ completed_at: -1 });
mediaProcessingSchema.index({ variants_generated: 1 });

export const MediaProcessing = mongoose.model('MediaProcessing', mediaProcessingSchema, 'media_processing');

// Export types
export type MediaProcessingType = InferSchemaType<typeof mediaProcessingSchema>;
export type MediaProcessingDocument = Document & MediaProcessingType;
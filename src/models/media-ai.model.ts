// models/media-ai.model.ts - AI Analysis (cold collection)
import mongoose, { InferSchemaType, Document } from "mongoose";
import { MODEL_NAMES } from "./names";

const mediaAIModel = new mongoose.Schema({
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.MEDIA, required: true, index: true },
    tags: [{ type: String }],
    faces_detected: { type: Number, default: 0 },
    safety_flags: [{ type: String }], // inappropriate, violence, etc.
    model_version: { type: String, default: "v1" },
    analyzed_at: { type: Date, default: Date.now },
    confidence_scores: {
        type: Map,
        of: Number,
        default: () => new Map()
    }
}, {
    timestamps: true,
    collection: 'media_ai_analysis'
});

// Indexes
mediaAIModel.index({ media_id: 1, analyzed_at: -1 });
mediaAIModel.index({ tags: 1 });
mediaAIModel.index({ safety_flags: 1 });

export const MediaAI = mongoose.model('MediaAI', mediaAIModel, 'media_ai_analysis');

// Export types
export type MediaAIType = InferSchemaType<typeof mediaAIModel>;
export type MediaAIDocument = Document & MediaAIType;
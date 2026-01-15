// models/media-stats.model.ts - Media Stats (high-write counters)
import mongoose, { InferSchemaType, Document } from "mongoose";
import { MODEL_NAMES } from "./names";

const mediaStatsSchema = new mongoose.Schema({
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.MEDIA, required: true, index: true },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    last_updated: { type: Date, default: Date.now }
}, {
    collection: 'media_stats'
});

// Indexes
mediaStatsSchema.index({ media_id: 1 }, { unique: true });
mediaStatsSchema.index({ views: -1 });
mediaStatsSchema.index({ likes: -1 });

// Pre-save middleware to update last_updated
mediaStatsSchema.pre('save', function (next) {
    this.last_updated = new Date();
    next();
});

export const MediaStats = mongoose.model('MediaStats', mediaStatsSchema, 'media_stats');

// Export types
export type MediaStatsType = InferSchemaType<typeof mediaStatsSchema>;
export type MediaStatsDocument = Document & MediaStatsType;
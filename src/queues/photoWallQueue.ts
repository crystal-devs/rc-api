import { MODEL_NAMES } from "@models/names";
import mongoose from "mongoose";

// models/PhotoWallQueue.js
const photoWallQueueSchema = new mongoose.Schema({
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },
    share_token: { type: String, required: true, index: true }, // Denormalized for speed
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.MEDIA, required: true },

    // Queue position and priority
    queue_position: { type: Number, required: true },
    priority_score: { type: Number, default: 0 }, // Higher = more priority

    // Display tracking
    display_count: { type: Number, default: 0 },
    last_displayed_at: { type: Date, default: null },

    // Queue management
    added_to_queue_at: { type: Date, default: Date.now },
    is_active: { type: Boolean, default: true },

    // Image metadata cache (for performance)
    cached_url: { type: String, default: '' },
    cached_thumbnail: { type: String, default: '' },
    image_dimensions: {
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 }
    }
});

// Indexes for performance
photoWallQueueSchema.index({ share_token: 1, is_active: 1, queue_position: 1 });
photoWallQueueSchema.index({ event_id: 1, priority_score: -1 });
photoWallQueueSchema.index({ media_id: 1 }, { unique: true });

export const PhotoWallQueue = mongoose.model('PhotoWallQueue', photoWallQueueSchema);
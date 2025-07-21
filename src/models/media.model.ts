import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// ADD: Metadata schema for rich media info
const metadataSchema = new mongoose.Schema({
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    duration: { type: Number, default: 0 }, // For videos in seconds
    device_info: {
        brand: { type: String, default: "" },
        model: { type: String, default: "" },
        os: { type: String, default: "" }
    },
    location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        address: { type: String, default: "" }
    },
    timestamp: { type: Date, default: null }, // When photo was actually taken
    // camera_settings: {
    //     iso: { type: Number, default: null },
    //     aperture: { type: String, default: "" },
    //     shutter_speed: { type: String, default: "" }
    // }
}, { _id: false });

// ADD: Processing status for uploads
const processingSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    thumbnails_generated: { type: Boolean, default: false },
    compressed_versions: [{
        quality: { type: String, enum: ['low', 'medium', 'high'] },
        url: { type: String },
        size_mb: { type: Number }
    }],
    ai_analysis: {
        completed: { type: Boolean, default: false },
        content_score: { type: Number, default: 0 }, // 0-100 safety score
        tags: [{ type: String }], // Auto-generated tags
        faces_detected: { type: Number, default: 0 }
    }
}, { _id: false });

// ADD: Approval workflow
const approvalSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'auto_approved'], default: 'pending' },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
    approved_at: { type: Date, default: null },
    rejection_reason: { type: String, default: "" },
    auto_approval_reason: { type: String, enum: ['invited_guest', 'ai_safe', 'host_setting'], default: null }
}, { _id: false });

const mediaSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },

    // Core media info
    url: { type: String, required: true },
    public_id: { type: String, default: "" }, // For ImageKit/Cloudinary
    type: { type: String, enum: ["image", "video"], required: true },

    // Relationships
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, required: true },
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },

    // File info
    original_filename: { type: String, default: "" },
    size_mb: { type: Number, default: 0 },
    format: { type: String, default: "" }, // jpg, png, mp4, etc.

    // ADD: Processing and optimization
    processing: { type: processingSchema, default: () => ({}) },

    // ADD: Rich metadata
    metadata: { type: metadataSchema, default: () => ({}) },

    // Updated approval system
    approval: { type: approvalSchema, default: () => ({}) },

    // Legacy field (keep for backward compatibility)
    approval_status: { type: Boolean, default: true },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },

    // ADD: Engagement metrics
    stats: {
        views: { type: Number, default: 0 },
        downloads: { type: Number, default: 0 },
        shares: { type: Number, default: 0 },
        likes: { type: Number, default: 0 },
        comments_count: { type: Number, default: 0 }
    },

    // ADD: Content safety
    content_flags: {
        inappropriate: { type: Boolean, default: false },
        duplicate: { type: Boolean, default: false },
        low_quality: { type: Boolean, default: false },
        ai_flagged: { type: Boolean, default: false }
    },

    // ADD: Upload context (for analytics)
    upload_context: {
        method: { type: String, enum: ['web', 'mobile', 'api'], default: 'web' },
        ip_address: { type: String, default: "" },
        user_agent: { type: String, default: "" },
        share_token_used: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.SHARE_TOKEN, default: null }
    },

    // Timestamps
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Optimized indexes
mediaSchema.index({ event_id: 1, album_id: 1 });
mediaSchema.index({ uploaded_by: 1, created_at: -1 });
mediaSchema.index({ "approval.status": 1, event_id: 1 });
mediaSchema.index({ "processing.status": 1 });
mediaSchema.index({ type: 1, event_id: 1 });
mediaSchema.index({ "content_flags.inappropriate": 1 });
mediaSchema.index({ created_at: -1 }); // For recent uploads

// ADD: Pre-save middleware for auto-approval logic
mediaSchema.pre('save', function (next) {
    // Implement the auto-approval logic we discussed
    if (this.isNew && this.approval.status === 'pending') {
        // Check if uploader is invited guest (implement your logic here)
        // For now, setting auto-approval for invited guests
        this.approval.status = 'auto_approved';
        this.approval.auto_approval_reason = 'invited_guest';
        this.approval.approved_at = new Date();
    }
    this.updated_at = new Date();
    next();
});

export const Media = mongoose.model(MODEL_NAMES.MEDIA, mediaSchema, MODEL_NAMES.MEDIA);

export type MediaType = InferSchemaType<typeof mediaSchema>;
export type MediaCreationType = Omit<MediaType, '_id'>;
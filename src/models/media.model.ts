// models/Media.ts
import mongoose, { InferSchemaType, Document } from "mongoose";
import { MODEL_NAMES } from "./names";

// Canonical media metadata (authoritative)
const originalMediaSchema = new mongoose.Schema({
    public_id: { type: String, required: true }, // S3 / CDN identifier
    filename: { type: String, default: "" }, // Original filename from uploader
    width: { type: Number, required: false }, // Images only (Optional - application validated)
    height: { type: Number, required: false }, // Images only (Optional - application validated)
    duration: { type: Number, required: false }, // Videos only (seconds)
    format: { type: String, required: true }, // Flex string, validated in application
    size_mb: { type: Number, required: true }
}, { _id: false });

// Variant reference (just public_id, geometry derived from original)
const variantRefSchema = new mongoose.Schema({
    public_id: { type: String, required: true }
}, { _id: false });

// Image variants (optional presence)
const imageVariantsSchema = new mongoose.Schema({
    small: { type: variantRefSchema, required: false },
    medium: { type: variantRefSchema, required: false },
    large: { type: variantRefSchema, required: false }
}, { _id: false });

// Video transcodes (optional presence)
const videoTranscodesSchema = new mongoose.Schema({
    p360: { type: variantRefSchema, required: false },   // 360p
    p720: { type: variantRefSchema, required: false },   // 720p
    p1080: { type: variantRefSchema, required: false }   // 1080p
}, { _id: false });

// Video thumbnails (optional presence)
const videoThumbnailsSchema = new mongoose.Schema({
    poster: { type: variantRefSchema, required: false },   // Single frame poster
    preview: { type: variantRefSchema, required: false }   // Animated preview (optional)
}, { _id: false });

// Unified variants schema (supports both images and videos)
const mediaVariantsSchema = new mongoose.Schema({
    // Image variants
    images: { type: imageVariantsSchema, required: false },
    // Video variants
    videos: { type: videoTranscodesSchema, required: false },
    thumbnails: { type: videoThumbnailsSchema, required: false }
}, { _id: false });

// Owner (unified user/guest reference)
const ownerSchema = new mongoose.Schema({
    type: { type: String, enum: ['registered_user', 'guest'], required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: false },
    guest_id: { type: String, required: false },
    display_name: { type: String, required: false } // Snapshot for guests
}, { _id: false });

// Enhanced processing schema
const processingSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    stage: { type: String, enum: ['queued', 'uploading', 'variants', 'completed'], default: 'uploading' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    error: { type: String, default: "" },
    // Extended processing fields (temporarily kept for compatibility)
    job_id: { type: String, required: false },
    retry_count: { type: Number, default: 0 },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null }
}, { _id: false });

// Approval (simplified)
const approvalSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'hidden', 'auto_approved'], default: 'pending' },
    reason: { type: String, default: "" }
}, { _id: false });

// Main Media Schema (Universal - Images & Videos)
const mediaSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },

    // Core identity
    upload_id: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ["image", "video"], required: true },

    // Relationships
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, required: true },

    // Optional sub-event (function) this media belongs to. null = the whole
    // event / main gallery. References an embedded event.sub_events[]._id — kept
    // nullable so existing single-function events need no migration. (Phase 1)
    sub_event_id: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Owner (unified)
    owner: { type: ownerSchema, required: true },

    // Canonical media metadata (supports both images and videos)
    original: { type: originalMediaSchema, required: true },

    // Unified variants (images, videos, thumbnails)
    variants: { type: mediaVariantsSchema, default: () => ({}) },

    // Processing state
    processing: { type: processingSchema, default: () => ({}) },

    // Approval
    approval: { type: approvalSchema, default: () => ({}) },

    // Host curation (Phase 3): a starred/favorited photo. Powers the favorites
    // filter and seeds best-shot selection for the future keepsake album.
    is_favorite: { type: Boolean, default: false },

    // Face Metadata (Local Cache)
    faces: [{
        faceId: { type: String, required: true },
        confidence: { type: Number, required: true },
        boundingBox: {
            Width: Number,
            Height: Number,
            Left: Number,
            Top: Number
        },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: false } // Linked User
    }],

    // Timestamps
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null, index: true },
    deleteGroup: { type: String, required: false, select: false }, // For bulk deletion grouping
});

// Pre-save middleware (simplified)
mediaSchema.pre('save', function (next) {
    this.updated_at = new Date();
    next();
});

// Virtual for uploader display name
mediaSchema.virtual('uploader_display_name').get(function (this: any) {
    if (this.owner.type === 'registered_user' && this.owner.user_id) {
        // Would need to populate user, but for now return placeholder
        return 'User';
    } else if (this.owner.type === 'guest' && this.owner.guest_id) {
        return 'Anonymous Guest';
    }
    return 'Unknown';
});

// Virtual for best media public_id reference
mediaSchema.virtual('best_public_id').get(function (this: any) {
    // For backward compatibility, return original public_id if no variants
    if (this.type === 'image') {
        if (!this.variants?.images?.medium) {
            return this.original?.public_id || '';
        }
        return this.variants.images.medium.public_id;
    } else if (this.type === 'video') {
        // For videos, return the highest quality transcode available
        if (this.variants?.videos?.p1080) return this.variants.videos.p1080.public_id;
        if (this.variants?.videos?.p720) return this.variants.videos.p720.public_id;
        if (this.variants?.videos?.p360) return this.variants.videos.p360.public_id;
        return this.original?.public_id || '';
    }
    return this.original?.public_id || '';
});

// Methods
interface IMediaMethods {
    updateProgress(stage: 'uploading' | 'variants' | 'completed', progress: number): Promise<this>;
    getProgressInfo(): { stage: string; progress: number; status: string; error: string };
    canContactUploader(): boolean;
    getOptimizedUrl(size?: 'small' | 'medium' | 'large'): string;
    isProcessingComplete(): boolean;
}

export type MediaDocument = Document & InferSchemaType<typeof mediaSchema> & IMediaMethods;

// Methods implementation
mediaSchema.methods.canContactUploader = function (this: MediaDocument) {
    return this.owner.type === 'registered_user' && !!this.owner.user_id;
};

mediaSchema.methods.getOptimizedUrl = function (
    this: MediaDocument,
    size: 'small' | 'medium' | 'large' = 'medium'
): string {
    if (this.type === 'image') {
        if (!this.variants?.images || !this.variants.images[size]) {
            return this.original?.public_id || '';
        }
        return this.variants.images[size].public_id;
    } else if (this.type === 'video') {
        // For videos, map size to quality
        const qualityMap = {
            small: 'p360',
            medium: 'p720',
            large: 'p1080'
        };
        const quality = qualityMap[size] as keyof typeof this.variants.videos;
        if (!this.variants?.videos || !this.variants.videos[quality]) {
            return this.original?.public_id || '';
        }
        return this.variants.videos[quality].public_id;
    }
    return this.original?.public_id || '';
};

mediaSchema.methods.isProcessingComplete = function (this: MediaDocument): boolean {
    return this.processing?.status === 'completed';
};

mediaSchema.methods.updateProgress = async function (this: MediaDocument, stage: 'uploading' | 'variants' | 'completed', progress: number) {
    this.processing.stage = stage;
    this.processing.progress = progress;
    await this.save();
    return this;
};

mediaSchema.methods.getProgressInfo = function (this: MediaDocument) {
    return {
        stage: this.processing.stage,
        progress: this.processing.progress,
        status: this.processing.status,
        error: this.processing.error
    };
};

// Indexes
mediaSchema.index({ event_id: 1, album_id: 1 });
mediaSchema.index({ event_id: 1, created_at: -1 }); // Optimized for Event Feed
mediaSchema.index({ event_id: 1, sub_event_id: 1, created_at: -1 }); // Per-function gallery (Phase 1)
mediaSchema.index({ event_id: 1, is_favorite: 1, created_at: -1 }); // Favorites filter (Phase 3)
mediaSchema.index({ album_id: 1, created_at: -1 }); // Optimized for album view
mediaSchema.index({ "owner.user_id": 1, created_at: -1 });
mediaSchema.index({ "owner.guest_id": 1, event_id: 1 });
mediaSchema.index({ "processing.status": 1 });
mediaSchema.index({ created_at: -1 });

// Export model
export const Media = mongoose.model<MediaDocument>(MODEL_NAMES.MEDIA, mediaSchema, MODEL_NAMES.MEDIA);

// Helper to create guest uploader info structure
export const createGuestUploaderInfo = (guestInfo: any, isContext: boolean = false) => {
    return {
        name: guestInfo.name || 'Anonymous',
        email: guestInfo.email || '',
        phone: guestInfo.phone || '',
        session_id: guestInfo.sessionId || '',
        device_fingerprint: guestInfo.deviceFingerprint || '',
        platform_info: guestInfo.platformInfo || {}
    };
};

// Export types
export type MediaType = InferSchemaType<typeof mediaSchema>;
export type MediaCreationType = Omit<MediaType, '_id'>;

// Processing and approval status types
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ProcessingStage = 'queued' | 'uploading' | 'variants' | 'completed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'hidden' | 'auto_approved';
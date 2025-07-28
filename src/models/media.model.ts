import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// ADD: Guest uploader info schema
const guestUploaderSchema = new mongoose.Schema({
    // Guest identification
    guest_id: { type: String, required: true }, // Generated unique ID for this guest
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },

    // Session/device tracking
    session_id: { type: String, default: "" }, // Browser session or device fingerprint
    device_fingerprint: { type: String, default: "" }, // For tracking same device uploads

    // Upload tracking
    upload_method: { type: String, enum: ['web', 'mobile', 'qr_scan', 'direct_link'], default: 'web' },
    total_uploads: { type: Number, default: 1 }, // How many files this guest has uploaded
    first_upload_at: { type: Date, default: Date.now },

    // Optional social/platform info
    platform_info: {
        source: { type: String, default: "" }, // "instagram_share", "whatsapp_link", etc.
        referrer: { type: String, default: "" }
    }
}, { _id: false });

// Existing schemas remain the same...
const metadataSchema = new mongoose.Schema({
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
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
    timestamp: { type: Date, default: null },
}, { _id: false });

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
        content_score: { type: Number, default: 0 },
        tags: [{ type: String }],
        faces_detected: { type: Number, default: 0 }
    }
}, { _id: false });

const approvalSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'auto_approved', 'hidden'], default: 'pending' },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
    approved_at: { type: Date, default: null },
    rejection_reason: { type: String, default: "" },
    auto_approval_reason: {
        type: String,
        enum: ['authenticated_user', 'guest_auto_approve', 'ai_safe', 'host_setting'],
        default: null
    }
}, { _id: false });

// UPDATED Media Schema
const mediaSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },

    // Core media info
    url: { type: String, required: true },
    public_id: { type: String, default: "" },
    type: { type: String, enum: ["image", "video"], required: true },

    // Relationships
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, required: true },
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },

    // UPDATED: Make uploaded_by optional for guest uploads
    uploaded_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        required: false, // Changed to false
        default: null
    },

    // NEW: Guest uploader info (only populated for guest uploads)
    guest_uploader: {
        type: guestUploaderSchema,
        default: null
    },

    // ADD: Uploader type for easy filtering
    uploader_type: {
        type: String,
        enum: ['registered_user', 'guest'],
        required: true,
        default: function () {
            return this.uploaded_by ? 'registered_user' : 'guest';
        }
    },

    // File info
    original_filename: { type: String, default: "" },
    size_mb: { type: Number, default: 0 },
    format: { type: String, default: "" },

    // Processing and optimization
    processing: { type: processingSchema, default: () => ({}) },

    // Rich metadata
    metadata: { type: metadataSchema, default: () => ({}) },

    // Approval system
    approval: { type: approvalSchema, default: () => ({}) },

    // Legacy fields (keep for backward compatibility)
    approval_status: { type: Boolean, default: true },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },

    // Engagement metrics
    stats: {
        views: { type: Number, default: 0 },
        downloads: { type: Number, default: 0 },
        shares: { type: Number, default: 0 },
        likes: { type: Number, default: 0 },
        comments_count: { type: Number, default: 0 }
    },

    // Content safety
    content_flags: {
        inappropriate: { type: Boolean, default: false },
        duplicate: { type: Boolean, default: false },
        low_quality: { type: Boolean, default: false },
        ai_flagged: { type: Boolean, default: false }
    },

    // UPDATED: Upload context (removed share_token_used since one event = one token)
    upload_context: {
        method: { type: String, enum: ['web', 'mobile', 'api', 'guest_upload'], default: 'web' },
        ip_address: { type: String, default: "" },
        user_agent: { type: String, default: "" },
        upload_session_id: { type: String, default: "" }, // Track upload session
        referrer_url: { type: String, default: "" },
        platform: { type: String, default: "web" } // web, ios, android
    },

    // Timestamps
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// UPDATED: Indexes for guest uploads
mediaSchema.index({ event_id: 1, album_id: 1 });
mediaSchema.index({ uploaded_by: 1, created_at: -1 });
mediaSchema.index({ "guest_uploader.guest_id": 1, event_id: 1 }); // NEW: For guest uploads
mediaSchema.index({ "guest_uploader.email": 1, event_id: 1 }); // NEW: For guest lookup by email
mediaSchema.index({ "approval.status": 1, event_id: 1 });
mediaSchema.index({ "processing.status": 1 });
mediaSchema.index({ type: 1, event_id: 1 });
mediaSchema.index({ uploader_type: 1, event_id: 1 }); // NEW: For filtering by uploader type
mediaSchema.index({ "content_flags.inappropriate": 1 });
mediaSchema.index({ created_at: -1 });

mediaSchema.pre('save', function (next) {
    // Set uploader_type based on uploaded_by and guest_uploader
    if (this.isNew) {
        // Determine uploader type based on the data
        if (this.uploaded_by && !this.guest_uploader) {
            this.uploader_type = 'registered_user';
        } else if (!this.uploaded_by && this.guest_uploader) {
            this.uploader_type = 'guest';
        }

        // REMOVED: Auto-approval logic from pre-save middleware
        // The service should handle all approval logic explicitly
        // Don't override approval status set by the service

        console.log('💾 Saving media with:', {
            uploader_type: this.uploader_type,
            approval_status: this.approval?.status,
            has_uploaded_by: !!this.uploaded_by,
            has_guest_uploader: !!this.guest_uploader
        });
    }

    this.updated_at = new Date();
    next();
});

// UPDATED: Add virtual for uploader display name with proper typing
mediaSchema.virtual('uploader_display_name').get(function (this: any) {
    if (this.uploader_type === 'registered_user' && this.uploaded_by) {
        if (
            typeof this.uploaded_by === 'object' &&
            'name' in this.uploaded_by &&
            typeof this.uploaded_by.name === 'string'
        ) {
            return this.uploaded_by.name;
        }
        return 'User'; // fallback if not populated
    } else if (this.uploader_type === 'guest' && this.guest_uploader) {
        return this.guest_uploader.name || 'Anonymous Guest';
    }
    return 'Unknown';
});


// ADD: Instance method to check if uploader can be contacted
mediaSchema.methods.canContactUploader = function () {
    if (this.uploader_type === 'registered_user') {
        return true; // Can contact through platform
    } else if (this.uploader_type === 'guest' && this.guest_uploader) {
        return !!(this.guest_uploader.email || this.guest_uploader.phone);
    }
    return false;
};

export const Media = mongoose.model(MODEL_NAMES.MEDIA, mediaSchema, MODEL_NAMES.MEDIA);

export type MediaType = InferSchemaType<typeof mediaSchema>;
export type MediaCreationType = Omit<MediaType, '_id'>;

// ============= HELPER FUNCTIONS =============

// Generate unique guest ID
export const generateGuestId = (guestInfo?: { name?: string; email?: string; device?: string }): string => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    if (guestInfo?.email) {
        // Use email hash for consistent guest ID
        const emailHash = guestInfo.email.toLowerCase().split('@')[0].substring(0, 4);
        return `guest_${emailHash}_${random}`;
    } else if (guestInfo?.name) {
        // Use name-based ID
        const nameHash = guestInfo.name.toLowerCase().replace(/\s+/g, '').substring(0, 4);
        return `guest_${nameHash}_${random}`;
    } else {
        // Anonymous guest
        return `guest_anon_${timestamp}_${random}`;
    }
};

// Create guest uploader info
export const createGuestUploaderInfo = (
    guestData: {
        name?: string;
        email?: string;
        phone?: string;
        sessionId?: string;
        deviceFingerprint?: string;
        uploadMethod?: string;
        platformInfo?: any;
    },
    isFirstUpload: boolean = true
) => {
    const guestId = generateGuestId({
        name: guestData.name,
        email: guestData.email,
        device: guestData.deviceFingerprint
    });

    return {
        guest_id: guestId,
        name: guestData.name || '',
        email: guestData.email || '',
        phone: guestData.phone || '',
        session_id: guestData.sessionId || '',
        device_fingerprint: guestData.deviceFingerprint || '',
        upload_method: guestData.uploadMethod || 'web',
        total_uploads: isFirstUpload ? 1 : undefined, // Will be calculated if not first upload
        first_upload_at: isFirstUpload ? new Date() : undefined,
        platform_info: guestData.platformInfo || {}
    };
};
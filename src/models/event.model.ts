import mongoose, { InferSchemaType } from 'mongoose';
import { MODEL_NAMES } from './names';
import { generateSecureToken } from '../utils/secure-token.util';

// Nested schemas
const locationSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    address: { type: String, default: '' },
    coordinates: { type: [Number], default: [] }, // [latitude, longitude]
}, { _id: false });

const coverImageSchema = new mongoose.Schema({
    url: { type: String, default: '' },
    public_id: { type: String, default: '' },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
    thumbnail_url: { type: String, default: '' },
    // Cover image dimensions and focal point
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    focal_x: { type: Number, default: 50 }, // Percentage (0-100)
    focal_y: { type: Number, default: 50 }, // Percentage (0-100)
}, { _id: false });

// New styling configuration schema
const stylingConfigSchema = new mongoose.Schema({
    // Cover styling
    cover: {
        template_id: { type: Number, default: 0 }, // Template/style variant
        type: { type: Number, default: 0 }, // Cover display type
    },

    // Gallery layout and appearance
    gallery: {
        layout_id: { type: Number, default: 1 }, // 1: masonry (default), 2: horizontal/rows (0 is deprecated)
        grid_spacing: { type: Number, default: 0 }, // 0: tight, 1: normal, 2: loose
        thumbnail_size: { type: Number, default: 1 }, // 0: small, 1: medium, 2: large
    },

    // Theme and typography
    theme: {
        theme_id: { type: Number, default: 8 }, // Theme identifier
        fontset_id: { type: Number, default: 0 }, // Typography set
    },

    // Navigation and interaction
    navigation: {
        style_id: { type: Number, default: 0 }, // Navigation style
    },

    // Localization
    language: { type: String, default: 'en' },
}, { _id: false });

const shareSettingsSchema = new mongoose.Schema({
    is_active: { type: Boolean, default: true },
    // bcrypt hash — select:false so it can never leak into API responses;
    // comparison sites must opt in with .select('+share_settings.password')
    password: { type: String, default: null, select: false },
    // Safe-to-expose flag so the host UI can show "PIN is set" without the hash
    has_password: { type: Boolean, default: false },
    expires_at: { type: Date, default: null },
}, { _id: false });

const permissionsSchema = new mongoose.Schema({
    can_view: { type: Boolean, default: true },
    can_upload: { type: Boolean, default: false },
    can_download: { type: Boolean, default: false },
    allowed_media_types: {
        images: { type: Boolean, default: true },
        videos: { type: Boolean, default: true },
    },
    require_approval: { type: Boolean, default: true },
    max_file_size_mb: { type: Number }
}, { _id: false });

// Sub-events: the India-native multi-function structure (e.g. haldi / sangeet /
// wedding / reception). Embedded on the event because functions are bounded
// (<=~10), always fetched with the event, and avoid N+1 lookups. Media links to
// a function via media.sub_event_id (null = the whole event / main gallery), so
// existing single-function events are untouched and need no migration.
// Progressive disclosure: only surfaced for templates that need it (e.g.
// wedding). See docs/ROADMAP.md Phase 1.
const subEventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    date: { type: Date, default: null },
    // Display order in the function timeline; ties broken by date.
    order: { type: Number, default: 0 },
});

// Main event schema
const eventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, 'Title is required'] },
    description: { type: String, default: '' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, 'Created by is required'] },

    // Share token for general event access
    share_token: { type: String, sparse: true },
    share_settings: { type: shareSettingsSchema, default: () => ({}) },

    // Permissions for users with the share token
    permissions: { type: permissionsSchema, default: () => ({}) },

    // Privacy settings for access control
    visibility: {
        type: String,
        enum: ['anyone_with_link', 'invited_only', 'private'],
        default: 'private',
    },

    // Event details
    start_date: { type: Date, default: Date.now },
    end_date: { type: Date, default: null },
    timezone: { type: String, default: 'Asia/Kolkata' },
    location: { type: locationSchema, default: () => ({}) },
    cover_image: { type: coverImageSchema, default: () => ({}) },
    template: {
        type: String,
        enum: ['wedding', 'birthday', 'concert', 'corporate', 'vacation', 'custom'],
        default: 'custom',
    },

    // Multi-function structure (sub-events). Empty by default so casual events
    // (birthday/trip) never see it. See docs/ROADMAP.md Phase 1.
    sub_events: { type: [subEventSchema], default: [] },

    // DPDP: biometric processing is opt-in per event (default OFF). Face
    // indexing on upload, face login, and selfie search all require this.
    face_recognition: {
        enabled: { type: Boolean, default: false },
        consent_version: { type: String, default: 'v1' },
        // Days after end_date before the face collection is auto-deleted
        retention_days: { type: Number, default: 60 },
        // Set by the retention sweep / event deletion once the collection is gone
        collection_deleted_at: { type: Date, default: null },
    },

    // Styling configuration - Clean and organized
    styling_config: { type: stylingConfigSchema, default: () => ({}) },

    // Basic stats with pending_approval
    stats: {
        total_participants: { type: Number, default: 0 },
        creators_count: { type: Number, default: 1 },
        co_hosts_count: { type: Number, default: 0 },
        guests_count: { type: Number, default: 0 },
        photos: { type: Number, default: 0 },
        videos: { type: Number, default: 0 },
        total_size_mb: { type: Number, default: 0 },
        pending_approval: { type: Number, default: 0 },
        pending_invitations: { type: Number, default: 0 }
    },

    photowall_settings: {
        isEnabled: { type: Boolean, default: true },
        displayMode: {
            type: String,
            enum: ['slideshow', 'grid', 'mosaic'],
            default: 'slideshow'
        },
        transitionDuration: {
            type: Number,
            default: 5000,
            min: 2000,
            max: 30000
        },
        showUploaderNames: { type: Boolean, default: false },
        autoAdvance: { type: Boolean, default: true },
        newImageInsertion: {
            type: String,
            enum: ['immediate', 'after_current', 'end_of_queue', 'smart_priority'],
            default: 'after_current'
        }
    },

    // Timestamps
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    archived_at: { type: Date, default: null },
});

// Indexes for performance
eventSchema.index({ created_by: 1, archived_at: 1 });
eventSchema.index({ share_token: 1 }, { unique: true, sparse: true });
eventSchema.index({ 'co_host_invite_token.token': 1 }, { unique: true, sparse: true });
eventSchema.index({ visibility: 1 });
eventSchema.index({ start_date: 1 });
eventSchema.index({ 'co_hosts.user_id': 1, 'co_hosts.status': 1 });

// Pre-save middleware to generate tokens
eventSchema.pre('save', function (next) {
    if (this.isNew) {
        // Validate created_by
        if (!this.created_by) {
            console.error('pre(save): created_by is undefined');
            return next(new Error('created_by is required before generating co_host_invite_token'));
        }

        // Generate share_token (crypto-grade: this token alone grants gallery access)
        if (!this.share_token) {
            this.share_token = generateSecureToken('evt');
        }

    }
    this.updated_at = new Date();
    next();
});

export const Event = mongoose.model(MODEL_NAMES.EVENT, eventSchema, MODEL_NAMES.EVENT);

export type EventType = InferSchemaType<typeof eventSchema> & {
    user_role?: string;
    user_permissions?: Record<string, boolean> | null;
};
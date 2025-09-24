import mongoose, { InferSchemaType } from 'mongoose';
import { MODEL_NAMES } from './names';

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
        layout_id: { type: Number, default: 1 }, // 0: grid, 1: masonry, 2: justified, etc.
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
    password: { type: String, default: null },
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

// Main event schema
const eventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, 'Title is required'] },
    description: { type: String, default: '' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, 'Created by is required'] },

    // Share token for general event access
    share_token: { type: String, unique: true, sparse: true },
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

        // Generate share_token
        if (!this.share_token) {
            this.share_token = `evt_${Math.random().toString(36).slice(2, 8)}`;
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
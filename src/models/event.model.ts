import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Define nested schemas
const locationSchema = new mongoose.Schema({
    name: { type: String, default: "" },
    address: { type: String, default: "" },
    coordinates: { type: [Number], default: [] }, // [latitude, longitude]
}, { _id: false });

const coverImageSchema = new mongoose.Schema({
    url: { type: String, default: "" },
    public_id: { type: String, default: "" },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
    thumbnail_url: { type: String, default: "" },
    compressed_url: { type: String, default: "" }
}, { _id: false });

// Co-host invitation management with single token approach
const coHostInviteSchema = new mongoose.Schema({
    token: { type: String, unique: true, sparse: true, index: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
    is_active: { type: Boolean, default: true },
    max_uses: { type: Number, default: 10 },
    used_count: { type: Number, default: 0 }
}, { _id: false });

// Simplified co-host management
const coHostSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'removed'],
        default: 'pending'
    },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
    permissions: {
        manage_content: { type: Boolean, default: true },
        manage_guests: { type: Boolean, default: true },
        manage_settings: { type: Boolean, default: false },
        approve_content: { type: Boolean, default: true }
    }
}, { _id: false });

// Anonymous session tracking for unlisted events
const anonymousSessionSchema = new mongoose.Schema({
    session_id: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    ip_address: { type: String, required: true },
    first_seen: { type: Date, default: Date.now },
    last_seen: { type: Date, default: Date.now },
    uploaded_content: {
        photos: { type: Number, default: 0 },
        videos: { type: Number, default: 0 },
        comments: { type: Number, default: 0 }
    },
    grace_period_expires: { type: Date, default: null },
    linked_user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
    content_transferred: { type: Boolean, default: false }
}, { _id: false });

const guestManagementSchema = new mongoose.Schema({
    require_approval: { type: Boolean, default: true },
    max_guests: { type: Number, default: 500 },
    allow_anonymous: { type: Boolean, default: false },
    auto_approve_invited: { type: Boolean, default: true },

    // Handle anonymous user transitions
    anonymous_transition_policy: {
        type: String,
        enum: ['block_all', 'grace_period', 'force_login'],
        default: 'grace_period'
    },
    grace_period_hours: { type: Number, default: 24 },

    // Content handling for anonymous users
    anonymous_content_policy: {
        type: String,
        enum: ['preserve_and_transfer', 'preserve_as_anonymous', 'delete_on_expire'],
        default: 'preserve_and_transfer'
    }
}, { _id: false });

const contentControlsSchema = new mongoose.Schema({
    allow_downloads: { type: Boolean, default: true },
    allow_sharing: { type: Boolean, default: false },
    require_watermark: { type: Boolean, default: false },
    approval_mode: {
        type: String,
        enum: ['auto', 'manual', 'ai_assisted'],
        default: 'auto'
    },
    allowed_media_types: {
        images: { type: Boolean, default: true },
        videos: { type: Boolean, default: true }
    },
    auto_compress_uploads: { type: Boolean, default: true },
    max_file_size_mb: { type: Number, default: 50 }
}, { _id: false });

const privacySchema = new mongoose.Schema({
    visibility: {
        type: String,
        enum: ['unlisted', 'restricted', 'private'],
        default: 'private'
    },
    guest_management: { type: guestManagementSchema, default: () => ({}) },
    content_controls: { type: contentControlsSchema, default: () => ({}) }
}, { _id: false });

// Simplified sharing stats
const sharingStatsSchema = new mongoose.Schema({
    total_shares: { type: Number, default: 0 },
    qr_scans: { type: Number, default: 0 }
}, { _id: false });

const engagementStatsSchema = new mongoose.Schema({
    total_views: { type: Number, default: 0 },
    unique_viewers: { type: Number, default: 0 },
    average_session_duration: { type: Number, default: 0 },
    last_activity: { type: Date, default: null }
}, { _id: false });

// Main event schema
const eventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, "Title is required"] },
    description: { type: String, default: "" },
    event_code: { type: String, unique: true, sparse: true, index: true },

    // Core event data
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, "Created by is required"] },

    // Co-host management
    co_hosts: [coHostSchema],
    co_host_invite: { type: coHostInviteSchema, default: null },

    start_date: { type: Date, default: Date.now },
    end_date: { type: Date, default: null },
    timezone: { type: String, default: "Asia/Kolkata" },
    location: { type: locationSchema, default: () => ({}) },

    // Visual and categorization
    cover_image: { type: coverImageSchema, default: () => ({}) },
    template: {
        type: String,
        enum: ['wedding', 'birthday', 'concert', 'corporate', 'vacation', 'custom', 'mehendi', 'engagement', 'reception'],
        default: 'custom'
    },

    privacy: { type: privacySchema, default: () => ({}) },

    // Default permissions for new guests
    default_guest_permissions: {
        view: { type: Boolean, default: true },
        upload: { type: Boolean, default: false },
        download: { type: Boolean, default: false },
        share: { type: Boolean, default: false },
        create_albums: { type: Boolean, default: false }
    },

    // Anonymous participants tracking (for unlisted events)
    anonymous_sessions: [anonymousSessionSchema],

    // Simplified statistics
    stats: {
        participants: {
            total: { type: Number, default: 0 },
            co_hosts: { type: Number, default: 0 },
            anonymous_sessions: { type: Number, default: 0 },
            registered_users: { type: Number, default: 0 }
        },
        content: {
            photos: { type: Number, default: 0 },
            videos: { type: Number, default: 0 },
            total_size_mb: { type: Number, default: 0 },
            comments: { type: Number, default: 0 },
            pending_approval: { type: Number, default: 0 }
        },
        engagement: { type: engagementStatsSchema, default: () => ({}) },
        sharing: { type: sharingStatsSchema, default: () => ({}) }
    },

    // Metadata
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    archived_at: { type: Date, default: null },
    featured: { type: Boolean, default: false }
});

// Essential indexes only
eventSchema.index({ created_by: 1, archived_at: 1 });
eventSchema.index({ event_code: 1 }, { unique: true, sparse: true });
eventSchema.index({ "privacy.visibility": 1, featured: 1 });
eventSchema.index({ start_date: 1, "privacy.visibility": 1 });
eventSchema.index({ "co_host_invite.token": 1 });
eventSchema.index({ "co_hosts.user_id": 1, "co_hosts.status": 1 });
eventSchema.index({ "anonymous_sessions.session_id": 1 });

export const Event = mongoose.model(MODEL_NAMES.EVENT, eventSchema, MODEL_NAMES.EVENT);

// Export type for TypeScript
export type EventType = InferSchemaType<typeof eventSchema>;
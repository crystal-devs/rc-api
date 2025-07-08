import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Define nested schemas
const locationSchema = new mongoose.Schema({
    name: { type: String, default: "" },
    address: { type: String, default: "" },
    coordinates: { type: [Number], default: [] } // [latitude, longitude]
}, { _id: false });

const coverImageSchema = new mongoose.Schema({
    url: { type: String, default: "" },
    public_id: { type: String, default: "" },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null }
}, { _id: false });

const albumSchema = new mongoose.Schema({
    id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM },
    name: { type: String, required: true },
    cover_photo: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.MEDIA, default: null },
    photo_count: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
}, { _id: false });

const guestManagementSchema = new mongoose.Schema({
    anyone_can_invite: { type: Boolean, default: false },
    require_approval: { type: Boolean, default: true },
    auto_approve_domains: { type: [String], default: [] },
    max_guests: { type: Number, default: 500 },
    allow_anonymous: { type: Boolean, default: false }
}, { _id: false });

const contentControlsSchema = new mongoose.Schema({
    allow_downloads: { type: Boolean, default: true },
    allow_sharing: { type: Boolean, default: false },
    require_watermark: { type: Boolean, default: false },
    content_moderation: { type: String, enum: ['off', 'manual', 'auto'], default: 'auto' }
}, { _id: false });

const privacySchema = new mongoose.Schema({
    visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'private' },
    discoverable: { type: Boolean, default: false },
    guest_management: { type: guestManagementSchema, default: () => ({}) },
    content_controls: { type: contentControlsSchema, default: () => ({}) }
}, { _id: false });

const defaultGuestPermissionsSchema = new mongoose.Schema({
    view: { type: Boolean, default: true },
    upload: { type: Boolean, default: false },
    download: { type: Boolean, default: false },
    comment: { type: Boolean, default: true },
    share: { type: Boolean, default: false },
    create_albums: { type: Boolean, default: false }
}, { _id: false });

const participantsStatsSchema = new mongoose.Schema({
    total: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    pending_invites: { type: Number, default: 0 },
    co_hosts: { type: Number, default: 0 }
}, { _id: false });

const contentStatsSchema = new mongoose.Schema({
    photos: { type: Number, default: 0 },
    videos: { type: Number, default: 0 },
    total_size_mb: { type: Number, default: 0 },
    comments: { type: Number, default: 0 }
}, { _id: false });

const engagementStatsSchema = new mongoose.Schema({
    total_views: { type: Number, default: 0 },
    unique_viewers: { type: Number, default: 0 },
    average_session_duration: { type: Number, default: 0 },
    last_activity: { type: Date, default: null }
}, { _id: false });

const sharingStatsSchema = new mongoose.Schema({
    active_tokens: { type: Number, default: 0 },
    total_shares: { type: Number, default: 0 },
    external_shares: { type: Number, default: 0 }
}, { _id: false });

const statsSchema = new mongoose.Schema({
    participants: { type: participantsStatsSchema, default: () => ({}) },
    content: { type: contentStatsSchema, default: () => ({}) },
    engagement: { type: engagementStatsSchema, default: () => ({}) },
    sharing: { type: sharingStatsSchema, default: () => ({}) }
}, { _id: false });

// Main event schema
const eventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, "Title is required"] },
    description: { type: String, default: "" },
    slug: { type: String, default: "" }, // For SEO-friendly URLs

    // Core event data
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, "Created by is required"] },
    co_hosts: [{ type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER }],
    start_date: { type: Date, default: Date.now },
    end_date: { type: Date, default: null },
    timezone: { type: String, default: "UTC" },
    location: { type: locationSchema, default: () => ({}) },

    // Visual and categorization
    cover_image: { type: coverImageSchema, default: () => ({}) },
    template: { type: String, enum: ['wedding', 'birthday', 'concert', 'corporate', 'vacation', 'custom'], default: 'custom' },
    tags: [{ type: String }],
    // albums: [albumSchema],

    // Privacy and sharing configuration
    privacy: { type: privacySchema, default: () => ({}) },

    // Default permissions for new guests
    default_guest_permissions: { type: defaultGuestPermissionsSchema, default: () => ({}) },

    // Real-time statistics
    stats: { type: statsSchema, default: () => ({}) },

    // Legacy fields for backward compatibility
    is_private: { type: Boolean, default: false },
    is_shared: { type: Boolean, default: false },
    share_settings: {
        restricted_to_guests: { type: Boolean, default: false },
        has_password_protection: { type: Boolean, default: false },
        guest_count: { type: Number, default: 0 },
        last_shared_at: { type: Date, default: null },
        active_share_tokens: { type: Number, default: 0 }
    },

    // Metadata
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    archived_at: { type: Date, default: null },
    featured: { type: Boolean, default: false }
});

// Create indexes for better performance
eventSchema.index({ created_by: 1 });
eventSchema.index({ slug: 1 });
eventSchema.index({ "privacy.visibility": 1 });
eventSchema.index({ "tags": 1 });
eventSchema.index({ archived_at: 1 });

export const Event = mongoose.model(MODEL_NAMES.EVENT, eventSchema, MODEL_NAMES.EVENT);

export type EventType = InferSchemaType<typeof eventSchema>;
export type EventCreationType = Omit<EventType, '_id'> & {
    // Make the complex fields optional for creation
    privacy?: {
        visibility?: string;
        discoverable?: boolean;
        guest_management?: {
            anyone_can_invite?: boolean;
            require_approval?: boolean;
            auto_approve_domains?: string[];
            max_guests?: number;
            allow_anonymous?: boolean;
        };
        content_controls?: {
            allow_downloads?: boolean;
            allow_sharing?: boolean;
            require_watermark?: boolean;
            content_moderation?: string;
        };
    };
    default_guest_permissions?: {
        view?: boolean;
        upload?: boolean;
        download?: boolean;
        comment?: boolean;
        share?: boolean;
        create_albums?: boolean;
    };
    stats?: {
        participants?: Record<string, any>;
        content?: Record<string, any>;
        engagement?: Record<string, any>;
        sharing?: Record<string, any>;
    };
};
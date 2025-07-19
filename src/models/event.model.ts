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
}, { _id: false });

const coHostInviteTokenSchema = new mongoose.Schema({
    token: { type: String, unique: true, sparse: true, index: true },
    created_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: MODEL_NAMES.USER, 
        required: false, // Changed from required: true to false
        default: null // Added default value
    },
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true }, // Enforce expiry for security
    is_active: { type: Boolean, default: true },
    max_uses: { type: Number, default: 1 }, // Single-use by default
    used_count: { type: Number, default: 0 },
}, { _id: false });

const coHostSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'removed'],
        default: 'pending',
    },
    permissions: {
        manage_content: { type: Boolean, default: true },
        manage_guests: { type: Boolean, default: true },
        manage_settings: { type: Boolean, default: true },
        approve_content: { type: Boolean, default: true },
    },
    invited_at: { type: Date, default: Date.now },
    approved_at: { type: Date, default: null },
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
}, { _id: false });

// Main event schema
const eventSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    title: { type: String, required: [true, 'Title is required'] },
    description: { type: String, default: '' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: [true, 'Created by is required'] },

    // Share token for general event access
    share_token: { type: String, unique: true, sparse: true, index: true },
    share_settings: { type: shareSettingsSchema, default: () => ({}) },

    // Permissions for users with the share token
    permissions: { type: permissionsSchema, default: () => ({}) },

    // Separate co-host invite token - Updated default function
    co_host_invite_token: {
        type: coHostInviteTokenSchema,
        default: function() {
            return {
                created_by: this.created_by || null, // Use the event's created_by
                created_at: new Date(),
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day expiry
                is_active: true,
                max_uses: 1,
                used_count: 0
            };
        },
    },

    // Co-hosts with admin-like permissions
    co_hosts: [coHostSchema],

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

    // Basic stats with pending_approval
    stats: {
        participants: { type: Number, default: 0 },
        photos: { type: Number, default: 0 },
        videos: { type: Number, default: 0 },
        total_size_mb: { type: Number, default: 0 },
        pending_approval: { type: Number, default: 0 },
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
            this.share_token = `evt_${new mongoose.Types.ObjectId().toString()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        // Generate co_host_invite_token and ensure created_by is set
        if (!this.co_host_invite_token || !this.co_host_invite_token.token) {
            // Initialize co_host_invite_token if it doesn't exist with all required properties
            if (!this.co_host_invite_token) {
                this.co_host_invite_token = {
                    created_by: this.created_by,
                    created_at: new Date(),
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    is_active: true,
                    max_uses: 1,
                    used_count: 0
                };
            }
            
            // Generate token if not exists
            if (!this.co_host_invite_token.token) {
                this.co_host_invite_token.token = `coh_${new mongoose.Types.ObjectId().toString()}_${Math.random().toString(36).slice(2, 8)}`;
            }
            
            // Ensure created_by is set
            if (!this.co_host_invite_token.created_by) {
                this.co_host_invite_token.created_by = this.created_by;
            }
            
            console.log('pre(save): Set co_host_invite_token.created_by to', this.created_by.toString());
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
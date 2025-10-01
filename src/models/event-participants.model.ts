import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Separate schema for role-based permissions template
const rolePermissionsSchema = new mongoose.Schema({
    can_view: { type: Boolean, default: true },
    can_upload: { type: Boolean, default: false },
    can_download: { type: Boolean, default: false },
    can_invite_others: { type: Boolean, default: false },
    can_moderate_content: { type: Boolean, default: false },
    can_manage_participants: { type: Boolean, default: false },
    can_edit_event: { type: Boolean, default: false },
    can_delete_event: { type: Boolean, default: false },
    can_transfer_ownership: { type: Boolean, default: false },
    // Additional granular permissions
    can_approve_content: { type: Boolean, default: false },
    can_export_data: { type: Boolean, default: false },
    can_view_analytics: { type: Boolean, default: false },
    can_manage_settings: { type: Boolean, default: false }
}, { _id: false });

// Activity and engagement tracking
const participantStatsSchema = new mongoose.Schema({
    uploads_count: { type: Number, default: 0 },
    downloads_count: { type: Number, default: 0 },
    views_count: { type: Number, default: 0 },
    invites_sent: { type: Number, default: 0 },
    total_file_size_mb: { type: Number, default: 0 },
    last_upload_at: { type: Date, default: null },
    engagement_score: { type: Number, default: 0 } // For analytics
}, { _id: false });

// Notification preferences specific to this event
const eventNotificationPrefsSchema = new mongoose.Schema({
    new_uploads: { type: Boolean, default: true },
    new_participants: { type: Boolean, default: false }, // Only for hosts
    event_updates: { type: Boolean, default: true },
    content_approved: { type: Boolean, default: true },
    weekly_digest: { type: Boolean, default: false },
    email_enabled: { type: Boolean, default: true },
    push_enabled: { type: Boolean, default: true }
}, { _id: false });

// Main EventParticipant Schema
const eventParticipantSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId()
    },

    // Core relationship - Compound primary key concept
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        required: false,
        default: null
    },
    event_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.EVENT,
        required: true
    },

    // Hierarchical role system
    role: {
        type: String,
        enum: ['creator', 'co_host', 'moderator', 'guest', 'viewer'],
        default: 'guest',
        required: true
    },

    // Add to EventParticipant schema
    guest_session_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.GUEST_SESSION,
        default: null
    },
    // How they joined the event
    join_method: {
        type: String,
        enum: [
            'created_event',
            'invited_email',
            'invited_phone',
            'share_link',
            'qr_code',
            'co_host_invite',
            'admin_added',
            'bulk_import'
        ],
        required: true
    },

    // Current participation status
    status: {
        type: String,
        enum: ['active', 'pending', 'blocked', 'removed', 'left', 'expired'],
        default: function () {
            return this.join_method === 'created_event' ? 'active' : 'pending';
        }
    },

    // Invitation tracking (critical for audit trail)
    invitation_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.EVENT_INVITATION,
        default: null
    },

    // Who invited them (important for permission inheritance)
    invited_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        default: null
    },

    // Access token for guest users (if needed)
    access_token: {
        type: String,
        sparse: true
    },

    // Timeline tracking
    invited_at: { type: Date, default: null },
    joined_at: {
        type: Date,
        default: Date.now,
        required: true
    },
    last_activity_at: { type: Date, default: Date.now },
    removed_at: { type: Date, default: null },
    expires_at: { type: Date, default: null }, // For temporary access

    // Dynamic permissions (can override role defaults)
    permissions: {
        type: rolePermissionsSchema,
        default: function () {
            return getDefaultPermissions(this.role);
        }
    },

    // Activity and engagement metrics
    stats: {
        type: participantStatsSchema,
        default: () => ({})
    },

    // Event-specific notification preferences
    notification_preferences: {
        type: eventNotificationPrefsSchema,
        default: () => ({})
    },

    // Metadata for analytics and debugging
    metadata: {
        join_ip: { type: String, default: "" },
        join_user_agent: { type: String, default: "" },
        join_platform: { type: String, enum: ['web', 'mobile', 'api'], default: 'web' },
        referrer: { type: String, default: "" },
        utm_source: { type: String, default: "" }
    },

    // Soft delete support
    deleted_at: { type: Date, default: null }

}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
            // Convert permission_overrides Map to object for JSON
            ret.permission_overrides = Object.fromEntries(ret.permission_overrides || new Map());
            return ret;
        }
    },
    toObject: { virtuals: true }
});


// Virtual to check if user is active participant
eventParticipantSchema.virtual('is_active').get(function () {
    return this.status === 'active' &&
        (!this.expires_at || this.expires_at > new Date()) &&
        !this.deleted_at;
});

// Helper function to get default permissions based on role
function getDefaultPermissions(role: string) {
    const permissionSets = {
        creator: {
            can_view: true,
            can_upload: true,
            can_download: true,
            can_invite_others: true,
            can_moderate_content: true,
            can_manage_participants: true,
            can_edit_event: true,
            can_delete_event: true,
            can_transfer_ownership: true,
            can_approve_content: true,
            can_export_data: true,
            can_view_analytics: true,
            can_manage_settings: true
        },
        co_host: {
            can_view: true,
            can_upload: true,
            can_download: true,
            can_invite_others: true,
            can_moderate_content: true,
            can_manage_participants: true,
            can_edit_event: true,
            can_delete_event: false,
            can_transfer_ownership: false,
            can_approve_content: true,
            can_export_data: true,
            can_view_analytics: true,
            can_manage_settings: false
        },
        moderator: {
            can_view: true,
            can_upload: true,
            can_download: true,
            can_invite_others: false,
            can_moderate_content: true,
            can_manage_participants: false,
            can_edit_event: false,
            can_delete_event: false,
            can_transfer_ownership: false,
            can_approve_content: true,
            can_export_data: false,
            can_view_analytics: false,
            can_manage_settings: false
        },
        guest: {
            can_view: true,
            can_upload: true,
            can_download: false,
            can_invite_others: false,
            can_moderate_content: false,
            can_manage_participants: false,
            can_edit_event: false,
            can_delete_event: false,
            can_transfer_ownership: false,
            can_approve_content: false,
            can_export_data: false,
            can_view_analytics: false,
            can_manage_settings: false
        },
        viewer: {
            can_view: true,
            can_upload: false,
            can_download: false,
            can_invite_others: false,
            can_moderate_content: false,
            can_manage_participants: false,
            can_edit_event: false,
            can_delete_event: false,
            can_transfer_ownership: false,
            can_approve_content: false,
            can_export_data: false,
            can_view_analytics: false,
            can_manage_settings: false
        }
    } as const;

    return permissionSets[role as keyof typeof permissionSets] || permissionSets.guest;
}

// Pre-save middleware for permission management
eventParticipantSchema.pre('save', function (next) {
    if (this.isNew || this.isModified('role')) {
        // Set default permissions based on role
        if (!this.permissions || Object.keys(this.permissions).length === 0) {
            this.permissions = getDefaultPermissions(this.role);
        }

        // Set status based on join method
        if (this.join_method === 'created_event') {
            this.status = 'active';
        }
    }

    // Update last activity
    if (this.isModified() && !this.isNew) {
        this.last_activity_at = new Date();
    }

    next();
});

eventParticipantSchema.pre('validate', function (next) {
    // Check that at least one identifier is present
    if (!this.user_id && !this.guest_session_id) {
        return next(new Error('Either user_id or guest_session_id must be provided'));
    }

    // Prevent both being set (user can't be both registered and guest)
    if (this.user_id && this.guest_session_id) {
        return next(new Error('Cannot have both user_id and guest_session_id set'));
    }

    next();
});


// Instance methods
eventParticipantSchema.methods.hasPermission = function (permission: string): boolean {
    const effectivePerms = this.effective_permissions;
    return effectivePerms && typeof effectivePerms === 'object'
        ? effectivePerms[permission] === true
        : false;
};

eventParticipantSchema.methods.grantPermission = function (permission: string) {
    if (!this.permission_overrides) {
        this.permission_overrides = new Map();
    }
    this.permission_overrides.set(permission, true);
};

eventParticipantSchema.methods.revokePermission = function (permission: string) {
    if (!this.permission_overrides) {
        this.permission_overrides = new Map();
    }
    this.permission_overrides.set(permission, false);
};

eventParticipantSchema.methods.updateStats = async function (statType: string, increment: number = 1) {
    if (!this.stats) {
        this.stats = {};
    }

    this.stats[statType] = (this.stats[statType] || 0) + increment;
    this.last_activity_at = new Date();

    return this.save();
};

// Indexes for performance (critical for large events)
eventParticipantSchema.index(
    { user_id: 1, event_id: 1 },
    {
        unique: true,
        partialFilterExpression: { user_id: { $ne: null } }
    }
);// Compound unique
eventParticipantSchema.index(
    { guest_session_id: 1, event_id: 1 },
    {
        unique: true,
        partialFilterExpression: { guest_session_id: { $ne: null } }
    }
);
eventParticipantSchema.index({ event_id: 1, role: 1, status: 1 }); // Role-based queries
eventParticipantSchema.index({ event_id: 1, status: 1, joined_at: -1 }); // Event participants list
eventParticipantSchema.index({ user_id: 1, status: 1, joined_at: -1 }); // User's events
eventParticipantSchema.index({ invited_by: 1, status: 1 }); // Invitation tracking
eventParticipantSchema.index({ access_token: 1 }, { unique: true, sparse: true }); // Guest access
eventParticipantSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL for expired access
eventParticipantSchema.index({ status: 1, last_activity_at: -1 }); // Activity-based queries
eventParticipantSchema.index({ deleted_at: 1 }); // Soft delete queries

export const EventParticipant = mongoose.model(MODEL_NAMES.EVENT_PARTICIPANT, eventParticipantSchema, MODEL_NAMES.EVENT_PARTICIPANT);

export type EventParticipantType = InferSchemaType<typeof eventParticipantSchema>;
export type EventParticipantCreationType = Omit<EventParticipantType, '_id' | 'createdAt' | 'updatedAt'>;
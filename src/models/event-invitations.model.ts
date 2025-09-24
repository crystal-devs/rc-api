import mongoose from "mongoose";
import { MODEL_NAMES } from "./names";

const eventInvitationSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId()
    },

    // Unique invitation token
    token: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    event_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.EVENT,
        required: true
    },

    // Invitation type
    invitation_type: {
        type: String,
        enum: ['email', 'phone', 'co_host_invite', 'share_link', 'bulk_invite'],
        required: true
    },

    // Who was invited - flexible for different invite types
    invitee_email: { type: String, required: false },
    invitee_name: { type: String, default: null },
    invitee_phone: { type: String, default: null },

    // Who sent the invitation
    invited_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        required: true
    },

    // What role they'll get when they join
    intended_role: {
        type: String,
        enum: ['co_host', 'moderator', 'guest', 'viewer'],
        default: 'guest'
    },

    // Invitation status
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined', 'expired', 'revoked', 'bounced'],
        default: 'pending'
    },

    // Usage tracking for multi-use invites (like share links)
    max_uses: { type: Number, default: 1 },
    used_count: { type: Number, default: 0 },

    // Timing
    expires_at: { type: Date, required: true },
    sent_at: { type: Date, default: Date.now },

    // Response tracking for single-use invites
    accepted_at: { type: Date, default: null },
    declined_at: { type: Date, default: null },

    // Multi-use tracking - for share links that multiple people can use
    accepted_by_users: [{
        user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER },
        guest_session_id: { type: String, default: null }, // For tracking guest uploads before login
        accepted_at: { type: Date, default: Date.now }
    }],

    // Email/SMS delivery tracking
    delivery_status: {
        sent: { type: Boolean, default: false },
        delivered: { type: Boolean, default: false },
        opened: { type: Boolean, default: false },
        clicked: { type: Boolean, default: false },
        bounced: { type: Boolean, default: false },
        complaint: { type: Boolean, default: false },
        // Track delivery attempts
        attempts: { type: Number, default: 0 },
        last_attempt_at: { type: Date, default: null }
    },

    // Custom message from inviter
    personal_message: { type: String, default: null },

    // Auto-reminder system
    reminders: {
        enabled: { type: Boolean, default: true },
        sent_count: { type: Number, default: 0 },
        last_sent_at: { type: Date, default: null },
        next_reminder_at: { type: Date, default: null }
    }

}, { timestamps: true });

// Indexes for performance
eventInvitationSchema.index({ token: 1 }, { unique: true });
eventInvitationSchema.index({ event_id: 1, status: 1 });
eventInvitationSchema.index({ event_id: 1, invitation_type: 1, status: 1 });
eventInvitationSchema.index({ invitee_email: 1, event_id: 1 }, { sparse: true });
eventInvitationSchema.index({ invitee_phone: 1, event_id: 1 }, { sparse: true });
eventInvitationSchema.index({ expires_at: 1 }); // TTL index for cleanup
eventInvitationSchema.index({ invited_by: 1, status: 1 });
eventInvitationSchema.index({ status: 1, sent_at: -1 });
eventInvitationSchema.index({ 'reminders.next_reminder_at': 1, 'reminders.enabled': 1 });


// Validation middleware
eventInvitationSchema.pre('validate', function (next) {
    if (this.isNew && !this.token) {
        const prefixMap = {
            'co_host_invite': 'coh',
            'share_link': 'shr',
            'email': 'eml',
            'phone': 'sms',
            'bulk_invite': 'blk'
        };

        const prefix = prefixMap[this.invitation_type] || 'inv';
        const objectId = new mongoose.Types.ObjectId().toString();
        const random = Math.random().toString(36).slice(2, 8);

        this.token = `${prefix}_${objectId.slice(-8)}_${random}`;
    }

    next();
});

// Instance methods
eventInvitationSchema.methods.canBeUsed = function () {
    return this.status === 'pending' &&
        this.expires_at > new Date() &&
        this.used_count < this.max_uses;
} as () => boolean;

eventInvitationSchema.methods.markAsUsed = async function (userId: string, guestSessionId: string | null = null) {
    if (!this.canBeUsed()) {
        throw new Error('Invitation cannot be used');
    }

    this.used_count += 1;
    this.accepted_by_users.push({
        user_id: userId,
        guest_session_id: guestSessionId,
        accepted_at: new Date()
    });

    // Update status if single-use invitation
    if (this.max_uses === 1) {
        this.status = 'accepted';
        this.accepted_at = new Date();
    }

    return await this.save();
};

export const EventInvitation = mongoose.model(MODEL_NAMES.EVENT_INVITATION, eventInvitationSchema);
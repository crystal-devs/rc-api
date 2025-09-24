import mongoose from "mongoose";
import { MODEL_NAMES } from "./names";

// Guest Session Schema - Track anonymous users before they log in
const guestSessionSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId()
    },

    // Unique session identifier (stored in browser localStorage/cookie)
    session_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Event they're participating in
    event_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.EVENT,
        required: true
    },

    // How they accessed the event (for analytics)
    access_method: {
        type: String,
        enum: ['qr_code', 'share_link', 'invitation_link', 'direct_link'],
        required: true
    },

    // Invitation token they used (if applicable)
    invitation_token: {
        type: String,
        default: null
    },

    // Guest provided information (optional)
    guest_info: {
        name: { type: String, default: null },
        email: { type: String, default: null },
        phone: { type: String, default: null }
    },

    // Browser/device fingerprinting for duplicate detection
    device_fingerprint: {
        user_agent: { type: String, default: "" },
        screen_resolution: { type: String, default: "" },
        timezone: { type: String, default: "" },
        language: { type: String, default: "" },
        platform: { type: String, default: "" }
    },

    // Network information
    network_info: {
        ip_address: { type: String, default: "" },
        country: { type: String, default: "" },
        city: { type: String, default: "" }
    },

    // Upload activity
    upload_stats: {
        total_uploads: { type: Number, default: 0 },
        successful_uploads: { type: Number, default: 0 },
        failed_uploads: { type: Number, default: 0 },
        total_size_mb: { type: Number, default: 0 },
        first_upload_at: { type: Date, default: null },
        last_upload_at: { type: Date, default: null }
    },

    // Session status
    status: {
        type: String,
        enum: ['active', 'claimed', 'expired', 'blocked'],
        default: 'active'
    },

    // User assignment (when they eventually log in)
    claimed_by_user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        default: null
    },
    claimed_at: { type: Date, default: null },

    // Session lifecycle
    expires_at: {
        type: Date,
        default: function () {
            // Default expiry: 30 days from creation
            return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }
    },
    last_activity_at: { type: Date, default: Date.now }

}, {
    timestamps: true,
    // TTL index to auto-delete expired sessions
    expireAfterSeconds: 0 // Uses expires_at field
});

// Indexes
guestSessionSchema.index({ session_id: 1 }, { unique: true });
guestSessionSchema.index({ event_id: 1, status: 1 });
guestSessionSchema.index({ 'guest_info.email': 1, event_id: 1 }, { sparse: true });
guestSessionSchema.index({ claimed_by_user: 1 }, { sparse: true });
guestSessionSchema.index({ expires_at: 1 }); // TTL index
guestSessionSchema.index({ status: 1, last_activity_at: -1 });
guestSessionSchema.index({ invitation_token: 1 }, { sparse: true });

// Pre-save middleware
guestSessionSchema.pre('save', function (next) {
    if (this.isNew && !this.session_id) {
        // Generate unique session ID
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        this.session_id = `guest_${timestamp}_${random}`;
    }

    // Update last activity
    if (this.isModified() && !this.isNew) {
        this.last_activity_at = new Date();
    }

    next();
});

// Instance methods
guestSessionSchema.methods.updateActivity = async function () {
    this.last_activity_at = new Date();
    return await this.save();
};

guestSessionSchema.methods.recordUpload = async function (sizeInMB: number) {
    this.upload_stats.total_uploads += 1;
    this.upload_stats.successful_uploads += 1;
    this.upload_stats.total_size_mb += sizeInMB;
    this.upload_stats.last_upload_at = new Date();

    if (!this.upload_stats.first_upload_at) {
        this.upload_stats.first_upload_at = new Date();
    }

    this.last_activity_at = new Date();
    return await this.save();
};

guestSessionSchema.methods.claimByUser = async function (userId : string) {
    if (this.status === 'claimed') {
        throw new Error('Session already claimed');
    }

    this.claimed_by_user = userId;
    this.claimed_at = new Date();
    this.status = 'claimed';

    return await this.save();
};

// Static method to find or create guest session
guestSessionSchema.statics.findOrCreateSession = async function (sessionData) {
    const { session_id, event_id, access_method } = sessionData;

    // Try to find existing session
    let session = await this.findOne({
        session_id,
        event_id,
        status: { $in: ['active', 'claimed'] },
        expires_at: { $gt: new Date() }
    });

    if (!session) {
        // Create new session
        session = await this.create({
            session_id,
            event_id,
            access_method,
            invitation_token: sessionData.invitation_token,
            guest_info: sessionData.guest_info || {},
            device_fingerprint: sessionData.device_fingerprint || {},
            network_info: sessionData.network_info || {}
        });
    } else {
        // Update last activity
        session.last_activity_at = new Date();
        await session.save();
    }

    return session;
};

export const GuestSession = mongoose.model(MODEL_NAMES.GUEST_SESSION, guestSessionSchema);
// models/GuestSession.ts
import mongoose, { InferSchemaType, Model } from "mongoose";
import { MODEL_NAMES } from "./names";

const guestSessionSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId(),
        required: true
    },

    session_id: {
        type: String,
        required: true,
        unique: true
    },

    event_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.EVENT,
        required: true
    },

    access_method: {
        type: String,
        enum: ['qr_code', 'share_link', 'invitation_link', 'direct_link'],
        required: true
    },

    invitation_token: {
        type: String,
        default: null
    },

    guest_info: {
        name: { type: String, default: null },
        email: { type: String, default: null },
        phone: { type: String, default: null }
    },

    device_fingerprint: {
        user_agent: { type: String, default: "" },
        screen_resolution: { type: String, default: "" },
        timezone: { type: String, default: "" },
        language: { type: String, default: "" },
        platform: { type: String, default: "" },
        fingerprint_hash: { type: String, default: "" }
    },

    network_info: {
        ip_address: { type: String, default: "" },
        country: { type: String, default: "" },
        city: { type: String, default: "" }
    },

    upload_stats: {
        total_uploads: { type: Number, default: 0 },
        successful_uploads: { type: Number, default: 0 },
        failed_uploads: { type: Number, default: 0 },
        total_size_mb: { type: Number, default: 0 },
        first_upload_at: { type: Date, default: null },
        last_upload_at: { type: Date, default: null }
    },

    status: {
        type: String,
        enum: ['active', 'claimed', 'expired', 'blocked', 'partially_claimed'],
        default: 'active'
    },

    claimed_by_user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        default: null
    },
    claimed_at: { type: Date, default: null },

    expires_at: {
        type: Date,
        default: function () {
            return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }
    },
    last_activity_at: { type: Date, default: Date.now },

    metadata: {
        referrer: { type: String, default: "" },
        utm_source: { type: String, default: "" },
        utm_campaign: { type: String, default: "" },
        entry_page: { type: String, default: "" }
    }

}, {
    timestamps: true
});

// Indexes
guestSessionSchema.index({ session_id: 1 }, { unique: true });
guestSessionSchema.index({ event_id: 1, status: 1 });
guestSessionSchema.index({ 'guest_info.email': 1, event_id: 1 }, { sparse: true });
guestSessionSchema.index({ 'guest_info.phone': 1, event_id: 1 }, { sparse: true });
guestSessionSchema.index({ claimed_by_user: 1 }, { sparse: true });
guestSessionSchema.index({ expires_at: 1 });
guestSessionSchema.index({ status: 1, last_activity_at: -1 });
guestSessionSchema.index({ invitation_token: 1 }, { sparse: true });
guestSessionSchema.index({ 'device_fingerprint.fingerprint_hash': 1, event_id: 1 });

// Pre-save middleware
guestSessionSchema.pre('save', function (next) {
    if (this.isNew && !this.session_id) {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        this.session_id = `gs_${timestamp}_${random}`;
    }

    if (this.isModified() && !this.isNew) {
        this.last_activity_at = new Date();
    }

    next();
});

// Define instance methods interface
interface IGuestSessionMethods {
    updateActivity(): Promise<this>;
    recordUpload(sizeInMB: number, success?: boolean): Promise<this>;
    claimByUser(userId: mongoose.Types.ObjectId): Promise<this>;
    isExpired(): boolean;
    canBeClaimed(): boolean;
}

// Define static methods interface
interface IGuestSessionModel extends Model<IGuestSessionDocument, {}, IGuestSessionMethods> {
    findOrCreateSession(sessionData: {
        session_id: string;
        event_id: mongoose.Types.ObjectId;
        access_method: string;
        invitation_token?: string;
        guest_info?: any;
        device_fingerprint?: any;
        network_info?: any;
        metadata?: any;
    }): Promise<IGuestSessionDocument>;

    findClaimableSessions(
        userId: mongoose.Types.ObjectId,
        eventId: mongoose.Types.ObjectId,
        userEmail?: string,
        userPhone?: string
    ): Promise<IGuestSessionDocument[]>;
}

// Instance methods
guestSessionSchema.methods.updateActivity = async function () {
    this.last_activity_at = new Date();
    return await this.save();
};

guestSessionSchema.methods.recordUpload = async function (sizeInMB: number, success: boolean = true) {
    this.upload_stats.total_uploads += 1;
    if (success) {
        this.upload_stats.successful_uploads += 1;
    } else {
        this.upload_stats.failed_uploads += 1;
    }
    this.upload_stats.total_size_mb += sizeInMB;
    this.upload_stats.last_upload_at = new Date();

    if (!this.upload_stats.first_upload_at) {
        this.upload_stats.first_upload_at = new Date();
    }

    this.last_activity_at = new Date();
    return await this.save();
};

guestSessionSchema.methods.claimByUser = async function (userId: mongoose.Types.ObjectId) {
    if (this.status === 'claimed') {
        throw new Error('Session already claimed');
    }

    this.claimed_by_user = userId;
    this.claimed_at = new Date();
    this.status = 'claimed';

    return await this.save();
};

guestSessionSchema.methods.isExpired = function (): boolean {
    return this.expires_at < new Date() || this.status === 'expired';
};

guestSessionSchema.methods.canBeClaimed = function (): boolean {
    return (
        this.status === 'active' &&
        !this.isExpired() &&
        !this.claimed_by_user
    );
};

// Static methods
guestSessionSchema.statics.findOrCreateSession = async function (sessionData) {
    const { session_id, event_id, access_method } = sessionData;

    let session = await this.findOne({
        session_id,
        event_id,
        status: { $in: ['active', 'claimed', 'partially_claimed'] },
        expires_at: { $gt: new Date() }
    });

    if (!session) {
        session = await this.create({
            session_id,
            event_id,
            access_method,
            invitation_token: sessionData.invitation_token,
            guest_info: sessionData.guest_info || {},
            device_fingerprint: sessionData.device_fingerprint || {},
            network_info: sessionData.network_info || {},
            metadata: sessionData.metadata || {}
        });
    } else {
        session.last_activity_at = new Date();
        await session.save();
    }

    return session;
};

guestSessionSchema.statics.findClaimableSessions = async function (
    userId: mongoose.Types.ObjectId,
    eventId: mongoose.Types.ObjectId,
    userEmail?: string,
    userPhone?: string
) {
    const matchFilters: any[] = [
        { event_id: eventId },
        { status: 'active' },
        { expires_at: { $gt: new Date() } },
        { claimed_by_user: null }
    ];

    const orFilters: any[] = [];

    if (userEmail) {
        orFilters.push({ 'guest_info.email': userEmail });
    }

    if (userPhone) {
        orFilters.push({ 'guest_info.phone': userPhone });
    }

    if (orFilters.length === 0) {
        return [];
    }

    matchFilters.push({ $or: orFilters });

    return await this.find({ $and: matchFilters });
};

// Export types
export type GuestSessionType = InferSchemaType<typeof guestSessionSchema>;
export type IGuestSessionDocument = mongoose.Document & GuestSessionType & IGuestSessionMethods;

// Export model with proper typing
export const GuestSession = mongoose.model<IGuestSessionDocument, IGuestSessionModel>(
    MODEL_NAMES.GUEST_SESSION,
    guestSessionSchema
);
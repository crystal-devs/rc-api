import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const refreshSessionSchema = new mongoose.Schema({
    // Session identifier (UUID, not token-related)
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // Token hash for database indexing (SHA-256 hash of refresh token)
    tokenHash: {
        type: String,
        required: false,
        index: true,
        sparse: true // Allow null values
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        required: true,
        index: true
    },
    // Device information
    deviceFingerprint: {
        type: String,
        default: null
    },
    deviceName: {
        type: String,
        default: 'Unknown Device'
    },
    ip: {
        type: String,
        default: 'unknown'
    },
    userAgent: {
        type: String,
        default: 'unknown'
    },
    location: {
        country: String,
        region: String,
        city: String,
        timezone: String
    },
    // Session status
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 } // TTL Index: Auto-delete document when expiresAt is reached
    },
    lastActivityAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    // Audit fields
    revokedAt: Date,
    revocationReason: String,
    rotatedAt: Date,
    rotatedToSessionId: String
}, { timestamps: true });

// Check if model exists before compiling to avoid OverwriteModelError in dev HMR
export type RefreshSessionType = InferSchemaType<typeof refreshSessionSchema>;

export const RefreshSession = mongoose.model(MODEL_NAMES.REFRESH_SESSION, refreshSessionSchema, MODEL_NAMES.REFRESH_SESSION);

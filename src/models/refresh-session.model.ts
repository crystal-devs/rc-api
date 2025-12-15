import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const refreshSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        required: true
    },
    tokenHash: {
        type: String,
        required: true,
        unique: true
    },
    deviceId: {
        type: String, // Optional: User-Agent or Fingerprint
        default: 'unknown'
    },
    ip: {
        type: String,
        default: 'unknown'
    },
    userAgent: {
        type: String,
        default: 'unknown'
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 } // TTL Index: Auto-delete document when expiresAt is reached
    },
    createdByIp: {
        type: String
    },
    isRevoked: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Check if model exists before compiling to avoid OverwriteModelError in dev HMR
export type RefreshSessionType = InferSchemaType<typeof refreshSessionSchema>;

export const RefreshSession = mongoose.model(MODEL_NAMES.REFRESH_SESSION, refreshSessionSchema, MODEL_NAMES.REFRESH_SESSION);

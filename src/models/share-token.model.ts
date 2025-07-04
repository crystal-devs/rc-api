import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";
import crypto from "crypto";

// Define permissions schema
const permissionsSchema = new mongoose.Schema({
    view: { type: Boolean, default: true },
    upload: { type: Boolean, default: false },
    download: { type: Boolean, default: false },
    share: { type: Boolean, default: false },
}, { _id: false });

// Define share token schema
const shareTokenSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    token: { 
        type: String, 
        unique: true, 
        required: true,
        default: () => crypto.randomBytes(12).toString('base64url') // Generate a secure random token
    },
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true },
    album_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.ALBUM, default: null },
    password_hash: { type: String, default: null },
    permissions: { type: permissionsSchema, required: true, default: () => ({}) },
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, default: null },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    usage_count: { type: Number, default: 0 },
    revoked: { type: Boolean, default: false },
    revoked_at: { type: Date, default: null },
    revoked_by: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, default: null },
});

// Create indexes for better performance
shareTokenSchema.index({ token: 1 });
shareTokenSchema.index({ event_id: 1 });
shareTokenSchema.index({ album_id: 1 });

export const ShareToken = mongoose.model(MODEL_NAMES.SHARE_TOKEN, shareTokenSchema, MODEL_NAMES.SHARE_TOKEN);

export type ShareTokenType = InferSchemaType<typeof shareTokenSchema>;
export type ShareTokenCreationType = Omit<ShareTokenType, '_id'>;

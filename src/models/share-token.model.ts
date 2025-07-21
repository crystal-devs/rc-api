import mongoose, { InferSchemaType, Schema } from "mongoose";
import { MODEL_NAMES } from "./names";

export interface ShareTokenType extends Document {
  _id: mongoose.Types.ObjectId;
  event_id: mongoose.Types.ObjectId;
  album_id?: mongoose.Types.ObjectId;
  token: string;
  token_type: 'invite' | 'view_only' | 'collaborate';
  permissions: {
    view: boolean;
    upload: boolean;
    download: boolean;
    share: boolean;
  };
  restrictions: {
    max_uses?: number;
    expires_at?: Date;
    allowed_emails: string[];
    requires_approval: boolean;
    password_hash?: string;
  };
  usage: {
    count: number;
    last_used?: Date;
    used_by: mongoose.Types.ObjectId[];
  };
  created_by: mongoose.Types.ObjectId;
  created_at: Date;
  revoked: boolean;
  revoked_at?: Date;
  revoked_by?: mongoose.Types.ObjectId;
}

const shareTokenSchema = new Schema<ShareTokenType>({
  event_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: MODEL_NAMES.EVENT,
    required: true,
    index: true
  },
  album_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Album',
    default: null
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  token_type: {
    type: String,
    enum: ['invite', 'view_only', 'collaborate'],
    default: 'invite'
  },
  permissions: {
    view: { type: Boolean, default: true },
    upload: { type: Boolean, default: false },
    download: { type: Boolean, default: false },
    share: { type: Boolean, default: false },
    comment: { type: Boolean, default: true }
  },
  restrictions: {
    max_uses: Number,
    expires_at: Date,
    allowed_emails: [{ type: String, lowercase: true }],
    requires_approval: { type: Boolean, default: false }
  },
  usage: {
    count: { type: Number, default: 0 },
    last_used: Date,
    used_by: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EventParticipant' }]
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: MODEL_NAMES.USER,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  revoked: {
    type: Boolean,
    default: false,
    index: true
  },
  revoked_at: Date,
  revoked_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: MODEL_NAMES.USER
  }
});

// Indexes for efficient queries
shareTokenSchema.index({ event_id: 1, revoked: 1 });
shareTokenSchema.index({ token_type: 1, revoked: 1 });
shareTokenSchema.index({ 'restrictions.expires_at': 1 });
shareTokenSchema.index({ created_by: 1 });


export const ShareToken = mongoose.model(MODEL_NAMES.SHARE_TOKEN, shareTokenSchema, MODEL_NAMES.SHARE_TOKEN);

// export type ShareTokenType = InferSchemaType<typeof shareTokenSchema>;
// export type ShareTokenCreationType = Omit<ShareTokenType, '_id'>;

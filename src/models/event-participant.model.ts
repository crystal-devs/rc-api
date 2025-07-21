import mongoose, { Document, Schema } from 'mongoose';
import { MODEL_NAMES } from './names';

export interface EventParticipantType extends Document {
  _id: mongoose.Types.ObjectId;
  event_id: mongoose.Types.ObjectId;
  user_id?: mongoose.Types.ObjectId;
  guest_info: {
    email: string;
    name: string;
    avatar_url?: string;
    is_anonymous: boolean;
  };
  participation: {
    status: 'invited' | 'active' | 'left' | 'removed' | 'banned';
    role: 'owner' | 'co_host' | 'guest';
    joined_at?: Date;
    last_seen?: Date;
    invite_sent_at?: Date;
    invite_accepted_at?: Date;
    left_at?: Date;
  };
  permissions: {
    view: boolean;
    upload: boolean;
    download: boolean;
    share: boolean;
    comment: boolean;
    manage_guests: boolean;
  };
  activity: {
    photos_uploaded: number;
    photos_viewed: number;
    comments_made: number;
    last_upload?: Date;
    session_count: number;
  };
  invited_by?: mongoose.Types.ObjectId;
  share_token_used?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const eventParticipantSchema = new Schema<EventParticipantType>({
  event_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: MODEL_NAMES.EVENT,
    required: true,
    index: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: MODEL_NAMES.USER,
    default: null,
    index: true
  },
  guest_info: {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    avatar_url: {
      type: String,
      default: ''
    },
    is_anonymous: {
      type: Boolean,
      default: false
    }
  },
  participation: {
    status: {
      type: String,
      enum: ['invited', 'active', 'left', 'removed', 'banned'],
      default: 'invited',
      index: true
    },
    role: {
      type: String,
      enum: ['owner', 'co_host', 'guest'],
      default: 'guest',
      index: true
    },
    joined_at: Date,
    last_seen: Date,
    invite_sent_at: Date,
    invite_accepted_at: Date,
    left_at: Date
  },
  permissions: {
    view: { type: Boolean, default: true },
    upload: { type: Boolean, default: false },
    download: { type: Boolean, default: false },
    share: { type: Boolean, default: false },
    comment: { type: Boolean, default: true },
    manage_guests: { type: Boolean, default: false }
  },
  activity: {
    photos_uploaded: { type: Number, default: 0 },
    photos_viewed: { type: Number, default: 0 },
    comments_made: { type: Number, default: 0 },
    last_upload: Date,
    session_count: { type: Number, default: 0 }
  },
  invited_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: MODEL_NAMES.USER
  },
  share_token_used: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShareToken'
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Compound indexes for efficient queries
eventParticipantSchema.index({ event_id: 1, 'participation.status': 1 });
eventParticipantSchema.index({ event_id: 1, 'participation.role': 1 });
eventParticipantSchema.index({ event_id: 1, 'guest_info.email': 1 }, { unique: true });
eventParticipantSchema.index({ user_id: 1, event_id: 1 });
eventParticipantSchema.index({ 'participation.last_seen': -1 });

export const EventParticipant = mongoose.model<EventParticipantType>('EventParticipant', eventParticipantSchema);

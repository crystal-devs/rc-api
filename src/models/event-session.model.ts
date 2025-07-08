import mongoose, { Document, Schema } from 'mongoose';
import { MODEL_NAMES } from './names';

export interface EventSessionActivityType extends Document {
    _id: mongoose.Types.ObjectId;
    event_id: mongoose.Types.ObjectId;
    participant_id: mongoose.Types.ObjectId;
    user_id: mongoose.Types.ObjectId;

    session: {
        session_id: string;
        started_at: Date;
        last_activity_at: Date;
        ended_at: Date;
        duration_minutes: number;
        is_active: boolean;
        connection_type: 'websocket' | 'polling';
        device_info: {
            type: 'desktop' | 'mobile' | 'tablet';
            os: string;
            browser: string;
            screen_resolution: string;
            user_agent: string;
            ip_address: string;
            location: {
                country: string;
                city: string;
                timezone: string;
            };
        };
    };

    activities: {
        type: 'photo_upload' | 'photo_view' | 'comment_added';
        timestamp: Date;
        data: any;
    }[];

    performance: {
        page_load_time: number;
        image_load_times: number[];
        api_response_times: number[];
        error_count: number;
        bandwidth_used_mb: number;
    };
}

const sessionSchema = new Schema({
    session_id: { type: String, required: true, index: true },
    started_at: { type: Date, required: true },
    last_activity_at: { type: Date, required: true },
    ended_at: { type: Date },
    duration_minutes: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    connection_type: { type: String, enum: ['websocket', 'polling'], required: true },
    device_info: {
        type: {
            type: String,
            enum: ['desktop', 'mobile', 'tablet'],
            required: true
        },
        os: { type: String, required: true },
        browser: { type: String, required: true },
        screen_resolution: { type: String, required: true },
        user_agent: { type: String, required: true },
        ip_address: { type: String, required: true },
        location: {
            country: { type: String, required: true },
            city: { type: String, required: true },
            timezone: { type: String, required: true }
        }
    }
});

const activitySchema = new Schema({
    type: {
        type: String,
        enum: ['photo_upload', 'photo_view', 'comment_added'],
        required: true
    },
    timestamp: { type: Date, default: Date.now },
    data: { type: Schema.Types.Mixed }
});

const performanceSchema = new Schema({
    page_load_time: { type: Number, default: 0 },
    image_load_times: [{ type: Number }],
    api_response_times: [{ type: Number }],
    error_count: { type: Number, default: 0 },
    bandwidth_used_mb: { type: Number, default: 0 }
});

const eventSessionActivitySchema = new Schema<EventSessionActivityType>({
    event_id: { type: Schema.Types.ObjectId, ref: MODEL_NAMES.EVENT, required: true, index: true },
    participant_id: { type: Schema.Types.ObjectId, ref: 'EventParticipant', required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true, index: true },

    session: { type: sessionSchema, required: true },
    activities: [activitySchema],
    performance: performanceSchema
}, {
    timestamps: true
});

// Indexes for fast lookup
eventSessionActivitySchema.index({ event_id: 1, user_id: 1 });
eventSessionActivitySchema.index({ 'session.session_id': 1 });
eventSessionActivitySchema.index({ 'activities.timestamp': -1 });

export const EventSession = mongoose.model<EventSessionActivityType>('EventSession', eventSessionActivitySchema);

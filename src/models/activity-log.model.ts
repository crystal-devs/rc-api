import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const activityLogSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    resource_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    resource_type: { type: String, enum: ["album", "page", "media", "event"], required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    action: { 
        type: String,
        enum: ["viewed", "edited", "deleted", "created", "added", "removed", "permission_changed"], 
        required: true 
    },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    timestamp: { type: Date, default: Date.now } // Add explicit timestamp for TTL
}, { timestamps: false });

// 📊 Activity Log Indexes for Analytics & Performance
activityLogSchema.index({ user_id: 1, timestamp: -1 }); // User activity timeline
activityLogSchema.index({ resource_id: 1, resource_type: 1, timestamp: -1 }); // Resource activity
activityLogSchema.index({ resource_type: 1, action: 1, timestamp: -1 }); // Action analytics
activityLogSchema.index({ timestamp: -1 }); // Recent activity queries

// 🗑️ TTL Index - Auto-delete logs older than 90 days (for GDPR compliance)
activityLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// 📈 Compound indexes for complex queries
activityLogSchema.index({ user_id: 1, resource_type: 1, action: 1 }); // User behavior analysis
activityLogSchema.index({ resource_id: 1, action: 1 }); // Resource engagement

export const ActivityLog = mongoose.model(MODEL_NAMES.ACTIVITY_LOG, activityLogSchema, MODEL_NAMES.ACTIVITY_LOG);

export type ActivityLogType = InferSchemaType<typeof activityLogSchema>;
export type ActivityLogCreationType = Omit<ActivityLogType, '_id'>;
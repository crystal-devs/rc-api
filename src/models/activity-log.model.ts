import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";


const activityLogSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    resource_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    resource_type: { type: String, enum: ["album", "page", "media"], required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true, index: true },
    action: { 
        type: String,
        enum: ["viewed", "edited", "deleted", "created", "added", "removed", "permission_changed"], 
        required: true 
    },
    details: { type: mongoose.Schema.Types.Mixed, default: null }, 
}, { timestamps: false });

export const ActivityLog = mongoose.model(MODEL_NAMES.ACTIVITY_LOG, activityLogSchema, MODEL_NAMES.ACTIVITY_LOG);

export type ActivityLogType = InferSchemaType<typeof activityLogSchema>;
export type ActivityLogCreationType = Omit<ActivityLogType, '_id'>;

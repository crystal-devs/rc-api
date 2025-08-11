import mongoose, { InferSchemaType, Model } from "mongoose";
import { MODEL_NAMES } from "./names";

const bugReportSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: new mongoose.Types.ObjectId(),
    },
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER,
        default: null,
    },
    image_url: {
        type: String,
        default: null,
    },
    video_url: {
        type: String,
        default: null,
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'resolved', 'closed'],
        default: 'pending',
    },
}, { timestamps: true });

export type TBugReport = InferSchemaType<typeof bugReportSchema>;

export const BugReport: Model<TBugReport> = mongoose.model(MODEL_NAMES.BUG_REPORT, bugReportSchema, MODEL_NAMES.BUG_REPORT);
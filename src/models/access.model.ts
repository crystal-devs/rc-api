import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";


const accessControlSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    resource_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, // Album or Page ID
    resource_type: { type: String, enum: ["event", "album", "page"], required: true },
    permissions: [{
        user_id: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: false }, // User-based access
        role: { 
            type: String, 
            enum: ["owner", "viewer"], 
            required: true 
        }
    }],
}, { timestamps: false });

export const AccessControl = mongoose.model(MODEL_NAMES.ACCESS_CONTROL, accessControlSchema, MODEL_NAMES.ACCESS_CONTROL);

export type AccessControlType = InferSchemaType<typeof accessControlSchema>;
export type AccessControlCreationType = Omit<AccessControlType, '_id'>;

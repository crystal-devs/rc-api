import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

const userSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId(),
        required: true,
    },
    role_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.ROLE,
    },
    name: {
        type: String,
        default: "clicky",
    },
    profile_pic: {
        type: String,
    },
    password: {
        type: String,
    },
    email: {
        type: String,
    },
    phone_number: {
        type: String,
    },
    provider: {
        type: String,
        enum: ["google", "apple", "instagram", "facebook"]
    },
    country_code: {
        type: String,
        default: "+91"
    },
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: MODEL_NAMES.USER_SUBSCRIPTION,
        default: null
    },
    stripeCustomerId: {
        type: String,
        default: null
    },
    preferences: {
        emailNotifications: {
            type: Boolean,
            default: true
        },
        defaultEventPrivacy: {
            type: String,
            enum: ["public", "private"],
            default: "private"
        }
    },
    lastLoginAt: {
        type: Date,
        default: Date.now
    }
}, {timestamps: true})

export const User = mongoose.model(MODEL_NAMES.USER, userSchema, MODEL_NAMES.USER);

export type UserType = InferSchemaType<typeof userSchema>;
export type UserCreationType = Omit<UserType, '_id'>;
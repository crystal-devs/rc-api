import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Define plan limits schema
const limitsSchema = new mongoose.Schema({
    maxEvents: { type: Number, required: true, default: 5 },
    maxPhotosPerEvent: { type: Number, required: true, default: 100 },
    maxStorage: { type: Number, required: true, default: 1000 }, // MB
    maxPhotoSize: { type: Number, required: true, default: 10 }, // MB
    features: { type: [String], default: [] }
}, { _id: false });

// Define subscription schema
const userSubscriptionSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    planId: { type: String, required: true },
    planName: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['active', 'inactive', 'canceled', 'expired', 'trial'],
        default: 'active'
    },
    limits: { type: limitsSchema, required: true },
    stripeSubscriptionId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },
    currentPeriodStart: { type: Date, default: Date.now },
    currentPeriodEnd: { type: Date, required: true },
    cancelAtPeriodEnd: { type: Boolean, default: false }
}, 
{
    timestamps: true // Automatically add createdAt and updatedAt fields
});

// Create indexes for better performance
userSubscriptionSchema.index({ userId: 1 }, { unique: true });
userSubscriptionSchema.index({ status: 1 });

export const UserSubscription = mongoose.model(MODEL_NAMES.USER_SUBSCRIPTION, userSubscriptionSchema, MODEL_NAMES.USER_SUBSCRIPTION);

export type UserSubscriptionType = InferSchemaType<typeof userSubscriptionSchema>;
export type UserSubscriptionCreationType = Omit<UserSubscriptionType, '_id'>;

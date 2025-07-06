import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Define plan limits schema
const planLimitsSchema = new mongoose.Schema({
    maxEvents: { type: Number, required: true },
    maxPhotosPerEvent: { type: Number, required: true },
    maxStorage: { type: Number, required: true }, // MB
    maxPhotoSize: { type: Number, required: true }, // MB
    features: { type: [String], default: [] }
}, { _id: false });

// Define subscription plan schema
const subscriptionPlanSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    planId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    stripePriceId: { type: String, default: null },
    limits: { type: planLimitsSchema, required: true },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Create indexes for better performance
subscriptionPlanSchema.index({ planId: 1 }, { unique: true });
subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

export const SubscriptionPlan = mongoose.model(MODEL_NAMES.SUBSCRIPTION_PLAN, subscriptionPlanSchema, MODEL_NAMES.SUBSCRIPTION_PLAN);

export type SubscriptionPlanType = InferSchemaType<typeof subscriptionPlanSchema>;
export type SubscriptionPlanCreationType = Omit<SubscriptionPlanType, '_id'>;

// Create default plans if they don't exist
export const createDefaultPlans = async () => {
    const plans = [
        {
            planId: 'free',
            name: 'Free',
            description: 'Basic plan with limited features',
            price: 0,
            billingCycle: 'monthly',
            limits: {
                maxEvents: 3,
                maxPhotosPerEvent: 50,
                maxStorage: 500,
                maxPhotoSize: 5,
                features: ['Basic Photo Sharing']
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 1
        },
        {
            planId: 'premium',
            name: 'Premium Plan',
            description: 'Enhanced features with more storage',
            price: 9.99,
            billingCycle: 'monthly',
            stripePriceId: 'price_premium_monthly',
            limits: {
                maxEvents: 10,
                maxPhotosPerEvent: 500,
                maxStorage: 5000,
                maxPhotoSize: 15,
                features: [
                    'Advanced Photo Sharing',
                    'Download Original Files',
                    'Custom Event Links'
                ]
            },
            isActive: true,
            isFeatured: true,
            sortOrder: 2
        },
        {
            planId: 'pro',
            name: 'Professional Plan',
            description: 'Unlimited features for professional users',
            price: 19.99,
            billingCycle: 'monthly',
            stripePriceId: 'price_pro_monthly',
            limits: {
                maxEvents: 50,
                maxPhotosPerEvent: 1000,
                maxStorage: 20000,
                maxPhotoSize: 25,
                features: [
                    'AI Photo Enhancement',
                    'Priority Support',
                    'Custom Branding',
                    'Advanced Analytics'
                ]
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 3
        }
    ];
    
    for (const plan of plans) {
        await SubscriptionPlan.findOneAndUpdate(
            { planId: plan.planId },
            { 
                $set: plan  // Use $set instead of $setOnInsert to update existing plans
            },
            { upsert: true, new: true }
        );
    }
    
    // Log how many plans are in the database
    const planCount = await SubscriptionPlan.countDocuments();
    console.log(`Default subscription plans created or updated. Total plans: ${planCount}`);
};

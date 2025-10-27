import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Define plan limits schema
const planLimitsSchema = new mongoose.Schema({
    maxEvents: { type: Number, required: true }, // -1 for unlimited
    maxPhotosPerEvent: { type: Number, required: true }, // -1 for unlimited
    maxStorage: { type: Number, required: true }, // in BYTES
    maxPhotoSize: { type: Number, required: true }, // in BYTES
    maxVideoSize: { type: Number, default: 104857600 }, // 100MB in bytes
    maxCoHosts: { type: Number, default: 0 },
    retentionDays: { type: Number, required: true }, // How long photos are kept
    gracePeriodDays: { type: Number, default: 30 }, // Days after expiry before deletion
    features: { type: [String], default: [] }
}, { _id: false });

// Define quality settings schema
const qualitySettingsSchema = new mongoose.Schema({
    maxResolution: { type: String, default: '1920x1080' }, // 'original' or '1920x1080'
    compressionQuality: { type: Number, default: 75 }, // 1-100
    format: { type: String, enum: ['webp', 'jpeg', 'original'], default: 'webp' },
    keepOriginals: { type: Boolean, default: false },
    originalRetentionDays: { type: Number, default: 0 } // 0 means no originals kept
}, { _id: false });

// Define subscription plan schema
const subscriptionPlanSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    planId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true },
    currency: { type: String, default: "INR" }, // Changed to INR as primary
    billingCycle: { 
        type: String, 
        enum: ['event', 'monthly', 'yearly'], 
        default: 'yearly' // Most common for event apps
    },
    
    // Payment gateway IDs
    stripePriceId: { type: String, default: null },
    razorpayPlanId: { type: String, default: null }, // For Indian market
    
    limits: { type: planLimitsSchema, required: true },
    qualitySettings: { type: qualitySettingsSchema, required: true },
    
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true // Automatically manage createdAt and updatedAt
});

// Create indexes for better performance
subscriptionPlanSchema.index({ planId: 1 }, { unique: true });
subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });
subscriptionPlanSchema.index({ currency: 1, billingCycle: 1 });

export const SubscriptionPlan = mongoose.model(
    MODEL_NAMES.SUBSCRIPTION_PLAN, 
    subscriptionPlanSchema, 
    MODEL_NAMES.SUBSCRIPTION_PLAN
);

export type SubscriptionPlanType = InferSchemaType<typeof subscriptionPlanSchema>;
export type SubscriptionPlanCreationType = Omit<SubscriptionPlanType, '_id' | 'createdAt' | 'updatedAt'>;

// Create default plans matching our pricing strategy
export const createDefaultPlans = async () => {
    const plans = [
        {
            planId: 'free',
            name: 'Free',
            description: 'Perfect for small events. Try all basic features.',
            price: 0,
            currency: 'INR',
            billingCycle: 'yearly',
            limits: {
                maxEvents: 1,
                maxPhotosPerEvent: -1, // unlimited photos within storage
                maxStorage: 5368709120, // 5GB in bytes
                maxPhotoSize: 10485760, // 10MB in bytes
                maxVideoSize: 104857600, // 100MB in bytes
                maxCoHosts: 0,
                retentionDays: 365, // 1 year
                gracePeriodDays: 30,
                features: [
                    'QR Code Access',
                    'Basic Photo Wall',
                    'Unlimited Guests',
                    'Download All Photos (1x)',
                    '1 Year Storage'
                ]
            },
            qualitySettings: {
                maxResolution: '1920x1080',
                compressionQuality: 75,
                format: 'webp',
                keepOriginals: false,
                originalRetentionDays: 0
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 1
        },
        {
            planId: 'starter',
            name: 'Starter',
            description: 'Great for multiple small events throughout the year.',
            price: 499,
            currency: 'INR',
            billingCycle: 'yearly',
            razorpayPlanId: 'plan_starter_yearly',
            limits: {
                maxEvents: 3,
                maxPhotosPerEvent: -1,
                maxStorage: 26843545600, // 25GB in bytes
                maxPhotoSize: 15728640, // 15MB in bytes
                maxVideoSize: 524288000, // 500MB in bytes
                maxCoHosts: 1,
                retentionDays: 365,
                gracePeriodDays: 30,
                features: [
                    'All Free Features',
                    'Live Photo Wall with Slideshow',
                    'HD Photos (1920x1080)',
                    'Basic Branding (Logo)',
                    'Unlimited Downloads',
                    'Email Support'
                ]
            },
            qualitySettings: {
                maxResolution: '1920x1080',
                compressionQuality: 80,
                format: 'webp',
                keepOriginals: false,
                originalRetentionDays: 7 // Keep originals for 7 days
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 2
        },
        {
            planId: 'starter-event',
            name: 'Starter (Per Event)',
            description: 'Pay per event with all Starter features.',
            price: 99,
            currency: 'INR',
            billingCycle: 'event',
            razorpayPlanId: 'plan_starter_event',
            limits: {
                maxEvents: 1,
                maxPhotosPerEvent: -1,
                maxStorage: 10737418240, // 10GB per event
                maxPhotoSize: 15728640,
                maxVideoSize: 524288000,
                maxCoHosts: 1,
                retentionDays: 365,
                gracePeriodDays: 30,
                features: [
                    'All Starter Features',
                    'Single Event'
                ]
            },
            qualitySettings: {
                maxResolution: '1920x1080',
                compressionQuality: 80,
                format: 'webp',
                keepOriginals: false,
                originalRetentionDays: 7
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 3
        },
        {
            planId: 'pro',
            name: 'Pro',
            description: 'Most popular! Perfect for photographers and event planners.',
            price: 1499,
            currency: 'INR',
            billingCycle: 'yearly',
            razorpayPlanId: 'plan_pro_yearly',
            limits: {
                maxEvents: 10,
                maxPhotosPerEvent: -1,
                maxStorage: 107374182400, // 100GB in bytes
                maxPhotoSize: 20971520, // 20MB in bytes
                maxVideoSize: 1073741824, // 1GB in bytes
                maxCoHosts: 3,
                retentionDays: 365 + 180, // 1.5 years
                gracePeriodDays: 60,
                features: [
                    'All Starter Features',
                    'AI Face Recognition (Basic)',
                    'Full HD + Original Backup',
                    'Custom Branding',
                    'Guest Analytics',
                    'Multiple QR Codes',
                    'Priority Support'
                ]
            },
            qualitySettings: {
                maxResolution: '1920x1080',
                compressionQuality: 85,
                format: 'webp',
                keepOriginals: true,
                originalRetentionDays: 365 // Keep originals for 1 year
            },
            isActive: true,
            isFeatured: true,
            sortOrder: 4
        },
        {
            planId: 'premium',
            name: 'Premium',
            description: 'Professional grade with advanced AI features.',
            price: 3999,
            currency: 'INR',
            billingCycle: 'yearly',
            razorpayPlanId: 'plan_premium_yearly',
            limits: {
                maxEvents: -1, // unlimited
                maxPhotosPerEvent: -1,
                maxStorage: 536870912000, // 500GB in bytes
                maxPhotoSize: 52428800, // 50MB in bytes
                maxVideoSize: 5368709120, // 5GB in bytes
                maxCoHosts: 10,
                retentionDays: 730, // 2 years
                gracePeriodDays: 90,
                features: [
                    'All Pro Features',
                    '4K Original Quality',
                    'Advanced AI Face Recognition',
                    'AI Photo Highlights',
                    'Content Moderation AI',
                    'White-label Branding',
                    'Custom Domain',
                    'WhatsApp Support'
                ]
            },
            qualitySettings: {
                maxResolution: 'original',
                compressionQuality: 95,
                format: 'original', // Keep original format
                keepOriginals: true,
                originalRetentionDays: 730 // 2 years
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 5
        },
        {
            planId: 'business',
            name: 'Business',
            description: 'For photography businesses and large event companies.',
            price: 9999,
            currency: 'INR',
            billingCycle: 'yearly',
            razorpayPlanId: 'plan_business_yearly',
            limits: {
                maxEvents: -1,
                maxPhotosPerEvent: -1,
                maxStorage: 2199023255552, // 2TB in bytes
                maxPhotoSize: 104857600, // 100MB in bytes
                maxVideoSize: 10737418240, // 10GB in bytes
                maxCoHosts: -1, // unlimited
                retentionDays: -1, // unlimited (as long as subscribed)
                gracePeriodDays: 180,
                features: [
                    'All Premium Features',
                    'API Access',
                    'Multi-user Teams',
                    'Advanced Analytics',
                    'Webhook Integrations',
                    'Dedicated Account Manager',
                    'SLA Guarantee (99.9%)'
                ]
            },
            qualitySettings: {
                maxResolution: 'original',
                compressionQuality: 100,
                format: 'original',
                keepOriginals: true,
                originalRetentionDays: -1 // unlimited
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 6
        }
    ];
    
    for (const plan of plans) {
        await SubscriptionPlan.findOneAndUpdate(
            { planId: plan.planId },
            { $set: plan },
            { upsert: true, new: true }
        );
    }
    
    const planCount = await SubscriptionPlan.countDocuments();
    console.log(`✅ ${planCount} subscription plans initialized`);
    
    return planCount;
};
// ```

// ---

// ## **Where to Handle Image Compression?**

// ### **Answer: BACKEND (Server-side) is the correct approach**

// Here's why and how:

// ### **Why Backend?**

// 1. **Consistent Quality** - All users get same compression regardless of device
// 2. **Security** - Users can't bypass compression limits
// 3. **Storage Accuracy** - Track actual stored size, not upload size
// 4. **No Client Load** - Mobile devices won't slow down
// 5. **Format Control** - Convert to WebP server-side (not all browsers support client-side)
// 6. **Original Preservation** - Can keep originals for paid users

// ### **Image Compression Flow:**
// ```
// USER UPLOADS PHOTO (4MB)
//         ↓
// FRONTEND VALIDATION (basic checks)
//         ↓
// UPLOAD TO BACKEND
//         ↓
// BACKEND PROCESSING (Sharp library)
// ├── Validate file
// ├── Check user plan limits
// ├── Compress based on plan settings
// ├── Generate thumbnail
// ├── Upload to S3 (compressed + original if allowed)
// └── Save metadata to MongoDB
//         ↓
// RETURN URLS TO FRONTEND
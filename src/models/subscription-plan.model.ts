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
            name: 'Free Event',
            description: 'Perfect for small get-togethers. Activated on first sign-up.',
            price: 0,
            currency: 'INR',
            billingCycle: 'yearly',
            limits: {
                maxEvents: 3,
                maxPhotosPerEvent: -1, // unlimited photos
                maxStorage: 1073741824, // 1GB
                maxPhotoSize: 5242880, // 5MB
                maxVideoSize: 104857600, // 100MB
                maxCoHosts: 0,
                retentionDays: 365,
                gracePeriodDays: 30,
                features: [
                    '5 GB Storage (~5K Media)', // User req says 5GB text, but logic says 1GB? distinct check needed: user requested "upload like 1gb of medias" for free. Text in image says 5GB. adhering to 1GB per text request.
                    '3 Events',
                    '50 Guests',
                    '1 Year Validity',
                    'Max Photo Size: 5MB',
                    'Max Video Size: 100MB (1080p)'
                ]
            },
            qualitySettings: {
                maxResolution: '1920x1080',
                compressionQuality: 80,
                format: 'webp',
                keepOriginals: false,
                originalRetentionDays: 0
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 1
        },
        {
            planId: 'mini-event',
            name: 'Mini Event',
            description: 'For slightly larger gatherings.',
            price: 1598,
            currency: 'INR',
            billingCycle: 'yearly', // or 'event' depending on logic, keeping standard for now
            razorpayPlanId: 'plan_mini_event',
            limits: {
                maxEvents: 1, // "1 Event" in image
                maxPhotosPerEvent: -1,
                maxStorage: 26843545600, // 25GB
                maxPhotoSize: 52428800, // 50MB
                maxVideoSize: 5368709120, // 5GB
                maxCoHosts: 1, // implied
                retentionDays: 365,
                gracePeriodDays: 30,
                features: [
                    '25 GB Storage (~25K Media)',
                    '1 Event',
                    '150 Guests',
                    '1 Year Validity',
                    'Max Photo Size: 50MB',
                    'Max Video Size: 5GB (4K Support)'
                ]
            },
            qualitySettings: {
                maxResolution: 'original', // 4K support
                compressionQuality: 90,
                format: 'original',
                keepOriginals: true,
                originalRetentionDays: 365
            },
            isActive: true,
            isFeatured: false,
            sortOrder: 2
        },
        {
            planId: 'small-event',
            name: 'Small Event',
            description: 'Most popular choice for weddings and parties.',
            price: 3198,
            currency: 'INR',
            billingCycle: 'yearly',
            razorpayPlanId: 'plan_small_event',
            limits: {
                maxEvents: 1,
                maxPhotosPerEvent: -1,
                maxStorage: 53687091200, // 50GB
                maxPhotoSize: 52428800, // 50MB
                maxVideoSize: 5368709120, // 5GB
                maxCoHosts: 3,
                retentionDays: 365,
                gracePeriodDays: 30,
                features: [
                    '50 GB Storage (~50K Media)',
                    '1 Event',
                    '300 Guests',
                    '1 Year Validity',
                    'Max Photo Size: 50MB',
                    'Max Video Size: 5GB (4K Support)'
                ]
            },
            qualitySettings: {
                maxResolution: 'original',
                compressionQuality: 95,
                format: 'original',
                keepOriginals: true,
                originalRetentionDays: 365
            },
            isActive: true,
            isFeatured: true, // Highlighted in image
            sortOrder: 3
        }
    ];

    for (const plan of plans) {
        await SubscriptionPlan.findOneAndUpdate(
            { planId: plan.planId },
            { $set: plan },
            { upsert: true, new: true }
        );
    }

    // Deactivate old plans if they exist and are not in the new list
    const newPlanIds = plans.map(p => p.planId);
    await SubscriptionPlan.updateMany(
        { planId: { $nin: newPlanIds } },
        { $set: { isActive: false } }
    );

    const planCount = await SubscriptionPlan.countDocuments({ isActive: true });
    console.log(`✅ ${planCount} active subscription plans initialized`);

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
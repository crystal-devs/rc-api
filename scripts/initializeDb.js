// initializeDb.js - Script to initialize database with test data

const mongoose = require('mongoose');
require('dotenv').config();

async function connectToMongoDB() {
    try {
        const mongoUri = process.env.MONGO_URI;
        const dbName = process.env.MONGO_DB_NAME;
        
        if (!mongoUri || !dbName) {
            console.error('MongoDB connection details missing in environment variables');
            process.exit(1);
        }

        await mongoose.connect(mongoUri, {
            dbName,
        });
        
        console.log('Connected to MongoDB');
        return mongoose.connection;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}

// Define models directly to avoid import issues
const MODEL_NAMES = {
    SUBSCRIPTION_PLAN: "subscription-plans",
    USER_SUBSCRIPTION: "user-subscriptions",
    USER_USAGE: "user-usages",
    USER: "users"
};

// Define the schema for subscription plans
const planLimitsSchema = new mongoose.Schema({
    maxEvents: { type: Number, required: true },
    maxPhotosPerEvent: { type: Number, required: true },
    maxStorage: { type: Number, required: true }, // MB
    maxPhotoSize: { type: Number, required: true }, // MB
    features: { type: [String], default: [] }
}, { _id: false });

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

const SubscriptionPlan = mongoose.model(MODEL_NAMES.SUBSCRIPTION_PLAN, subscriptionPlanSchema);

// Function to create default plans
async function createDefaultPlans() {
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
    
    console.log('Creating/updating subscription plans...');
    for (const plan of plans) {
        try {
            await SubscriptionPlan.findOneAndUpdate(
                { planId: plan.planId },
                plan,
                { upsert: true, new: true }
            );
            console.log(`Plan ${plan.planId} created/updated`);
        } catch (error) {
            console.error(`Error creating plan ${plan.planId}:`, error);
        }
    }
    
    const planCount = await SubscriptionPlan.countDocuments();
    console.log(`Total plans in database: ${planCount}`);
}

// Main function
async function initialize() {
    try {
        await connectToMongoDB();
        await createDefaultPlans();
        console.log('Database initialization completed successfully');
    } catch (error) {
        console.error('Database initialization failed:', error);
    } finally {
        mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

initialize();

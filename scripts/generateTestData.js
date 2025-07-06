const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB_NAME,
    });
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error('MongoDB Connection Error:', err.message);
    process.exit(1);
  }
};

// Models (simplified versions for script use)
const SubscriptionPlanSchema = new mongoose.Schema({
  planId: String,
  name: String,
  description: String,
  price: Number,
  billingCycle: String,
  stripePriceId: String,
  limits: {
    maxEvents: Number,
    maxPhotosPerEvent: Number,
    maxStorage: Number,
    maxPhotoSize: Number,
    features: [String]
  },
  isActive: Boolean,
  isFeatured: Boolean,
  sortOrder: Number
});

const UserSubscriptionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  planId: String,
  planName: String,
  status: String,
  limits: {
    maxEvents: Number,
    maxPhotosPerEvent: Number, 
    maxStorage: Number,
    maxPhotoSize: Number,
    features: [String]
  },
  stripeSubscriptionId: String,
  stripeCustomerId: String,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: Boolean,
  createdAt: Date,
  updatedAt: Date
});

const UserUsageSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  date: Date,
  metrics: {
    photosUploaded: Number,
    storageUsed: Number,
    eventsCreated: Number,
    activeEvents: [mongoose.Schema.Types.ObjectId]
  },
  totals: {
    photos: Number,
    storage: Number,
    events: Number
  }
});

// Create models
const SubscriptionPlan = mongoose.model('subscription-plans', SubscriptionPlanSchema);
const UserSubscription = mongoose.model('user-subscriptions', UserSubscriptionSchema);
const UserUsage = mongoose.model('user-usages', UserUsageSchema);

// Generate default subscription plans
const createDefaultPlans = async () => {
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
  
  console.log('Creating default subscription plans...');
  
  for (const plan of plans) {
    await SubscriptionPlan.findOneAndUpdate(
      { planId: plan.planId },
      plan,
      { upsert: true, new: true }
    );
  }
  
  console.log('Default plans created!');
};

// Generate test user subscription data
const createTestSubscription = async () => {
  const testUserId = new mongoose.Types.ObjectId();
  const now = new Date();
  const endDate = new Date();
  endDate.setMonth(now.getMonth() + 1);
  
  // Get premium plan for limits
  const premiumPlan = await SubscriptionPlan.findOne({ planId: 'premium' });
  
  if (!premiumPlan) {
    console.error('Premium plan not found. Run createDefaultPlans first.');
    return null;
  }
  
  console.log('Creating test subscription...');
  
  const subscription = await UserSubscription.findOneAndUpdate(
    { userId: testUserId },
    {
      userId: testUserId,
      planId: 'premium',
      planName: 'Premium Plan',
      status: 'active',
      limits: premiumPlan.limits,
      stripeSubscriptionId: 'sub_test12345',
      stripeCustomerId: 'cus_test12345',
      currentPeriodStart: now,
      currentPeriodEnd: endDate,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now
    },
    { upsert: true, new: true }
  );
  
  console.log('Test subscription created!');
  console.log('Test User ID:', testUserId.toString());
  
  // Format response for frontend to show example
  const frontendResponse = {
    status: true,
    data: {
      id: subscription._id,
      userId: subscription.userId,
      planId: subscription.planId,
      planName: subscription.planName,
      status: subscription.status,
      limits: subscription.limits,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt
    }
  };
  
  console.log('\nSubscription API Response Example:');
  console.log(JSON.stringify(frontendResponse, null, 2));
  
  return testUserId;
};

// Generate test usage data
const createTestUsage = async (userId) => {
  if (!userId) {
    console.error('User ID required for creating test usage data');
    return;
  }
  
  console.log('Creating test usage data...');
  
  const now = new Date();
  
  const usage = await UserUsage.findOneAndUpdate(
    { userId: userId },
    {
      userId: userId,
      date: now,
      metrics: {
        photosUploaded: 25,
        storageUsed: 350, // MB
        eventsCreated: 2,
        activeEvents: [
          new mongoose.Types.ObjectId(),
          new mongoose.Types.ObjectId()
        ]
      },
      totals: {
        photos: 385,
        storage: 4200, // MB
        events: 12
      }
    },
    { upsert: true, new: true }
  );
  
  console.log('Test usage data created!');
  
  // Format response for frontend to show example
  const frontendResponse = {
    status: true,
    data: {
      userId: usage.userId,
      date: usage.date,
      metrics: usage.metrics,
      totals: usage.totals
    }
  };
  
  console.log('\nUsage API Response Example:');
  console.log(JSON.stringify(frontendResponse, null, 2));
};

// Run all functions in sequence
const runAll = async () => {
  await connectDB();
  await createDefaultPlans();
  const testUserId = await createTestSubscription();
  await createTestUsage(testUserId);
  
  console.log('\nAll test data created successfully!');
  console.log('To test the APIs, use the test User ID shown above.');
  
  mongoose.disconnect();
};

runAll().catch(err => {
  console.error('Error:', err);
  mongoose.disconnect();
});

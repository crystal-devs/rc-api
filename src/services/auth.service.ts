// import { keys } from "@configs/dotenv.config";
// import { User } from "@models/user.model";
// import { UserSubscription } from "@models/user-subscription.model";
// import { UserUsage } from "@models/user-usage.model";
// import { SubscriptionPlan } from "@models/subscription-plan.model";
// import jwt from "jsonwebtoken";
// import mongoose from "mongoose";
// import { logger } from "@utils/logger";

// interface LoginData {
//     email?: string;
//     phone_number?: string;
//     provider: string;
//     name?: string;
//     profile_pic?: string;
// }

// export const loginService = async ({ email, phone_number, name, profile_pic, provider }: LoginData) => {
//     try {
//         const query: any = {};
//         if (email) query.email = email;
//         if (phone_number) query.phone_number = phone_number;
        
//         let user = await User.findOne(query).lean();        

//         logger.info(`User login attempt: ${email || phone_number}`);

//         if (!user) {
//             // **Signup Flow**: If user does not exist, create a new one
//             logger.info(`Creating new user for: ${email || phone_number}`);
            
//             const newUser = await User.create({
//                 email,
//                 phone_number,
//                 role_id: new mongoose.Types.ObjectId("67dd8031cd6d859e3813e8bb"),
//                 provider,
//                 name: name || "Clicky", // Default name if not provided 
//                 profile_pic: profile_pic || "",
//                 preferences: {
//                     emailNotifications: true,
//                     defaultEventPrivacy: "private"
//                 },
//                 lastLoginAt: new Date()
//             });

//             user = newUser.toObject(); // Convert Mongoose document to plain object only for new users
            
//             // Initialize user data (subscription and usage)
//             await initializeUserData(user._id.toString());
//         } else {
//             // User exists - ensure they have subscription and usage data
//             await initializeUserData(user._id.toString());
//         }
        
//         // Generate JWT Token
//         const token = jwt.sign({user_id: user._id}, keys.jwtSecret as string, {
//             expiresIn: "1200h",
//         });

//         return {
//             token,
//             message: user?.createdAt ? "Login successful" : "Signup successful",
//             status: true,
//         };
//     } catch (error) {
//        throw(error)
//     }
// };

// /**
//  * Initializes user subscription and usage data for a new or existing user
//  */
// async function initializeUserData(userId: string) {
//     try {
//         // Check if user already has a subscription
//         const existingSubscription = await UserSubscription.findOne({ userId });
        
//         if (!existingSubscription) {
//             logger.info(`Creating default subscription for user: ${userId}`);
            
//             // Get the free plan
//             const freePlan = await SubscriptionPlan.findOne({ planId: "free" });
            
//             if (!freePlan) {
//                 logger.error("Free plan not found when initializing user data");
//                 return;
//             }
            
//             // Create expiration date (1 year from now for free plan)
//             const expirationDate = new Date();
//             expirationDate.setFullYear(expirationDate.getFullYear() + 1);
            
//             // Create new subscription
//             const newSubscription = new UserSubscription({
//                 userId: new mongoose.Types.ObjectId(userId),
//                 planId: freePlan.planId,
//                 planName: freePlan.name,
//                 status: "active",
//                 limits: freePlan.limits,
//                 currentPeriodStart: new Date(),
//                 currentPeriodEnd: expirationDate
//             });
            
//             const savedSubscription = await newSubscription.save();
            
//             // Update user with subscription ID
//             await User.findByIdAndUpdate(userId, { 
//                 subscriptionId: savedSubscription._id,
//                 lastLoginAt: new Date()
//             });
            
//             logger.info(`Created subscription ${savedSubscription._id} for user ${userId}`);
//         } else {
//             // Just update the last login time
//             await User.findByIdAndUpdate(userId, { lastLoginAt: new Date() });
//         }
        
//         // Check if user has usage data
//         const existingUsage = await UserUsage.findOne({ userId });
        
//         if (!existingUsage) {
//             logger.info(`Creating initial usage data for user: ${userId}`);
            
//             // Create initial usage data with zeros
//             const newUsage = new UserUsage({
//                 userId: new mongoose.Types.ObjectId(userId),
//                 date: new Date(),
//                 metrics: {
//                     photosUploaded: 0,
//                     storageUsed: 0,
//                     eventsCreated: 0,
//                     activeEvents: []
//                 },
//                 totals: {
//                     photos: 0,
//                     storage: 0,
//                     events: 0
//                 }
//             });
            
//             await newUsage.save();
//             logger.info(`Created initial usage data for user ${userId}`);
//         }
//     } catch (error) {
//         logger.error(`Error initializing user data: ${error}`);
//         // Don't throw the error - we don't want to interrupt the login flow
//     }
// }

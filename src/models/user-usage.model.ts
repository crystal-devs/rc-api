import mongoose, { InferSchemaType } from "mongoose";
import { MODEL_NAMES } from "./names";

// Define metrics schema
const metricsSchema = new mongoose.Schema({
    photosUploaded: { type: Number, default: 0 },
    storageUsed: { type: Number, default: 0 }, // in MB
    eventsCreated: { type: Number, default: 0 },
    activeEvents: { type: [mongoose.Schema.Types.ObjectId], ref: MODEL_NAMES.EVENT, default: [] }
}, { _id: false });

// Define totals schema
const totalsSchema = new mongoose.Schema({
    photos: { type: Number, default: 0 },
    storage: { type: Number, default: 0 }, // in MB
    events: { type: Number, default: 0 }
}, { _id: false });

// Define user usage schema
const userUsageSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: MODEL_NAMES.USER, required: true },
    date: { type: Date, default: Date.now },
    metrics: { type: metricsSchema, default: () => ({}) },
    totals: { type: totalsSchema, default: () => ({}) }
});

// Create indexes for better performance
userUsageSchema.index({ userId: 1, date: -1 });

export const UserUsage = mongoose.model(MODEL_NAMES.USER_USAGE, userUsageSchema, MODEL_NAMES.USER_USAGE);

export type UserUsageType = InferSchemaType<typeof userUsageSchema>;
export type UserUsageCreationType = Omit<UserUsageType, '_id'>;

// Helper functions

/**
 * Updates user usage when media is uploaded
 */
export const updateUsageForUpload = async (
    userId: string, 
    sizeInMB: number, 
    eventId?: string,
    session?: mongoose.ClientSession
) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Find or create today's usage record
    let todayUsage = await UserUsage.findOne({ 
        userId: new mongoose.Types.ObjectId(userId), 
        date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) } 
    }).session(session);
    
    if (!todayUsage) {
        // If no usage record exists for today, get the last one to carry over totals
        const lastUsage = await UserUsage.findOne({ 
            userId: new mongoose.Types.ObjectId(userId) 
        }).sort({ date: -1 }).session(session);
        
        todayUsage = new UserUsage({
            userId: new mongoose.Types.ObjectId(userId),
            date: now,
            metrics: {
                photosUploaded: 1,
                storageUsed: sizeInMB,
                eventsCreated: 0,
                activeEvents: eventId ? [new mongoose.Types.ObjectId(eventId)] : []
            },
            totals: {
                photos: lastUsage ? lastUsage.totals.photos + 1 : 1,
                storage: lastUsage ? lastUsage.totals.storage + sizeInMB : sizeInMB,
                events: lastUsage ? lastUsage.totals.events : 0
            }
        });
    } else {
        // Update existing record
        todayUsage.metrics.photosUploaded += 1;
        todayUsage.metrics.storageUsed += sizeInMB;
        
        // Add event to active events if not already there
        if (eventId && !todayUsage.metrics.activeEvents.includes(new mongoose.Types.ObjectId(eventId))) {
            todayUsage.metrics.activeEvents.push(new mongoose.Types.ObjectId(eventId));
        }
        
        // Update totals
        todayUsage.totals.photos += 1;
        todayUsage.totals.storage += sizeInMB;
    }
    
    if (session) {
        await todayUsage.save({ session });
    } else {
        await todayUsage.save();
    }
    return todayUsage;
};

/**
 * Updates user usage when media is deleted
 */
export const updateUsageForDelete = async (
    userId: string, 
    sizeInMB: number,
    session?: mongoose.ClientSession
) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Find or create today's usage record
    let todayUsage = await UserUsage.findOne({ 
        userId: new mongoose.Types.ObjectId(userId), 
        date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) } 
    }).session(session);
    
    if (!todayUsage) {
        // If no usage record exists for today, get the last one to carry over totals
        const lastUsage = await UserUsage.findOne({ 
            userId: new mongoose.Types.ObjectId(userId) 
        }).sort({ date: -1 }).session(session);
        
        if (!lastUsage) {
            return null; // No usage to update
        }
        
        todayUsage = new UserUsage({
            userId: new mongoose.Types.ObjectId(userId),
            date: now,
            metrics: {
                photosUploaded: 0,
                storageUsed: -sizeInMB, // Negative to represent deletion
                eventsCreated: 0,
                activeEvents: lastUsage.metrics.activeEvents
            },
            totals: {
                photos: Math.max(0, lastUsage.totals.photos - 1),
                storage: Math.max(0, lastUsage.totals.storage - sizeInMB),
                events: lastUsage.totals.events
            }
        });
    } else {
        // Update existing record
        todayUsage.metrics.storageUsed -= sizeInMB;
        
        // Update totals
        todayUsage.totals.photos = Math.max(0, todayUsage.totals.photos - 1);
        todayUsage.totals.storage = Math.max(0, todayUsage.totals.storage - sizeInMB);
    }
    
    if (session) {
        await todayUsage.save({ session });
    } else {
        await todayUsage.save();
    }
    return todayUsage;
};

/**
 * Updates user usage when an event is created
 */
export const updateUsageForEventCreation = async (
    userId: string, 
    eventId: string,
    session?: mongoose.ClientSession
) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Find or create today's usage record
    let todayUsage = await UserUsage.findOne({ 
        userId: new mongoose.Types.ObjectId(userId), 
        date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) } 
    }).session(session);
    
    if (!todayUsage) {
        // If no usage record exists for today, get the last one to carry over totals
        const lastUsage = await UserUsage.findOne({ 
            userId: new mongoose.Types.ObjectId(userId) 
        }).sort({ date: -1 }).session(session);
        
        todayUsage = new UserUsage({
            userId: new mongoose.Types.ObjectId(userId),
            date: now,
            metrics: {
                photosUploaded: 0,
                storageUsed: 0,
                eventsCreated: 1,
                activeEvents: [new mongoose.Types.ObjectId(eventId)]
            },
            totals: {
                photos: lastUsage ? lastUsage.totals.photos : 0,
                storage: lastUsage ? lastUsage.totals.storage : 0,
                events: lastUsage ? lastUsage.totals.events + 1 : 1
            }
        });
    } else {
        // Update existing record
        todayUsage.metrics.eventsCreated += 1;
        
        // Add event to active events if not already there
        if (!todayUsage.metrics.activeEvents.includes(new mongoose.Types.ObjectId(eventId))) {
            todayUsage.metrics.activeEvents.push(new mongoose.Types.ObjectId(eventId));
        }
        
        // Update totals
        todayUsage.totals.events += 1;
    }
    
    if (session) {
        await todayUsage.save({ session });
    } else {
        await todayUsage.save();
    }
    return todayUsage;
};

/**
 * Updates user usage when an event is deleted
 */
export const updateUsageForEventDeletion = async (
    userId: string, 
    eventId: string,
    session?: mongoose.ClientSession
) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Find or create today's usage record
    let todayUsage = await UserUsage.findOne({ 
        userId: new mongoose.Types.ObjectId(userId), 
        date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) } 
    }).session(session);
    
    if (!todayUsage) {
        // If no usage record exists for today, get the last one to carry over totals
        const lastUsage = await UserUsage.findOne({ 
            userId: new mongoose.Types.ObjectId(userId) 
        }).sort({ date: -1 }).session(session);
        
        if (!lastUsage) {
            return null; // No usage to update
        }
        
        // Create a new usage record for today, with event count decreased
        todayUsage = new UserUsage({
            userId: new mongoose.Types.ObjectId(userId),
            date: now,
            metrics: {
                photosUploaded: 0,
                storageUsed: 0,
                eventsCreated: 0,
                // Remove the deleted event from active events
                activeEvents: lastUsage.metrics.activeEvents.filter(id => 
                    !id.equals(new mongoose.Types.ObjectId(eventId))
                )
            },
            totals: {
                photos: lastUsage.totals.photos,
                storage: lastUsage.totals.storage,
                events: Math.max(0, lastUsage.totals.events - 1)
            }
        });
    } else {
        // Update existing record
        
        // Remove the deleted event from active events
        todayUsage.metrics.activeEvents = todayUsage.metrics.activeEvents.filter(id => 
            !id.equals(new mongoose.Types.ObjectId(eventId))
        );
        
        // Update totals
        todayUsage.totals.events = Math.max(0, todayUsage.totals.events - 1);
    }
    
    if (session) {
        await todayUsage.save({ session });
    } else {
        await todayUsage.save();
    }
    return todayUsage;
};

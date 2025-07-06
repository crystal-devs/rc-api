import { AccessControl } from "@models/access.model";
import { ActivityLog } from "@models/activity-log.model";
import { Event, EventCreationType, EventType } from "@models/event.model";
import { MODEL_NAMES } from "@models/names";
import { updateUsageForEventCreation, updateUsageForEventDeletion } from "@models/user-usage.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "types/service.types";


export const createEventService = async (eventData: EventCreationType): Promise<ServiceResponse<EventType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {

        console.log(eventData, 'event created')
        const event = await Event.create([eventData], { session });
        console.log(event, 'event created')
        if (!event[0]?._id || !eventData?.created_by) throw new Error("Invalid event or creator ID");

        await AccessControl.create([{
            resource_id: new mongoose.Types.ObjectId(event[0]._id),
            resource_type: "event",
            permissions: [{
                user_id: new mongoose.Types.ObjectId(eventData.created_by),
                role: "owner",
            }],
        }], { session });

        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(eventData.created_by),
            resource_id: new mongoose.Types.ObjectId(event[0]._id),
            resource_type: "event",
            action: "created",
        }], { session });

        // Update user usage statistics for event creation
        await updateUsageForEventCreation(
            eventData.created_by.toString(),
            event[0]._id.toString(),
            session
        );

        await session.commitTransaction();

        return {
            status: true,
            code: 201,
            message: "event created successfully",
            data: event[0],
            error: null,
            other: null
        };
    } catch (err) {
        logger.error(err);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to create event",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            },
            other: null
        };
    } finally {
        await session.endSession();
    }
}

export const geteventsByeventIdOrUserId =
    async ({ event_id, user_id }: { event_id?: string, user_id?: string })
        : Promise<ServiceResponse<EventType[]>> => {
        try {
            let events: EventType[] = [];

            if (user_id) {
                events = await AccessControl.aggregate([
                    {
                        $match: {
                            "permissions.user_id": new mongoose.Types.ObjectId(user_id),
                            // "permissions.role": { $in: ["owner", "viewer"] },
                            resource_type: "event"
                        }
                    },
                    {
                        $lookup: {
                            from: MODEL_NAMES.EVENT,
                            localField: "resource_id",
                            foreignField: "_id",
                            as: "eventData"
                        }
                    },
                    { $unwind: "$eventData" },
                    { $replaceRoot: { newRoot: "$eventData" } },
                ]);
            }

            if (event_id) {
                const event = await Event.findById(event_id).lean();
                if (event) events.push(event);
            }

            return {
                status: true,
                code: 200,
                message: "events fetched successfully",
                data: events,
                error: null,
                other: null
            };

        } catch (err: any) {
            logger.error(`[geteventService] Error fetching events: ${err.message}`);
            if (process.env.NODE_ENV === "development") console.error(err.stack);

            return {
                status: false,
                code: 500,
                message: "Failed to get event",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        }
    }

export const updateeventService = async (
    event_id: string,
    datatoupdate: Record<string, any>
): Promise<ServiceResponse<EventType>> => {
    try {
        const objectId = new mongoose.Types.ObjectId(event_id);

        // Use findOneAndUpdate with correct parameters
        const event = await Event.findOneAndUpdate(
            { _id: objectId },
            { $set: datatoupdate }, // Update operation
            { new: true } // return the updated document
        );

        if (!event) {
            return {
                status: false,
                code: 404,
                message: "event not found",
                data: null,
                error: null,
                other: null
            };
        }

        return {
            status: true,
            code: 200,
            message: "event updated successfully",
            data: event,
            error: null,
            other: null
        };
    } catch (err) {
        return {
            status: false,
            code: 500,
            message: "Failed to update event",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            },
            other: null
        };
    }
}

/**
 * Service to delete an event and update user usage
 */
export const deleteEventService = async (
    event_id: string,
    user_id: string
): Promise<ServiceResponse<{ deleted: boolean }>> => {
    logger.info(`[deleteEventService] Starting event deletion for event_id: ${event_id}, user_id: ${user_id}`);
    
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // Check if the event exists within the transaction
        const event = await Event.findById(event_id).session(session);
        if (!event) {
            logger.warn(`[deleteEventService] Event not found: ${event_id}`);
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Event not found",
                data: null,
                error: null,
                other: null
            };
        }
        
        logger.info(`[deleteEventService] Found event: ${event._id}, title: ${event.title}`);

        // Check if user has permission to delete (is owner) within the transaction
        const accessControl = await AccessControl.findOne({
            resource_id: new mongoose.Types.ObjectId(event_id),
            resource_type: "event",
            "permissions.user_id": new mongoose.Types.ObjectId(user_id),
            "permissions.role": "owner"
        }).session(session);

        if (!accessControl) {
            logger.warn(`[deleteEventService] User ${user_id} does not have permission to delete event ${event_id}`);
            await session.abortTransaction();
            return {
                status: false,
                code: 403,
                message: "You don't have permission to delete this event",
                data: null,
                error: null,
                other: null
            };
        }
        
        logger.info(`[deleteEventService] User ${user_id} has permission to delete event ${event_id}`);

        // Use findOneAndDelete to ensure we delete exactly the event we checked
        logger.info(`[deleteEventService] Attempting to delete event: ${event_id}`);
        const deletedEvent = await Event.findOneAndDelete(
            { _id: new mongoose.Types.ObjectId(event_id) },
            { session }
        );
        
        if (!deletedEvent) {
            logger.error(`[deleteEventService] Failed to delete event - findOneAndDelete returned null`);
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: "Failed to delete event - event not found or already deleted",
                data: null,
                error: null,
                other: null
            };
        }
        
        logger.info(`[deleteEventService] Successfully deleted event: ${event_id}`);
        
        // Delete associated access controls
        logger.info(`[deleteEventService] Deleting access controls for event: ${event_id}`);
        const accessDeleteResult = await AccessControl.deleteOne({ 
            resource_id: new mongoose.Types.ObjectId(event_id),
            resource_type: "event"
        }, { session });
        
        logger.info(`[deleteEventService] Access control delete result: ${JSON.stringify(accessDeleteResult)}`);
        
        // Record the activity
        logger.info(`[deleteEventService] Creating activity log entry for event deletion: ${event_id}`);
        const activityLog = await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(user_id),
            resource_id: new mongoose.Types.ObjectId(event_id),
            resource_type: "event",
            action: "deleted",
        }], { session });
        
        logger.info(`[deleteEventService] Activity log created: ${activityLog[0]._id}`);

        // Update user usage statistics
        logger.info(`[deleteEventService] Updating user usage statistics for user: ${user_id}`);
        await updateUsageForEventDeletion(user_id, event_id, session);

        logger.info(`[deleteEventService] Committing transaction for event deletion: ${event_id}`);
        await session.commitTransaction();
        logger.info(`[deleteEventService] Transaction committed successfully`);

        return {
            status: true,
            code: 200,
            message: "Event deleted successfully",
            data: { deleted: true },
            error: null,
            other: null
        };
    } catch (err) {
        logger.error(`[deleteEventService] Error deleting event: ${err.message}`);
        await session.abortTransaction();
        return {
            status: false,
            code: 500,
            message: "Failed to delete event",
            data: null,
            error: {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            },
            other: null
        };
    } finally {
        await session.endSession();
    }
}
import { AccessControl } from "@models/access.model";
import { ActivityLog } from "@models/activity-log.model";
import { Event, EventCreationType, EventType } from "@models/event.model";
import { MODEL_NAMES } from "@models/names";
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
// 2. services/event/event-core.service.ts
// ====================================

import { Event } from "@models/event.model";
import { ActivityLog } from "@models/activity-log.model";
import { updateUsageForEventCreation, updateUsageForEventDeletion } from "@models/user-usage.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "@services/media";
import { EventType } from "./event.types";
import { PhotoWall } from "@models/photowall.model";

export const createEventService = async (
    eventData: Partial<EventType>
): Promise<ServiceResponse<EventType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info(`[createEventService] Creating event: ${eventData.title}`);

        // Ensure created_by is set
        if (!eventData.created_by) {
            logger.error('[createEventService] created_by is undefined');
            throw new Error('created_by is required');
        }

        logger.info(`[createEventService] eventData.created_by = ${eventData.created_by.toString()}`);

        // Create the event
        const event = await Event.create([eventData], { session });
        if (!event[0]?._id) {
            throw new Error('Invalid event creation result');
        }

        const eventId = event[0]._id;
        const creatorId = eventData.created_by;
        const shareToken = event[0].share_token; // This should be generated in your Event model

        // 🎯 NEW: Create Photo Wall for the event
        try {
            const photoWall = await PhotoWall.create([{
                _id: `wall_${shareToken}`,
                eventId: eventId,
                shareToken: shareToken,
                settings: {
                    isEnabled: true,
                    displayMode: 'slideshow',
                    transitionDuration: 5000,
                    showUploaderNames: false,
                    autoAdvance: true,
                    newImageInsertion: 'after_current'
                },
                stats: {
                    activeViewers: 0,
                    totalViews: 0,
                    lastViewedAt: null
                },
                isActive: true
            }], { session });

            logger.info(`[createEventService] 📺 Created photo wall: ${photoWall[0]._id} for event: ${eventId}`);
        } catch (photoWallError) {
            logger.error(`[createEventService] ❌ Failed to create photo wall:`, photoWallError);
            // Don't fail the entire event creation if photo wall fails
            // Just log the error and continue
        }

        // Create activity log
        await ActivityLog.create(
            [
                {
                    user_id: creatorId,
                    resource_id: eventId,
                    resource_type: 'event',
                    action: 'created',
                    details: {
                        event_title: eventData.title,
                        template: eventData.template,
                        visibility: event[0].visibility,
                        photo_wall_created: true, // New field
                    },
                },
            ],
            { session }
        );

        // Update user usage statistics
        await updateUsageForEventCreation(creatorId.toString(), eventId.toString(), session);

        await session.commitTransaction();
        logger.info(`[createEventService] Successfully created event with photo wall: ${eventId}`);

        return {
            status: true,
            code: 201,
            message: 'Event and photo wall created successfully',
            data: event[0] as EventType,
            error: null,
            other: {
                photoWallCreated: true,
                photoWallUrl: `/wall/${shareToken}` // Frontend can use this
            },
        };
    } catch (error) {
        logger.error(`[createEventService] Error: ${error.message}`);
        await session.abortTransaction();

        return {
            status: false,
            code: 500,
            message: 'Failed to create event',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            },
            other: null,
        };
    } finally {
        await session.endSession();
    }
};

export const deleteEventService = async (
    eventId: string,
    userId: string
): Promise<ServiceResponse<{ deleted: boolean }>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info(`[deleteEventService] Starting deletion for event: ${eventId} by user: ${userId}`);

        // Check if event exists
        const event = await Event.findById(eventId).session(session);
        if (!event) {
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

        // Delete event and related data
        await Promise.all([
            Event.findOneAndDelete({ _id: new mongoose.Types.ObjectId(eventId) }, { session }),
        ]);

        // Log deletion activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(userId),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "deleted",
            details: {
                event_title: event.title,
                deleted_at: new Date()
            }
        }], { session });

        // Update user usage statistics
        await updateUsageForEventDeletion(userId, eventId, session);

        await session.commitTransaction();
        logger.info(`[deleteEventService] Successfully deleted event: ${eventId}`);

        return {
            status: true,
            code: 200,
            message: "Event deleted successfully",
            data: { deleted: true },
            error: null,
            other: null
        };
    } catch (error) {
        logger.error(`[deleteEventService] Error: ${error.message}`);
        await session.abortTransaction();

        return {
            status: false,
            code: 500,
            message: "Failed to delete event",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

export const updateEventService = async (
    eventId: string,
    updateData: any,
    userId: string
): Promise<ServiceResponse<EventType>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            { $set: updateData },
            {
                new: true,
                runValidators: true,
                session
            }
        ).populate('created_by', 'name email avatar')
            .populate('co_hosts.user_id', 'name email avatar');

        if (!updatedEvent) {
            await session.abortTransaction();
            return {
                status: false,
                code: 404,
                message: 'Event not found',
                data: null,
                error: null,
                other: null
            };
        }

        await session.commitTransaction();

        return {
            status: true,
            code: 200,
            message: 'Event updated successfully',
            data: updatedEvent,
            error: null,
            other: null
        };
    } catch (error: any) {
        await session.abortTransaction();
        logger.error('Error in updateEventService:', error);

        return {
            status: false,
            code: 500,
            message: error.message || 'Failed to update event',
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    } finally {
        await session.endSession();
    }
};

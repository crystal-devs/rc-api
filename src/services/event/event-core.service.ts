// 2. services/event/event-core.service.ts
// ====================================

import { Event } from "@models/event.model";
import { ActivityLog } from "@models/activity-log.model";
import { updateUsageForEventCreation, updateUsageForEventDeletion } from "@models/user-usage.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "@services/media";
import { EventType } from "./event.types";
import { getPhotoWallWebSocketService } from "@services/photoWallWebSocketService";

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

        // 🚀 SIMPLIFIED: Create event (photowall_settings handled by schema defaults)
        const event = await Event.create([eventData], { session });
        if (!event[0]?._id) {
            throw new Error('Invalid event creation result');
        }

        const eventId = event[0]._id;
        const creatorId = eventData.created_by;
        const shareToken = event[0].share_token;

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
                        photowall_enabled: event[0].photowall_settings?.isEnabled || true,
                    },
                },
            ],
            { session }
        );

        // Update user usage statistics
        await updateUsageForEventCreation(creatorId.toString(), eventId.toString(), session);

        await session.commitTransaction();
        logger.info(`[createEventService] Successfully created event: ${eventId}`);

        return {
            status: true,
            code: 201,
            message: 'Event created successfully',
            data: event[0] as EventType,
            error: null,
            other: {
                photoWallUrl: `/wall/${shareToken}`, // Frontend can use this
                photowallSettings: event[0].photowall_settings
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
        // Process PhotoWall settings if included
        if (updateData.photowall_settings) {
            const allowedPhotowallFields = [
                'isEnabled', 'displayMode', 'transitionDuration',
                'showUploaderNames', 'autoAdvance', 'newImageInsertion'
            ];

            const filteredPhotowallSettings: any = {};
            Object.keys(updateData.photowall_settings).forEach(key => {
                if (allowedPhotowallFields.includes(key)) {
                    filteredPhotowallSettings[`photowall_settings.${key}`] = updateData.photowall_settings[key];
                }
            });

            // Replace photowall_settings with filtered nested updates
            delete updateData.photowall_settings;
            Object.assign(updateData, filteredPhotowallSettings);
        }

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

        // If photowall settings were updated, notify WebSocket clients
        if (updateData.includes('photowall_settings')) {
            const wsService = getPhotoWallWebSocketService();
            if (wsService && updatedEvent.share_token) {
                wsService.broadcastSettingsUpdate(
                    updatedEvent.share_token,
                    updatedEvent.photowall_settings
                );
            }
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

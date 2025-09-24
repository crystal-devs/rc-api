// 2. services/event/event-core.service.ts
// ====================================

import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
import { ActivityLog } from "@models/activity-log.model";
import { updateUsageForEventCreation, updateUsageForEventDeletion } from "@models/user-usage.model";
import { logger } from "@utils/logger";
import mongoose from "mongoose";
import { ServiceResponse } from "@services/media";
import { EventType } from "./event.types";
import { getPhotoWallWebSocketService } from "@services/photoWallWebSocketService";

// Role permissions template
const ROLE_PERMISSIONS = {
    creator: {
        can_view: true,
        can_upload: true,
        can_download: true,
        can_invite_others: true,
        can_moderate_content: true,
        can_manage_participants: true,
        can_edit_event: true,
        can_delete_event: true,
        can_transfer_ownership: true
    },
    co_host: {
        can_view: true,
        can_upload: true,
        can_download: true,
        can_invite_others: true,
        can_moderate_content: true,
        can_manage_participants: true,
        can_edit_event: true,
        can_delete_event: false,
        can_transfer_ownership: false
    },
    guest: {
        can_view: true,
        can_upload: false,
        can_download: false,
        can_invite_others: false,
        can_moderate_content: false,
        can_manage_participants: false,
        can_edit_event: false,
        can_delete_event: false,
        can_transfer_ownership: false
    }
};

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

        // Create event
        const event = await Event.create([eventData], { session });
        if (!event[0]?._id) {
            throw new Error('Invalid event creation result');
        }

        const eventId = event[0]._id;
        const creatorId = eventData.created_by;
        const shareToken = event[0].share_token;

        await EventParticipant.create([{
            user_id: creatorId,
            event_id: eventId,
            role: 'creator',
            join_method: 'created_event',
            status: 'active',
            permissions: ROLE_PERMISSIONS.creator,
            joined_at: new Date(),
            last_activity_at: new Date()
        }], { session });

        // Update event stats to reflect the creator
        await Event.findByIdAndUpdate(
            eventId,
            {
                $inc: {
                    'stats.total_participants': 1,
                    'stats.creators_count': 1
                }
            },
            { session }
        );

        // Create activity log
        await ActivityLog.create([{
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
        }], { session });

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
                photoWallUrl: `/wall/${shareToken}`,
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

        // Check if event exists and user has permission to delete
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

        // Check if user has permission to delete (creator or co-host with delete permission)
        const userParticipant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        }).session(session);

        if (!userParticipant || !userParticipant.permissions.can_delete_event) {
            await session.abortTransaction();
            return {
                status: false,
                code: 403,
                message: "Insufficient permissions to delete this event",
                data: null,
                error: null,
                other: null
            };
        }

        // Delete all event participants first
        await EventParticipant.deleteMany({ event_id: new mongoose.Types.ObjectId(eventId) }, { session });

        // Delete event
        await Event.findOneAndDelete({ _id: new mongoose.Types.ObjectId(eventId) }, { session });

        // Log deletion activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(userId),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: "event",
            action: "deleted",
            details: {
                event_title: event.title,
                deleted_at: new Date(),
                deleted_by_role: userParticipant.role
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
        // Check if user has permission to edit the event
        const userParticipant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        }).session(session);

        if (!userParticipant || !userParticipant.permissions.can_edit_event) {
            await session.abortTransaction();
            return {
                status: false,
                code: 403,
                message: 'Insufficient permissions to edit this event',
                data: null,
                error: null,
                other: null
            };
        }

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
        ).populate('created_by', 'name email avatar');

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

        // Update participant's last activity
        await EventParticipant.findOneAndUpdate(
            {
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: new mongoose.Types.ObjectId(eventId)
            },
            { last_activity_at: new Date() },
            { session }
        );

        // If photowall settings were updated, notify WebSocket clients
        if ('photowall_settings' in updateData) {
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

// Helper function to get user's role in an event
export const getUserEventRole = async (
    userId: string,
    eventId: string
): Promise<ServiceResponse<{ role: string; permissions: any }>> => {
    try {
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        });

        if (!participant) {
            return {
                status: false,
                code: 404,
                message: "User is not a participant in this event",
                data: null,
                error: null,
                other: null
            };
        }

        return {
            status: true,
            code: 200,
            message: "User role retrieved successfully",
            data: {
                role: String(participant.role),
                permissions: participant.permissions
            },
            error: null,
            other: {
                join_method: participant.join_method,
                joined_at: participant.joined_at,
                last_activity_at: participant.last_activity_at
            }
        };
    } catch (error: any) {
        logger.error('Error in getUserEventRole:', error);
        return {
            status: false,
            code: 500,
            message: "Failed to get user role",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    }
};

// Helper function to get all events for a user with their roles
export const getUserEventsService = async (
    userId: string,
    filters?: {
        role?: 'creator' | 'co_host' | 'guest';
        status?: 'active' | 'pending' | 'blocked' | 'removed';
        archived?: boolean;
    }
): Promise<ServiceResponse<EventType[]>> => {
    try {
        const matchConditions: any = {
            user_id: new mongoose.Types.ObjectId(userId)
        };

        if (filters?.role) {
            matchConditions.role = filters.role;
        }

        if (filters?.status) {
            matchConditions.status = filters.status;
        } else {
            matchConditions.status = 'active'; // Default to active
        }

        const pipeline: any[] = [
            { $match: matchConditions },
            {
                $lookup: {
                    from: 'events',
                    localField: 'event_id',
                    foreignField: '_id',
                    as: 'event'
                }
            },
            { $unwind: '$event' },
            {
                $match: {
                    'event.archived_at': filters?.archived ? { $ne: null } : null
                }
            },
            {
                $addFields: {
                    'event.user_role': '$role',
                    'event.user_permissions': '$permissions'
                }
            },
            { $replaceRoot: { newRoot: '$event' } },
            { $sort: { updated_at: -1 } }
        ];

        const events = await EventParticipant.aggregate(pipeline);

        return {
            status: true,
            code: 200,
            message: "Events retrieved successfully",
            data: events,
            error: null,
            other: {
                total_count: events.length,
                filters_applied: filters
            }
        };
    } catch (error: any) {
        logger.error('Error in getUserEventsService:', error);
        return {
            status: false,
            code: 500,
            message: "Failed to get user events",
            data: null,
            error: {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            other: null
        };
    }
};
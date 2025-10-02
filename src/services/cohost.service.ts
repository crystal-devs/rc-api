// =================================================================
// 1. services/cohost.service.ts - Pure Business Logic (Updated)
// =================================================================

import { Event } from "@models/event.model";
import { EventParticipant } from "@models/event-participants.model";
import { EventInvitation } from "@models/event-invitations.model";
import { ActivityLog } from "@models/activity-log.model";
import mongoose from "mongoose";
import { logger } from "@utils/logger";

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

// Service Response Type
interface ServiceResponse<T> {
    status: boolean;
    message: string;
    data: T | null;
    error?: any;
}

// Check if user has permission to manage participants
export const checkParticipantManagementPermission = async (
    eventId: string,
    userId: string
): Promise<boolean> => {
    try {
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        });

        console.log(participant, userId, eventId, 'permissionsss');
        if (
            participant &&
            participant.permissions &&
            typeof participant.permissions.can_manage_participants === 'boolean'
        ) {
            return participant.permissions.can_manage_participants;
        }
        return false;
    } catch (error) {
        logger.error('Error checking participant management permission:', error);
        return false;
    }
};

// Create co-host invite
export const createCoHostInvite = async (
    eventId: string,
    createdBy: string,
    options?: {
        maxUses?: number;
        expiresInHours?: number;
        personalMessage?: string;
    }
): Promise<ServiceResponse<any>> => {
    try {
        const event = await Event.findById(eventId);
        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        console.log(event, 'invitationinvitation');
        // Create new invitation
        const invitation = await EventInvitation.create({
            event_id: new mongoose.Types.ObjectId(eventId),
            invitation_type: 'co_host_invite',
            invited_by: new mongoose.Types.ObjectId(createdBy),
            intended_role: 'co_host',
            expires_at: new Date(Date.now() + (options?.expiresInHours || 168) * 60 * 60 * 1000), // 7 days default
            max_uses: options?.maxUses || 10,
            personal_message: options?.personalMessage || null
        });

        console.log(invitation, 'invitationinvitation');

        
        // Update event stats
        await Event.findByIdAndUpdate(
            eventId,
            { $inc: { 'stats.pending_invitations': 1 } }
        );

        const responseData = {
            invitation_id: invitation._id,
            token: invitation.token,
            invite_link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/events/join-cohost/${invitation.token}`,
            expires_at: invitation.expires_at,
            max_uses: invitation.max_uses,
            event_title: event.title
        };

        return {
            status: true,
            message: 'Co-host invite created successfully',
            data: responseData
        };

    } catch (error) {
        logger.error('Error in createCoHostInvite:', error);
        return {
            status: false,
            message: error.message || 'Failed to create co-host invite',
            data: null,
            error
        };
    }
};

// Get co-host invite details
export const getCoHostInviteDetails = async (eventId: string): Promise<ServiceResponse<any>> => {
    try {
        const event = await Event.findById(eventId).select('title');
        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        // Get active co-host invitations
        const invitations = await EventInvitation.find({
            event_id: new mongoose.Types.ObjectId(eventId),
            invitation_type: 'co_host_invite',
            status: 'pending',
            expires_at: { $gt: new Date() }
        })
            .populate('invited_by', 'name email')
            .sort({ created_at: -1 });

        if (invitations.length === 0) {
            return {
                status: true,
                message: 'No active co-host invites found',
                data: {
                    has_invites: false,
                    event_title: event.title,
                    invitations: []
                }
            };
        }

        const formattedInvitations = invitations.map(invite => ({
            invitation_id: invite._id,
            token: invite.token,
            created_by: invite.invited_by,
            created_at: invite.createdAt,
            expires_at: invite.expires_at,
            max_uses: invite.max_uses,
            used_count: invite.used_count,
            personal_message: invite.personal_message,
            invite_link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/events/join-cohost/${invite.token}`
        }));

        return {
            status: true,
            message: 'Co-host invite details retrieved successfully',
            data: {
                has_invites: true,
                event_id: eventId,
                event_title: event.title,
                invitations: formattedInvitations
            }
        };

    } catch (error) {
        logger.error('Error in getCoHostInviteDetails:', error);
        return {
            status: false,
            message: error.message || 'Failed to get co-host invite details',
            data: null,
            error
        };
    }
};

// Join as co-host using invite token
export const joinAsCoHost = async (token: string, userId: string): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info(`[joinAsCoHost] Called with token: ${token}, userId: ${userId}`);

        // Find active invitation
        const invitation = await EventInvitation.findOne({
            token,
            invitation_type: 'co_host_invite',
            status: 'pending',
            expires_at: { $gt: new Date() },
            // $expr: { $lt: ['$used_count', '$max_uses'] } // ✅ Fixed query
        }).session(session);
        console.log(invitation, token, 'invitiatoninvitiaton')
        if (!invitation) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Invalid, expired, or exhausted co-host invite token',
                data: { event_id: null }
            };
        }

        const event = await Event.findById(invitation.event_id).session(session);
        if (!event) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Event not found',
                data: { event_id: null }
            };
        }

        // Check if user is already a participant
        const existingParticipant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: invitation.event_id
        }).session(session);

        if (existingParticipant) {
            await session.abortTransaction();

            if (existingParticipant.role === 'co_host' && existingParticipant.status === 'active') {
                return {
                    status: true,
                    message: 'You are already a co-host for this event',
                    data: {
                        event_id: event._id.toString(),
                        event_title: event.title,
                        role: existingParticipant.role,
                        status: existingParticipant.status
                    }
                };
            } else if (existingParticipant.role === 'creator') {
                return {
                    status: false,
                    message: 'You are the creator of this event',
                    data: {
                        event_id: event._id.toString(),
                        event_title: event.title
                    }
                };
            } else if (existingParticipant.status === 'blocked') {
                return {
                    status: false,
                    message: 'You are blocked from joining this event',
                    data: {
                        event_id: event._id.toString(),
                        event_title: event.title
                    }
                };
            } else {
                // Update existing participant to co-host
                existingParticipant.role = 'co_host';
                existingParticipant.status = 'active';
                existingParticipant.permissions = ROLE_PERMISSIONS.co_host;
                existingParticipant.join_method = 'co_host_invite';
                existingParticipant.invited_by = invitation.invited_by;
                existingParticipant.invited_at = invitation.createdAt;
                existingParticipant.joined_at = new Date();
                existingParticipant.last_activity_at = new Date();
                await existingParticipant.save({ session });

                // Update event stats
                await Event.findByIdAndUpdate(
                    event._id,
                    {
                        $inc: {
                            'stats.co_hosts_count': 1,
                            'stats.guests_count': -1
                        },
                        $set: { updated_at: new Date() }
                    },
                    { session }
                );
            }
        } else {
            console.log('creating new particpent')
            // Create new co-host participant
            await EventParticipant.create([{
                user_id: new mongoose.Types.ObjectId(userId),
                event_id: invitation.event_id,
                role: 'co_host',
                join_method: 'co_host_invite',
                status: 'active',
                invited_by: invitation.invited_by,
                invited_at: invitation.createdAt,
                joined_at: new Date(),
                last_activity_at: new Date(),
                permissions: ROLE_PERMISSIONS.co_host,
                stats: {
                    uploads_count: 0,
                    downloads_count: 0,
                    views_count: 0,
                    invites_sent: 0
                }
            }], { session });

            // Update event stats
            await Event.findByIdAndUpdate(
                event._id,
                {
                    $inc: {
                        'stats.total_participants': 1,
                        'stats.co_hosts_count': 1
                    },
                    $set: { updated_at: new Date() }
                },
                { session }
            );
        }

        // Update invitation usage
        await EventInvitation.findByIdAndUpdate(
            invitation._id,
            {
                $inc: { used_count: 1 },
                $push: {
                    accepted_by_users: {
                        user_id: new mongoose.Types.ObjectId(userId),
                        accepted_at: new Date()
                    }
                },
                $set: {
                    status: invitation.used_count + 1 >= invitation.max_uses ? 'accepted' : 'pending',
                    accepted_at: new Date()
                }
            },
            { session }
        );

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(userId),
            resource_id: event._id,
            resource_type: 'event',
            action: 'co_host_joined',
            details: {
                event_title: event.title,
                join_method: 'co_host_invite',
                invitation_id: invitation._id.toString()
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            message: 'Successfully joined as co-host',
            data: {
                event_id: event._id.toString(),
                event_title: event.title,
                role: 'co_host',
                status: 'active'
            }
        };

    } catch (error) {
        await session.abortTransaction();
        logger.error(`[joinAsCoHost] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to join as co-host',
            data: { event_id: null },
            error
        };
    } finally {
        await session.endSession();
    }
};

// Manage co-host actions
export const manageCoHost = async (
    eventId: string,
    coHostUserId: string,
    action: string,
    adminUserId: string
): Promise<ServiceResponse<any>> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const validActions = ['approve', 'reject', 'remove', 'block', 'unblock'];
        if (!validActions.includes(action)) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Invalid action. Use: approve, reject, remove, block, unblock',
                data: null
            };
        }

        const event = await Event.findById(eventId).session(session);
        if (!event) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        // Find the participant
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(coHostUserId),
            event_id: new mongoose.Types.ObjectId(eventId)
        }).session(session);

        if (!participant) {
            await session.abortTransaction();
            return {
                status: false,
                message: 'Participant not found',
                data: null
            };
        }

        let updateData: any = {};
        let statsUpdate: any = {};
        let message = '';

        switch (action) {
            case 'approve':
                if (participant.status !== 'pending') {
                    await session.abortTransaction();
                    return {
                        status: false,
                        message: 'Can only approve pending participants',
                        data: null
                    };
                }
                updateData = { status: 'active' };
                if (participant.role === 'co_host') {
                    statsUpdate.$inc = { 'stats.co_hosts_count': 1 };
                }
                message = 'Co-host approved successfully';
                break;

            case 'reject':
                if (participant.status !== 'pending') {
                    await session.abortTransaction();
                    return {
                        status: false,
                        message: 'Can only reject pending participants',
                        data: null
                    };
                }
                updateData = { status: 'removed', removed_at: new Date() };
                statsUpdate.$inc = { 'stats.total_participants': -1 };
                message = 'Co-host rejected successfully';
                break;

            case 'remove':
                if (participant.status === 'removed') {
                    await session.abortTransaction();
                    return {
                        status: false,
                        message: 'Participant is already removed',
                        data: null
                    };
                }
                updateData = { status: 'removed', removed_at: new Date() };
                if (participant.role === 'co_host' && participant.status === 'active') {
                    statsUpdate.$inc = {
                        'stats.co_hosts_count': -1,
                        'stats.total_participants': -1
                    };
                }
                message = 'Co-host removed successfully (they can rejoin using a new invite link)';
                break;

            case 'block':
                updateData = { status: 'blocked' };
                if (participant.role === 'co_host' && participant.status === 'active') {
                    statsUpdate.$inc = {
                        'stats.co_hosts_count': -1,
                        'stats.total_participants': -1
                    };
                }
                message = 'Co-host blocked successfully (they cannot rejoin via invite link)';
                break;

            case 'unblock':
                if (participant.status !== 'blocked') {
                    await session.abortTransaction();
                    return {
                        status: false,
                        message: 'Only blocked participants can be unblocked',
                        data: null
                    };
                }
                updateData = { status: 'active' };
                if (participant.role === 'co_host') {
                    statsUpdate.$inc = {
                        'stats.co_hosts_count': 1,
                        'stats.total_participants': 1
                    };
                }
                message = 'Co-host unblocked and restored successfully';
                break;
        }

        // Update participant
        await EventParticipant.findByIdAndUpdate(
            participant._id,
            updateData,
            { session }
        );

        // Update event stats if needed
        if (Object.keys(statsUpdate).length > 0) {
            await Event.findByIdAndUpdate(eventId, statsUpdate, { session });
        }

        // Log activity
        await ActivityLog.create([{
            user_id: new mongoose.Types.ObjectId(adminUserId),
            resource_id: new mongoose.Types.ObjectId(eventId),
            resource_type: 'event',
            action: `co_host_${action}`,
            details: {
                target_user_id: coHostUserId,
                target_role: participant.role,
                previous_status: participant.status,
                new_status: updateData.status
            }
        }], { session });

        await session.commitTransaction();

        return {
            status: true,
            message,
            data: {
                user_id: coHostUserId,
                event_id: eventId,
                action: action,
                new_status: updateData.status
            }
        };

    } catch (error) {
        await session.abortTransaction();
        logger.error(`[manageCoHost] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to manage co-host',
            data: null,
            error
        };
    } finally {
        await session.endSession();
    }
};

// Get event co-hosts
export const getEventCoHosts = async (eventId: string): Promise<ServiceResponse<any>> => {
    try {
        logger.info(`[getEventCoHosts] Fetching for event: ${eventId}`);

        const event = await Event.findById(eventId).select('title created_by');
        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        // Get all co-hosts for the event
        const coHosts = await EventParticipant.find({
            event_id: new mongoose.Types.ObjectId(eventId),
            role: 'co_host'
        })
            .populate('user_id', 'name email profile_pic')
            .populate('invited_by', 'name email')
            .sort({ joined_at: -1 });

        // Format co-hosts with proper type handling
        const formattedCoHosts = coHosts.map((coHost: any) => {
            const userInfo = coHost.user_id;
            const inviterInfo = coHost.invited_by;

            return {
                user_id: userInfo?._id,
                user_info: {
                    name: userInfo?.name,
                    email: userInfo?.email,
                    profile_pic: userInfo?.profile_pic
                },
                status: coHost.status,
                permissions: coHost.permissions,
                invited_by: inviterInfo ? {
                    id: inviterInfo._id,
                    name: inviterInfo.name
                } : null,
                invited_at: coHost.invited_at,
                joined_at: coHost.joined_at,
                last_activity_at: coHost.last_activity_at,
                stats: coHost.stats
            };
        });

        return {
            status: true,
            message: 'Co-hosts retrieved successfully',
            data: {
                event_id: eventId,
                event_title: event.title,
                event_creator: event.created_by,
                co_hosts: formattedCoHosts,
                total_count: formattedCoHosts.length
            }
        };

    } catch (error) {
        logger.error(`[getEventCoHosts] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to get event co-hosts',
            data: null,
            error
        };
    }
};

// Revoke co-host invitation
export const revokeCoHostInvite = async (
    eventId: string,
    invitationId: string,
    userId: string
): Promise<ServiceResponse<any>> => {
    try {
        const invitation = await EventInvitation.findOne({
            _id: new mongoose.Types.ObjectId(invitationId),
            event_id: new mongoose.Types.ObjectId(eventId),
            invitation_type: 'co_host_invite'
        });

        if (!invitation) {
            return {
                status: false,
                message: 'Invitation not found',
                data: null
            };
        }

        await EventInvitation.findByIdAndUpdate(
            invitationId,
            {
                status: 'revoked',
                revoked_at: new Date(),
                revoked_by: new mongoose.Types.ObjectId(userId)
            }
        );

        // Update event stats
        await Event.findByIdAndUpdate(
            eventId,
            { $inc: { 'stats.pending_invitations': -1 } }
        );

        return {
            status: true,
            message: 'Co-host invitation revoked successfully',
            data: {
                invitation_id: invitationId,
                event_id: eventId
            }
        };

    } catch (error) {
        logger.error(`[revokeCoHostInvite] Error: ${error.message}`);
        return {
            status: false,
            message: error.message || 'Failed to revoke co-host invite',
            data: null,
            error
        };
    }
};
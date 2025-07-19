import { Event } from "@models/event.model";
import mongoose from "mongoose";

export const joinAsCoHost = async (token: string, userId: string): Promise<any> => {
    try {
        console.log('🔄 Backend: joinAsCoHost called with:', { token, userId });

        // Find event with the token - Simply check if token exists
        const event = await Event.findOne({
            'co_host_invite_token.token': token
        });

        console.log('🔍 Backend: Event lookup result:', {
            found: !!event,
            eventId: event?._id,
            eventTitle: event?.title
        });

        if (!event) {
            console.log('❌ Backend: No event found for token');
            return {
                status: false,
                message: 'Invalid co-host invite token',
                data: null
            };
        }

        // Check if user is already a co-host
        const existingCoHost = event.co_hosts.find(
            coHost => coHost.user_id.toString() === userId
        );

        if (existingCoHost) {
            console.log('❌ Backend: User is already a co-host:', existingCoHost.status);
            return {
                status: false,
                message: 'You are already a co-host for this event',
                data: { status: existingCoHost.status }
            };
        }

        // Check if user is the event creator
        if (event.created_by.toString() === userId) {
            console.log('❌ Backend: User is event creator');
            return {
                status: false,
                message: 'Event creator cannot be added as co-host',
                data: null
            };
        }

        // Add user as approved co-host
        const newCoHost = {
            user_id: new mongoose.Types.ObjectId(userId),
            invited_by: event.co_host_invite_token.created_by,
            status: 'approved',
            permissions: {
                manage_content: true,
                manage_guests: false,
                manage_settings: false,
                approve_content: true
            },
            joined_at: new Date()
        };

        console.log('✅ Backend: Adding new co-host:', newCoHost);

        // Update event with new co-host - no need to increment usage count
        const updatedEvent = await Event.findByIdAndUpdate(
            event._id,
            {
                $push: { co_hosts: newCoHost },
                $inc: { 
                    'stats.participants': 1  // Updated based on new schema
                },
                $set: { updated_at: new Date() }
            },
            { new: true }
        ).populate('co_hosts.user_id', 'name email avatar');

        console.log('✅ Backend: Successfully added co-host');

        return {
            status: true,
            message: 'Successfully joined as co-host.',
            data: {
                event_id: event._id,
                event_title: event.title,
                status: 'approved',
                co_host: newCoHost
            }
        };
    } catch (error) {
        console.error('❌ Backend: Error in joinAsCoHost:', error);
        return {
            status: false,
            message: error.message || 'Failed to join as co-host',
            data: null
        };
    }
};

// Deactivate co-host invite token
export const deactivateCoHostInvite = async (eventId: string, userId: string): Promise<any> => {
    try {
        // Simply remove the co_host_invite_token from the event
        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            {
                $unset: {
                    'co_host_invite_token': ""
                },
                $set: { updated_at: new Date() }
            },
            { new: true }
        );

        if (!updatedEvent) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        return {
            status: true,
            message: 'Co-host invite token deactivated successfully',
            data: {
                event_id: eventId,
                token_deactivated: true
            }
        };
    } catch (error) {
        return {
            status: false,
            message: error.message || 'Failed to deactivate co-host invite',
            data: null
        };
    }
};

// Manage co-host (approve/reject/remove)
export const manageCoHost = async (
    eventId: string,
    coHostUserId: string,
    action: string,
    adminUserId: string
): Promise<any> => {
    try {
        const event = await Event.findById(eventId);
        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        // Find the co-host
        const coHostIndex = event.co_hosts.findIndex(
            coHost => coHost.user_id.toString() === coHostUserId
        );

        if (coHostIndex === -1) {
            return {
                status: false,
                message: 'Co-host not found',
                data: null
            };
        }

        const coHost = event.co_hosts[coHostIndex];
        let updateQuery: any = {};
        let message = '';

        switch (action) {
            case 'approve':
                if (coHost.status !== 'pending') {
                    return {
                        status: false,
                        message: 'Only pending co-hosts can be approved',
                        data: null
                    };
                }
                updateQuery = {
                    $set: {
                        [`co_hosts.${coHostIndex}.status`]: 'approved',
                        [`co_hosts.${coHostIndex}.approved_by`]: new mongoose.Types.ObjectId(adminUserId),
                        updated_at: new Date()
                    }
                };
                message = 'Co-host approved successfully';
                break;

            case 'reject':
                if (coHost.status !== 'pending') {
                    return {
                        status: false,
                        message: 'Only pending co-hosts can be rejected',
                        data: null
                    };
                }
                updateQuery = {
                    $set: {
                        [`co_hosts.${coHostIndex}.status`]: 'rejected',
                        [`co_hosts.${coHostIndex}.approved_by`]: new mongoose.Types.ObjectId(adminUserId),
                        updated_at: new Date()
                    }
                };
                message = 'Co-host rejected successfully';
                break;

            case 'remove':
                if (coHost.status === 'removed') {
                    return {
                        status: false,
                        message: 'Co-host is already removed',
                        data: null
                    };
                }
                updateQuery = {
                    $set: {
                        [`co_hosts.${coHostIndex}.status`]: 'removed',
                        [`co_hosts.${coHostIndex}.approved_by`]: new mongoose.Types.ObjectId(adminUserId),
                        updated_at: new Date()
                    },
                    $inc: { 'stats.participants': -1 }  // Updated based on new schema
                };
                message = 'Co-host removed successfully';
                break;

            default:
                return {
                    status: false,
                    message: 'Invalid action',
                    data: null
                };
        }

        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            updateQuery,
            { new: true }
        ).populate('co_hosts.user_id', 'name email avatar');

        return {
            status: true,
            message,
            data: {
                event_id: eventId,
                co_host: updatedEvent.co_hosts[coHostIndex],
                action_taken: action
            }
        };
    } catch (error) {
        return {
            status: false,
            message: error.message || 'Failed to manage co-host',
            data: null
        };
    }
};

// Get event co-hosts
export const getEventCoHosts = async (eventId: string): Promise<any> => {
    try {
        const event = await Event.findById(eventId)
            .select('title co_hosts created_by stats.participants')  // Updated field selection
            .populate('co_hosts.user_id', 'name email avatar')
            .populate('co_hosts.invited_by', 'name email')
            .populate('co_hosts.approved_by', 'name email')
            .populate('created_by', 'name email avatar');

        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        // Separate co-hosts by status
        const coHostsByStatus = {
            approved: event.co_hosts.filter(ch => ch.status === 'approved'),
            pending: event.co_hosts.filter(ch => ch.status === 'pending'),
            rejected: event.co_hosts.filter(ch => ch.status === 'rejected'),
            removed: event.co_hosts.filter(ch => ch.status === 'removed')
        };

        return {
            status: true,
            message: 'Co-hosts retrieved successfully',
            data: {
                event_id: eventId,
                event_title: event.title,
                event_creator: event.created_by,
                co_hosts_by_status: coHostsByStatus,
                summary: {
                    approved: coHostsByStatus.approved.length,
                    pending: coHostsByStatus.pending.length,
                    rejected: coHostsByStatus.rejected.length,
                    removed: coHostsByStatus.removed.length
                }
            }
        };
    } catch (error) {
        return {
            status: false,
            message: error.message || 'Failed to get event co-hosts',
            data: null
        };
    }
};

// Check view permission (for co-hosts list)
export const checkViewPermission = async (eventId: string, userId: string): Promise<boolean> => {
    try {
        const event = await Event.findById(eventId);
        if (!event) return false;

        // Event creator has permission
        if (event.created_by.toString() === userId) return true;

        // Approved co-hosts have permission
        const coHost = event.co_hosts.find(
            ch => ch.user_id.toString() === userId && ch.status === 'approved'
        );
        return !!coHost;
    } catch (error) {
        return false;
    }
};

export const generateCoHostInviteToken = async (
    eventId: string,
    createdBy: string,
    expiresInHours: number = 24,
    maxUses: number = 10
): Promise<{ status: boolean, message: string, data: any }> => {
    try {
        // Validate inputs
        if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
            return {
                status: false,
                message: 'Invalid event ID',
                data: null
            };
        }

        if (!createdBy || !mongoose.Types.ObjectId.isValid(createdBy)) {
            return {
                status: false,
                message: 'Invalid user ID',
                data: null
            };
        }

        // Check if event exists
        const event = await Event.findById(eventId);
        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        // Generate unique token - using format similar to your schema
        const token = event.co_host_invite_token.token;
        // const token = `coh_${eventId}_${Math.random().toString(36).substr(2, 6)}`;

        // Update event with new co-host invite token - simplified structure
        const updatedEvent = await Event.findByIdAndUpdate(
            eventId,
            {
                $set: {
                    co_host_invite_token: {
                        token,
                        created_by: new mongoose.Types.ObjectId(createdBy),
                        created_at: new Date(),
                        expires_at: new Date(Date.now() + (expiresInHours * 60 * 60 * 1000)),
                        is_active: true,
                        max_uses: maxUses,
                        used_count: 0
                    },
                    updated_at: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!updatedEvent) {
            return {
                status: false,
                message: 'Failed to update event with co-host invite',
                data: null
            };
        }

        // Prepare simplified response data
        const responseData = {
            token,
            invite_link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/events/join-cohost/${token}`
        };

        return {
            status: true,
            message: 'Co-host invite token generated successfully',
            data: responseData
        };

    } catch (error) {
        console.error('Error in generateCoHostInviteToken:', error);
        return {
            status: false,
            message: error.message || 'Failed to generate co-host invite token',
            data: null
        };
    }
};

// Simplified getCoHostInviteDetails service
export const getCoHostInviteDetails = async (eventId: string): Promise<{ status: boolean, message: string, data: any }> => {
    try {
        const event = await Event.findById(eventId)
            .select('co_host_invite_token title')
            .populate('co_host_invite_token.created_by', 'name email');

        if (!event) {
            return {
                status: false,
                message: 'Event not found',
                data: null
            };
        }

        if (!event.co_host_invite_token) {
            return {
                status: true,
                message: 'No co-host invite found',
                data: {
                    has_invite: false,
                    event_title: event.title
                }
            };
        }

        const invite = event.co_host_invite_token;

        const responseData = {
            has_invite: true,
            event_title: event.title,
            token: invite.token,
            created_by: invite.created_by,
            created_at: invite.created_at.toISOString(),
            invite_link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/events/join-cohost/${invite.token}`
        };

        return {
            status: true,
            message: 'Co-host invite details retrieved successfully',
            data: responseData
        };

    } catch (error) {
        console.error('Error in getCoHostInviteDetails:', error);
        return {
            status: false,
            message: error.message || 'Failed to get co-host invite details',
            data: null
        };
    }
};
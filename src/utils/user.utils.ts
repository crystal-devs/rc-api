import { EventParticipant } from '@models/event-participants.model';
import { Event } from '@models/event.model';
import mongoose from 'mongoose';

export interface UserEventRole {
    role: 'creator' | 'co_host' | 'moderator' | 'guest' | 'viewer' | null;
    canAutoApprove: boolean;
}

/**
 * Check user's role and permissions in an event
 */
export const getUserEventRole = async (
    eventId: string, 
    userId: string
): Promise<UserEventRole | null> => {
    try {
        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        }).lean();

        if (!participant) {
            return {
                role: null,
                canAutoApprove: false
            };
        }

        // Auto-approve based on role or specific permission
        const canAutoApprove =
            (typeof participant.role === 'string' && ['creator', 'co_host'].includes(participant.role)) ||
            Boolean(participant.permissions && (participant.permissions as any).can_approve_content);

        return {
            role: typeof participant.role === 'string' &&
                  ['creator', 'co_host', 'moderator', 'guest', 'viewer'].includes(participant.role)
                ? participant.role as UserEventRole['role']
                : null,
            canAutoApprove
        };
    } catch (error) {
        console.error('Error checking user event role:', error);
        return null;
    }
};

/**
 * Determine approval status for media upload based on user role and event settings
 */
export const determineApprovalStatus = async (
    eventId: string,
    userId: string
): Promise<{
    status: 'pending' | 'approved' | 'auto_approved';
    autoApprovalReason: string | null;
    approvedBy: mongoose.Types.ObjectId | null;
    approvedAt: Date | null;
}> => {
    const userRole = await getUserEventRole(eventId, userId);
    const event = await Event.findById(eventId);
    
    if (!userRole || !event) {
        return {
            status: 'pending',
            autoApprovalReason: null,
            approvedBy: null,
            approvedAt: null
        };
    }

    // Auto-approve for creators, co-hosts, and users with approval permission
    if (userRole.canAutoApprove) {
        const approvalReason = userRole.role === 'creator' ? 'host_setting' : 'authenticated_user';
        return {
            status: 'auto_approved',
            autoApprovalReason: approvalReason,
            approvedBy: new mongoose.Types.ObjectId(userId),
            approvedAt: new Date()
        };
    }

    // For guests, check event permissions
    if (!event.permissions?.require_approval) {
        return {
            status: 'auto_approved',
            autoApprovalReason: 'host_setting',
            approvedBy: null,
            approvedAt: new Date()
        };
    }

    // Default: require approval
    return {
        status: 'pending',
        autoApprovalReason: null,
        approvedBy: null,
        approvedAt: null
    };
};
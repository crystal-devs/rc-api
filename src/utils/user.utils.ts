import { EventParticipant } from '@models/event-participants.model';
import { Event } from '@models/event.model';
import { normalizeRole, isAdminRole, type CanonicalRole } from '@utils/role.utils';
import mongoose from 'mongoose';

export interface UserEventRole {
    role: CanonicalRole | null;
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

        // Auto-approve based on role (legacy values normalized) — the stored
        // permission blob is deprecated and no longer consulted.
        const canAutoApprove = isAdminRole(participant.role);

        return {
            role: normalizeRole(participant.role),
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
    userId?: string
): Promise<{
    status: 'pending' | 'approved' | 'auto_approved';
    autoApprovalReason: string | null;
    approvedBy: mongoose.Types.ObjectId | null;
    approvedAt: Date | null;
}> => {
    const event = await Event.findById(eventId);
    
    if (!event) {
        return {
            status: 'pending',
            autoApprovalReason: null,
            approvedBy: null,
            approvedAt: null
        };
    }

    if (userId) {
        const userRole = await getUserEventRole(eventId, userId);
        
        // Auto-approve for creators, co-hosts, and users with approval permission
        if (userRole && userRole.canAutoApprove) {
            const approvalReason = userRole.role === 'creator' ? 'host_setting' : 'authenticated_user';
            return {
                status: 'auto_approved',
                autoApprovalReason: approvalReason,
                approvedBy: new mongoose.Types.ObjectId(userId),
                approvedAt: new Date()
            };
        }
    }

    // For guests (no user ID) or regular users without auto-approve permission, check event permissions
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
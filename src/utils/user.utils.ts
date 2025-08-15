// Helper functions for event role checking
import { Event } from '@models/event.model';
import mongoose from 'mongoose';

export interface UserEventRole {
    isEventCreator: boolean;
    isCoHost: boolean;
    isGuest: boolean;
    canAutoApprove: boolean;
    role: 'creator' | 'co-host' | 'guest';
}

/**
 * Check user's role and permissions in an event
 */
export const getUserEventRole = async (
    eventId: string, 
    userId: string
): Promise<UserEventRole | null> => {
    try {
        const event = await Event.findById(eventId);
        if (!event) {
            return null;
        }

        const isEventCreator = event.created_by.toString() === userId;
        const coHost = event.co_hosts.find(cohost => 
            cohost.user_id.toString() === userId && 
            cohost.status === 'approved'
        );
        const isCoHost = !!coHost;
        const isGuest = !isEventCreator && !isCoHost;

        return {
            isEventCreator,
            isCoHost,
            isGuest,
            canAutoApprove: isEventCreator || isCoHost,
            role: isEventCreator ? 'creator' : isCoHost ? 'co-host' : 'guest'
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

    // Auto-approve for event creator and co-hosts
    if (userRole.canAutoApprove) {
        const approvalReason = userRole.isEventCreator ? 'host_setting' : 'authenticated_user';
        return {
            status: 'auto_approved',
            autoApprovalReason: approvalReason,
            approvedBy: new mongoose.Types.ObjectId(userId),
            approvedAt: new Date()
        };
    }

    // For guests, check event permissions
    if (!event.permissions.require_approval) {
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
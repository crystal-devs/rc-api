// ====================================
// 2. services/event/access/share-validation.service.ts
// ====================================

import { logger } from "@utils/logger";
import type { EventVisibility, AccessCheckResult } from './access.types';
import { EventInvitation } from '@models/event-invitations.model';
import { EventParticipant } from '@models/event-participants.model';
import { User } from '@models/user.model';
import mongoose from 'mongoose';

export class ShareValidationService {
    /**
     * Validate share settings (expiration, active status)
     */
    validateShareSettings(shareSettings: any) {
        if (!shareSettings?.is_active) {
            return {
                status: false,
                code: 403,
                message: 'Share link is inactive',
                data: null as any,
                error: { message: 'This share link has been deactivated' },
                other: null as any,
            };
        }

        if (shareSettings?.expires_at && new Date(shareSettings.expires_at) < new Date()) {
            return {
                status: false,
                code: 403,
                message: 'Share link has expired',
                data: null,
                error: { message: 'This invitation has expired' },
                other: null,
            };
        }

        return null;
    }

    /**
     * Check if user has access based on event visibility
     */
    checkVisibilityAccess(
        visibility: EventVisibility,
        authToken?: string,
        userEmail?: string,
        eventId?: string
    ): AccessCheckResult {
        switch (visibility) {
            case 'private':
                return {
                    valid: false,
                    reason: "This is a private event. Please use the direct event link if you're an owner or co-host."
                };

            case 'invited_only':
                if (!authToken || !userEmail) {
                    return {
                        valid: false,
                        reason: "This event requires you to log in to access.",
                        requiresAuth: true
                    };
                }

                if (!eventId) {
                    return {
                        valid: false,
                        reason: "Event ID is required for invitation validation."
                    };
                }

                const isInvited = this.checkIfUserIsInvited(userEmail, eventId);
                if (!isInvited) {
                    return {
                        valid: false,
                        reason: "You are not invited to this event. Please contact the event host for access."
                    };
                }
                break;

            case 'anyone_with_link':
            default:
                break;
        }

        return { valid: true };
    }

    /**
     * Check if user is invited to the event or already a participant
     */
    private async checkIfUserIsInvited(userEmail: string, eventId: string): Promise<boolean> {
        try {
            // Check if user is already a participant
            const existingParticipant = await EventParticipant.findOne({
                event_id: new mongoose.Types.ObjectId(eventId),
                user_id: { $exists: true }, // Only check registered users for invited_only
                status: 'active'
            });

            if (existingParticipant) {
                // Check if this participant's user email matches
                const user = await User.findById(existingParticipant.user_id);
                if (user && user.email === userEmail) {
                    return true;
                }
            }

            // Check for pending/accepted invitations
            const invitation = await EventInvitation.findOne({
                event_id: new mongoose.Types.ObjectId(eventId),
                invitee_email: userEmail,
                status: { $in: ['pending', 'accepted'] },
                expires_at: { $gt: new Date() }
            });

            return !!invitation;
        } catch (error) {
            logger.error(`Error checking user invitation for event ${eventId}:`, error);
            return false;
        }
    }
}

// Singleton instance
export const shareValidationService = new ShareValidationService();
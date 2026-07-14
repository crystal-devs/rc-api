// services/websocket/management/websocket-auth.service.ts - Updated for Subscription Pattern
// ====================================

import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import type { AuthData, WebSocketUser, ClientConnectionState } from '../websocket.types';
import { EventParticipant } from '@models/event-participants.model';
import { isAdminRole, roleToSocketType } from '@utils/role.utils';
import mongoose from 'mongoose';

export const authenticateConnection = async (
    socket: Socket,
    authData: AuthData,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    try {
        let event;
        let actualEventId: string;

        // Photo wall (and other share-link clients) connect with only a share
        // token — fall back to it when no eventId is sent.
        const eventRef = authData.eventId || authData.shareToken;
        if (!eventRef) {
            socket.emit('auth_error', { message: 'Authentication required' });
            return;
        }

        if (eventRef.startsWith('evt_')) {
            event = await Event.findOne({ share_token: eventRef })
                .populate('created_by', 'name email');
            actualEventId = event?._id.toString() || '';
        } else {
            event = await Event.findById(eventRef)
                .populate('created_by', 'name email');
            actualEventId = eventRef;
        }

        if (!event) {
            socket.emit('auth_error', { message: 'Event not found' });
            return;
        }

        let user: WebSocketUser;

        if (authData.token && !authData.shareToken) {
            const decoded = jwt.verify(authData.token, keys.jwtSecret as string) as any;
            const userId: string = decoded.user_id;

            if (event.created_by._id.toString() === userId) {
                user = {
                    id: userId,
                    name: (event.created_by as any).name || 'Admin',
                    type: 'admin',
                    eventId: actualEventId
                };
            } else {
                // Type from the participant record — a valid JWT alone proves identity,
                // not event privileges. Non-participants and guest-role participants
                // connect as guests (guest room, view-level broadcasts only).
                const participant = await EventParticipant.findOne({
                    user_id: new mongoose.Types.ObjectId(userId),
                    event_id: new mongoose.Types.ObjectId(actualEventId),
                    status: 'active'
                }).select('role').lean();

                user = {
                    id: userId,
                    name: decoded.name || 'Member',
                    type: roleToSocketType(participant?.role),
                    eventId: actualEventId
                };
            }
        } else if (authData.shareToken || authData.userType === 'guest') {
            const shareToken = authData.shareToken || authData.eventId;

            if (event.share_token !== shareToken && shareToken !== actualEventId) {
                socket.emit('auth_error', { message: 'Invalid share token' });
                return;
            }

            user = {
                id: `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name: authData.guestName || 'Anonymous Guest',
                type: 'guest',
                eventId: actualEventId,
                shareToken: shareToken
            };
        } else {
            socket.emit('auth_error', { message: 'Authentication required' });
            return;
        }

        socket.data = {
            authenticated: true,
            user: user
        };

        const now = new Date();
        connectedClients.set(socket.id, {
            user: user,
            rooms: [],
            connectedAt: now,
            lastHeartbeat: now,
            isHealthy: true,
            reconnectCount: 0
        });

        socket.emit('auth_success', {
            success: true,
            user: {
                id: user.id,
                name: user.name,
                type: user.type
            },
            eventId: actualEventId,
            connectionSettings: {
                heartbeatInterval: 30000,
                heartbeatTimeout: 60000
            }
        });

        logger.info(`✅ Authenticated: ${socket.id} as ${user.type} - ${user.name} (ID: ${user.id})`);

    } catch (error: any) {
        logger.error(`❌ Auth failed ${socket.id}:`, error.message);
        socket.emit('auth_error', { message: 'Authentication failed' });
    }
};


// NEW: Handle event subscription with validation
export const handleSubscription = async (
    socket: Socket,
    eventId: string,
    shareToken: string,
    connectedClients: Map<string, ClientConnectionState>
): Promise<boolean> => {
    if (!socket.data?.authenticated || !socket.data?.user) {
        logger.warn(`❌ Subscription denied - not authenticated: ${socket.id}`);
        return false;
    }

    const user = socket.data.user;

    // DEBUGGING: Log the user object to see what we have
    logger.info(`🔍 Subscription validation for user:`, {
        userId: user.id,
        userName: user.name,
        userType: user.type,
        userEventId: user.eventId,
        targetEventId: eventId,
        shareToken: shareToken?.substring(0, 8) + '...'
    });

    try {
        // For admin/co_host users
        if (user.type === 'admin' || user.type === 'co_host') {
            // ADDED: Check if user.id exists
            if (!user.id) {
                logger.error(`❌ User ID is missing for ${user.type} user on socket ${socket.id}`);
                return false;
            }

            // Check if they have access to this specific event
            const hasAccess = await validateAdminEventAccess(user.id, eventId);
            if (hasAccess) {
                logger.info(`✅ Admin/Co-host ${user.id} granted access to event ${eventId}`);
                return true;
            }

            // FALLBACK: If it's the same event they're authenticated for
            if (user.eventId === eventId) {
                logger.info(`✅ User ${user.id} accessing their authenticated event ${eventId}`);
                return true;
            }

            logger.warn(`❌ Admin/Co-host ${user.id} denied access to event ${eventId}`);
            return false;
        }

        // For guest users
        else if (user.type === 'guest') {
            // Logged-in users with guest-level role have a real user id (anonymous
            // guests get a synthetic `guest_...` id) — validate via participant record.
            if (user.id && mongoose.isValidObjectId(user.id)) {
                const isParticipant = await EventParticipant.exists({
                    user_id: new mongoose.Types.ObjectId(user.id),
                    event_id: new mongoose.Types.ObjectId(eventId),
                    status: 'active'
                });

                if (isParticipant) {
                    logger.info(`✅ Logged-in guest ${user.id} granted access to event ${eventId}`);
                    return true;
                }
            }

            const tokenToValidate = shareToken || user.shareToken || user.eventId;
            const hasAccess = await validateGuestEventAccess(eventId, tokenToValidate);

            if (hasAccess) {
                logger.info(`✅ Guest granted access to event ${eventId}`);
                return true;
            }

            // FALLBACK: Check if it's their authenticated event
            if (user.eventId === eventId) {
                logger.info(`✅ Guest accessing their authenticated event ${eventId}`);
                return true;
            }

            logger.warn(`❌ Guest denied access to event ${eventId}`);
            return false;
        }

        logger.warn(`❌ Unknown user type: ${user.type}`);
        return false;

    } catch (error: any) {
        logger.error(`❌ Subscription validation failed for ${socket.id}:`, error.message);
        return false;
    }
};
// NEW: Handle event unsubscription
export const handleUnsubscription = async (
    socket: Socket,
    eventId: string,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    if (!socket.data?.authenticated || !socket.data?.user) {
        return;
    }

    try {
        // Update client state (remove from rooms for backward compatibility)
        const client = connectedClients.get(socket.id);
        if (client) {
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;

            client.rooms = client.rooms.filter(room =>
                room !== adminRoom && room !== guestRoom
            );
        }

        logger.info(`✅ Unsubscription processed: ${socket.id} from event ${eventId}`);

    } catch (error: any) {
        logger.error(`❌ Unsubscription failed for ${socket.id}:`, error.message);
    }
};

// Helper function to validate admin/co-host access to event
export const validateAdminEventAccess = async (
    userId: string,
    eventId: string
): Promise<boolean> => {
    try {
        logger.info(`Validating admin access: userId=${userId}, eventId=${eventId}`);

        // The event creator always has admin access, even if their participant
        // record is missing or carries a stale role (legacy data).
        const event = await Event.findById(eventId).select('created_by').lean();
        if (event?.created_by?.toString() === userId) {
            logger.info(`User ${userId} has admin access to event ${eventId} (event creator)`);
            return true;
        }

        const participant = await EventParticipant.findOne({
            user_id: new mongoose.Types.ObjectId(userId),
            event_id: new mongoose.Types.ObjectId(eventId),
            status: 'active'
        });

        if (!participant) {
            logger.warn(`User ${userId} is not a participant in event ${eventId}`);
            return false;
        }

        // Normalize legacy role values (moderator/viewer/...) before comparing
        const hasAdminAccess = isAdminRole(participant.role) ||
            participant.permissions?.can_manage_participants === true;

        if (hasAdminAccess) {
            logger.info(`User ${userId} has admin access to event ${eventId} (role: ${participant.role})`);
            return true;
        }

        logger.info(`User ${userId} has no admin access to event ${eventId} (role: ${participant.role})`);
        return false;

    } catch (error) {
        logger.error(`Admin access validation error:`, error);
        return false;
    }
};

// Helper function to validate guest access to event
const validateGuestEventAccess = async (eventId: string, shareToken: string): Promise<boolean> => {
    try {
        const event = await Event.findById(eventId);

        if (!event) {
            return false;
        }

        // Check if share token matches
        if (event.share_token !== shareToken) {
            return false;
        }

        // Check if event sharing is active
        if (!event.share_settings.is_active) {
            logger.warn(`❌ Event ${eventId} sharing is disabled`);
            return false;
        }

        // Check if share link has expired
        if (event.share_settings.expires_at && new Date() > new Date(event.share_settings.expires_at)) {
            logger.warn(`❌ Event ${eventId} share link has expired`);
            return false;
        }

        // Check event visibility
        if (event.visibility === 'private') {
            logger.warn(`❌ Event ${eventId} is private`);
            return false;
        }

        return true;

    } catch (error: any) {
        logger.error(`❌ Guest access validation failed:`, error);
        return false;
    }
};

// LEGACY: Keeping these for backward compatibility
export const handleRoomJoin = async (
    socket: Socket,
    eventId: string,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    logger.info(`🔄 Legacy handleRoomJoin called for ${socket.id}, converting to subscription`);

    const isValid = await handleSubscription(socket, eventId, '', connectedClients);

    if (isValid && socket.data?.authenticated && socket.data?.user?.eventId === eventId) {
        const user = socket.data.user;
        const targetRoom = (user.type === 'admin' || user.type === 'co_host')
            ? `admin_${eventId}`
            : `guest_${eventId}`;

        socket.emit('joined_event', {
            eventId,
            room: targetRoom,
            userType: user.type
        });

        logger.info(`✅ Legacy room join processed: ${socket.id} -> ${targetRoom}`);
    } else {
        socket.emit('join_error', { message: 'Failed to join room' });
    }
};

export const handleRoomLeave = async (
    socket: Socket,
    eventId: string,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    logger.info(`🔄 Legacy handleRoomLeave called for ${socket.id}, converting to unsubscription`);
    await handleUnsubscription(socket, eventId, connectedClients);
};
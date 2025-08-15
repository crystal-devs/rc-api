// 2. services/websocket/management/websocket-auth.service.ts
// ====================================

import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import type { AuthData, WebSocketUser, ClientConnectionState } from '../websocket.types';

export const authenticateConnection = async (
    socket: Socket,
    authData: AuthData,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    try {
        let event;
        let actualEventId: string;

        if (authData.eventId.startsWith('evt_')) {
            event = await Event.findOne({ share_token: authData.eventId })
                .populate('created_by', 'name email');
            actualEventId = event?._id.toString() || '';
        } else {
            event = await Event.findById(authData.eventId)
                .populate('created_by', 'name email');
            actualEventId = authData.eventId;
        }

        if (!event) {
            socket.emit('auth_error', { message: 'Event not found' });
            return;
        }

        let user: WebSocketUser;

        if (authData.token && !authData.shareToken) {
            const decoded = jwt.verify(authData.token, keys.jwtSecret as string) as any;

            if (event.created_by._id.toString() === decoded.userId) {
                user = {
                    id: decoded.userId,
                    name: (event.created_by as any).name || 'Admin',
                    type: 'admin',
                    eventId: actualEventId
                };
            } else {
                user = {
                    id: decoded.userId,
                    name: decoded.name || 'Co-host',
                    type: 'co_host',
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

        // Enhanced client state
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

        logger.info(`✅ Authenticated: ${socket.id} as ${user.type} - ${user.name}`);

    } catch (error: any) {
        logger.error(`❌ Auth failed ${socket.id}:`, error.message);
        socket.emit('auth_error', { message: 'Authentication failed' });
    }
};

export const handleRoomJoin = async (
    socket: Socket,
    eventId: string,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    if (socket.data?.authenticated && socket.data?.user?.eventId === eventId) {
        const adminRoom = `admin_${eventId}`;
        const guestRoom = `guest_${eventId}`;
        const user = socket.data.user;
        const targetRoom = (user.type === 'admin' || user.type === 'co_host') ? adminRoom : guestRoom;

        try {
            const client = connectedClients.get(socket.id);
            const alreadyInRoom = client?.rooms.includes(targetRoom);

            if (!alreadyInRoom && client) {
                await socket.join(targetRoom);
                client.rooms.push(targetRoom);
                logger.info(`👥 ${socket.id} (${user.type}) joined room: ${targetRoom}`);
            }

            socket.emit('joined_event', {
                eventId,
                room: targetRoom,
                userType: user.type
            });

        } catch (error) {
            logger.error(`❌ Error joining room ${targetRoom}:`, error);
            socket.emit('join_error', { message: 'Failed to join room' });
        }
    }
};

export const handleRoomLeave = async (
    socket: Socket,
    eventId: string,
    connectedClients: Map<string, ClientConnectionState>
): Promise<void> => {
    const adminRoom = `admin_${eventId}`;
    const guestRoom = `guest_${eventId}`;

    try {
        await socket.leave(adminRoom);
        await socket.leave(guestRoom);

        const client = connectedClients.get(socket.id);
        if (client) {
            client.rooms = client.rooms.filter(room =>
                room !== adminRoom && room !== guestRoom
            );
        }

        logger.info(`👋 ${socket.id} left event rooms for ${eventId}`);
    } catch (error) {
        logger.error(`❌ Error leaving rooms for ${eventId}:`, error);
    }
};

// services/websocket.service.ts - Enhanced with connection state management
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import { websocketAuthMiddleware, websocketRateLimit, websocketLogger } from '@middlewares/websocket-auth.middleware';

interface WebSocketUser {
    id: string;
    name: string;
    type: 'admin' | 'co_host' | 'guest';
    eventId: string;
    shareToken?: string;
}

interface AuthData {
    token?: string;
    shareToken?: string;
    eventId: string;
    userType?: 'admin' | 'guest';
    guestName?: string;
}

interface StatusUpdatePayload {
    mediaId: string;
    eventId: string;
    previousStatus: 'pending' | 'approved' | 'rejected' | 'hidden' | 'deleted' | 'auto_approved';
    newStatus: 'pending' | 'approved' | 'rejected' | 'hidden' | 'deleted' | 'auto_approved';
    updatedBy: {
        name: string;
        type: string;
    };
    timestamp: Date;
    mediaData?: {
        url?: string;
        thumbnail?: string;
        filename?: string;
    };
}

interface ConnectionStats {
    totalConnections: number;
    byType: {
        admin: number;
        co_host: number;
        guest: number;
    };
    byEvent: Record<string, number>;
}

interface ClientConnectionState {
    user: WebSocketUser;
    rooms: string[];
    connectedAt: Date;
    lastHeartbeat: Date;
    isHealthy: boolean;
    reconnectCount: number;
}

interface ConnectionHealth {
    socketId: string;
    isConnected: boolean;
    isHealthy: boolean;
    lastHeartbeat: Date;
    latency: number;
    reconnectCount: number;
}

class SimpleWebSocketService {
    public io: Server;
    private connectedClients: Map<string, ClientConnectionState> = new Map();
    private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
    private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
    private readonly HEARTBEAT_TIMEOUT = 60000;  // 60 seconds timeout

    constructor(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://localhost:3001"],
                methods: ["GET", "POST"],
                credentials: true
            },
            transports: ['websocket', 'polling'],
            pingTimeout: this.HEARTBEAT_TIMEOUT,
            pingInterval: this.HEARTBEAT_INTERVAL,
            // Enhanced connection settings
            connectTimeout: 45000,
            allowEIO3: true,
            // Reconnection settings
            maxHttpBufferSize: 1e6,
            httpCompression: true,
            perMessageDeflate: {
                threshold: 1024,
                zlibDeflateOptions: {
                    chunkSize: 1024,
                    windowBits: 13,
                    concurrencyLimit: 10,
                },
            }
        });

        this.setupMiddleware();
        this.initializeEventHandlers();
        this.startHealthCheck();
        logger.info('🔌 Enhanced WebSocket service initialized with connection management');
    }

    private setupMiddleware(): void {
        this.io.use(websocketLogger());
        this.io.use(websocketRateLimit());
        this.io.use(websocketAuthMiddleware());
        logger.info('🔧 WebSocket middleware applied');
    }

    private initializeEventHandlers(): void {
        this.io.on('connection', (socket: Socket) => {
            logger.info(`🔗 New connection: ${socket.id}`);

            // Initialize connection state
            this.initializeConnection(socket);

            const authTimeout = setTimeout(() => {
                if (!socket.data?.authenticated) {
                    logger.warn(`⏰ Auth timeout: ${socket.id}`);
                    socket.emit('auth_error', { message: 'Authentication timeout' });
                    this.cleanupConnection(socket.id);
                    socket.disconnect();
                }
            }, 30000);

            socket.on('authenticate', async (authData: AuthData) => {
                clearTimeout(authTimeout);
                await this.handleAuthentication(socket, authData);
            });

            socket.on('join_event', async (eventId: string) => {
                if (socket.data?.authenticated && socket.data?.user?.eventId === eventId) {
                    const adminRoom = `admin_${eventId}`;
                    const guestRoom = `guest_${eventId}`;
                    const user = socket.data.user;
                    const targetRoom = (user.type === 'admin' || user.type === 'co_host') ? adminRoom : guestRoom;

                    try {
                        const client = this.connectedClients.get(socket.id);
                        const alreadyInRoom = client?.rooms.includes(targetRoom);

                        if (!alreadyInRoom && client) {
                            await socket.join(targetRoom);
                            client.rooms.push(targetRoom);
                            logger.info(`👥 ${socket.id} (${user.type}) joined room: ${targetRoom}`);
                        }

                        setTimeout(() => this.brodCastRoomCounts(eventId), 100);

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
            });

            socket.on('leave_event', async (eventId: string) => {
                const adminRoom = `admin_${eventId}`;
                const guestRoom = `guest_${eventId}`;

                try {
                    await socket.leave(adminRoom);
                    await socket.leave(guestRoom);

                    const client = this.connectedClients.get(socket.id);
                    if (client) {
                        client.rooms = client.rooms.filter(room =>
                            room !== adminRoom && room !== guestRoom
                        );
                    }

                    setTimeout(() => this.brodCastRoomCounts(eventId), 100);
                    logger.info(`👋 ${socket.id} left event rooms for ${eventId}`);
                } catch (error) {
                    logger.error(`❌ Error leaving rooms for ${eventId}:`, error);
                }
            });

            // Enhanced heartbeat handling
            socket.on('heartbeat', (data: { timestamp: number }) => {
                this.handleHeartbeat(socket.id, data.timestamp);
                socket.emit('heartbeat_ack', {
                    timestamp: Date.now(),
                    latency: Date.now() - data.timestamp
                });
            });

            // Legacy ping support
            socket.on('ping', () => {
                socket.emit('pong', { timestamp: Date.now() });
                this.updateHeartbeat(socket.id);
            });

            // Connection quality check
            socket.on('connection_check', () => {
                const client = this.connectedClients.get(socket.id);
                socket.emit('connection_status', {
                    isHealthy: client?.isHealthy ?? false,
                    lastHeartbeat: client?.lastHeartbeat ?? new Date(),
                    connectedAt: client?.connectedAt ?? new Date(),
                    reconnectCount: client?.reconnectCount ?? 0
                });
            });

            socket.on('disconnect', (reason) => {
                clearTimeout(authTimeout);
                this.handleDisconnection(socket, reason);
            });

            socket.on('error', (error) => {
                logger.error(`❌ Socket error ${socket.id}:`, error);
                this.markUnhealthy(socket.id);
            });
        });
    }

    private initializeConnection(socket: Socket): void {
        // Will be properly set after authentication
        // For now, create a placeholder entry
        socket.data = {
            connectionInitializedAt: new Date()
        };
    }

    private handleHeartbeat(socketId: string, clientTimestamp: number): void {
        const client = this.connectedClients.get(socketId);
        if (client) {
            client.lastHeartbeat = new Date();
            client.isHealthy = true;
        }
    }

    private updateHeartbeat(socketId: string): void {
        const client = this.connectedClients.get(socketId);
        if (client) {
            client.lastHeartbeat = new Date();
            client.isHealthy = true;
        }
    }

    private markUnhealthy(socketId: string): void {
        const client = this.connectedClients.get(socketId);
        if (client) {
            client.isHealthy = false;
        }
    }

    private handleDisconnection(socket: Socket, reason: string): void {
        const client = this.connectedClients.get(socket.id);

        if (client) {
            const userEventId = client.user.eventId;
            logger.info(`🔌 Disconnected: ${socket.id} (${client.user.type} - ${client.user.name}) - ${reason}`);

            // Increment reconnect count for tracking
            if (reason !== 'client namespace disconnect' && reason !== 'server namespace disconnect') {
                client.reconnectCount++;
            }

            this.cleanupConnection(socket.id);

            if (userEventId) {
                setTimeout(() => this.brodCastRoomCounts(userEventId), 100);
            }
        } else {
            logger.info(`🔌 Disconnected: ${socket.id} (unknown client)`);
        }
    }

    private cleanupConnection(socketId: string): void {
        // Clear heartbeat interval
        const heartbeatInterval = this.heartbeatIntervals.get(socketId);
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            this.heartbeatIntervals.delete(socketId);
        }

        // Remove client
        this.connectedClients.delete(socketId);
    }

    private startHealthCheck(): void {
        // Run health check every 2 minutes
        setInterval(() => {
            this.performHealthCheck();
        }, 120000);

        logger.info('🏥 Health check service started');
    }

    private performHealthCheck(): void {
        const now = new Date();
        const unhealthyClients: string[] = [];

        this.connectedClients.forEach((client, socketId) => {
            const timeSinceLastHeartbeat = now.getTime() - client.lastHeartbeat.getTime();

            // Mark as unhealthy if no heartbeat for more than timeout period
            if (timeSinceLastHeartbeat > this.HEARTBEAT_TIMEOUT) {
                client.isHealthy = false;
                unhealthyClients.push(socketId);
            }
        });

        if (unhealthyClients.length > 0) {
            logger.warn(`🏥 Found ${unhealthyClients.length} unhealthy connections`);

            // Optionally disconnect unhealthy clients
            unhealthyClients.forEach(socketId => {
                const socket = this.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('connection_unhealthy', {
                        message: 'Connection marked as unhealthy due to missed heartbeats'
                    });
                }
            });
        }
    }

    private async handleAuthentication(socket: Socket, authData: AuthData): Promise<void> {
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
            this.connectedClients.set(socket.id, {
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
                    heartbeatInterval: this.HEARTBEAT_INTERVAL,
                    heartbeatTimeout: this.HEARTBEAT_TIMEOUT
                }
            });

            logger.info(`✅ Authenticated: ${socket.id} as ${user.type} - ${user.name}`);

        } catch (error: any) {
            logger.error(`❌ Auth failed ${socket.id}:`, error.message);
            socket.emit('auth_error', { message: 'Authentication failed' });
        }
    }

    public emitStatusUpdate(payload: StatusUpdatePayload): void {
        const adminRoom = `admin_${payload.eventId}`;
        const guestRoom = `guest_${payload.eventId}`;

        logger.info(`📤 Emitting status update: ${payload.mediaId.substring(0, 8)}... (${payload.previousStatus} → ${payload.newStatus})`);

        this.io.to(adminRoom).emit('media_status_updated', payload);

        if (payload.newStatus === 'approved' || payload.newStatus === 'auto_approved') {
            this.io.to(guestRoom).emit('media_approved', {
                mediaId: payload.mediaId,
                eventId: payload.eventId,
                mediaData: payload.mediaData,
                timestamp: payload.timestamp
            });
        } else if (['approved', 'auto_approved'].includes(payload.previousStatus) &&
            !['approved', 'auto_approved'].includes(payload.newStatus)) {
            this.io.to(guestRoom).emit('media_removed', {
                mediaId: payload.mediaId,
                eventId: payload.eventId,
                reason: `Status changed to ${payload.newStatus}`,
                timestamp: payload.timestamp
            });
        }

        this.io.to(guestRoom).emit('media_status_updated', payload);
    }

    public getRoomUserCounts(): Record<string, number> {
        const counts: Record<string, number> = {};

        this.connectedClients.forEach((client) => {
            client.rooms.forEach(room => {
                if (room.startsWith('admin_') || room.startsWith('guest_')) {
                    counts[room] = (counts[room] || 0) + 1;
                }
            });
        });

        return counts;
    }

    public brodCastRoomCounts(eventId: string): void {
        const adminRoom = `admin_${eventId}`;
        const guestRoom = `guest_${eventId}`;
        const roomCounts = this.getRoomUserCounts();

        const adminCount = roomCounts[adminRoom] || 0;
        const guestCount = roomCounts[guestRoom] || 0;
        const total = adminCount + guestCount;

        // Send to admin room (they see both counts)
        this.io.to(adminRoom).emit('room_user_counts', {
            eventId,
            adminCount,
            guestCount,
            total
        });

        // Send to guest room (they see guest count)
        this.io.to(guestRoom).emit('room_user_counts', {
            eventId,
            guestCount,
            total: guestCount
        });

        logger.info(`📊 Room counts for ${eventId}: Admin(${adminCount}) Guest(${guestCount}) Total(${total})`);
    }

    public getConnectionStats(): ConnectionStats {
        const stats: ConnectionStats = {
            totalConnections: this.connectedClients.size,
            byType: { admin: 0, co_host: 0, guest: 0 },
            byEvent: {}
        };

        this.connectedClients.forEach((client) => {
            stats.byType[client.user.type as keyof typeof stats.byType]++;
            const eventId = client.user.eventId;
            stats.byEvent[eventId] = (stats.byEvent[eventId] || 0) + 1;
        });

        return stats;
    }

    public getConnectionHealth(): ConnectionHealth[] {
        const healthStats: ConnectionHealth[] = [];

        this.connectedClients.forEach((client, socketId) => {
            const socket = this.io.sockets.sockets.get(socketId);
            const now = new Date();
            const latency = socket ? now.getTime() - client.lastHeartbeat.getTime() : -1;

            healthStats.push({
                socketId,
                isConnected: !!socket?.connected,
                isHealthy: client.isHealthy,
                lastHeartbeat: client.lastHeartbeat,
                latency,
                reconnectCount: client.reconnectCount
            });
        });

        return healthStats;
    }

    public getEventConnections(eventId: string): Array<{ socketId: string; user: WebSocketUser; health: any }> {
        const connections: Array<{ socketId: string; user: WebSocketUser; health: any }> = [];

        this.connectedClients.forEach((client, socketId) => {
            if (client.user.eventId === eventId) {
                connections.push({
                    socketId,
                    user: client.user,
                    health: {
                        isHealthy: client.isHealthy,
                        lastHeartbeat: client.lastHeartbeat,
                        connectedAt: client.connectedAt,
                        reconnectCount: client.reconnectCount
                    }
                });
            }
        });

        return connections;
    }

    public async cleanup(): Promise<void> {
        logger.info('🧹 Cleaning up WebSocket service...');

        // Clear all heartbeat intervals
        this.heartbeatIntervals.forEach(interval => clearInterval(interval));
        this.heartbeatIntervals.clear();

        this.io.emit('server_shutdown', {
            message: 'Server is shutting down for maintenance',
            timestamp: new Date()
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        this.io.disconnectSockets();
        this.connectedClients.clear();
        logger.info('✅ WebSocket service cleaned up');
    }
}

let webSocketService: SimpleWebSocketService | null = null;

export const initializeWebSocketService = (httpServer: HttpServer): SimpleWebSocketService => {
    if (!webSocketService) {
        webSocketService = new SimpleWebSocketService(httpServer);
    }
    return webSocketService;
};

export const getWebSocketService = (): SimpleWebSocketService => {
    if (!webSocketService) {
        throw new Error('WebSocket service not initialized');
    }
    return webSocketService;
};

export default SimpleWebSocketService;
// services/websocket/websocket.service.ts - MAIN SERVICE
// ====================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { websocketAuthMiddleware, websocketRateLimit, websocketLogger } from '@middlewares/websocket-auth.middleware';

// Import our management services
import { authenticateConnection, handleRoomJoin, handleRoomLeave } from './management/websocket-auth.service';
import { WebSocketHealthService } from './management/websocket-health.service';

import type { 
    ClientConnectionState, 
    AuthData, 
    StatusUpdatePayload,
    ConnectionStats,
    ConnectionHealth
} from './websocket.types';

class SimpleWebSocketService {
    public io: Server;
    private connectedClients: Map<string, ClientConnectionState> = new Map();
    private healthService: WebSocketHealthService;

    constructor(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://localhost:3001"],
                methods: ["GET", "POST"],
                credentials: true
            },
            transports: ['websocket', 'polling'],
            pingTimeout: 60000,
            pingInterval: 30000,
            connectTimeout: 45000,
            allowEIO3: true,
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

        this.healthService = new WebSocketHealthService(this.connectedClients, this.io);
        this.setupMiddleware();
        this.initializeEventHandlers();
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
            socket.data = { connectionInitializedAt: new Date() };

            const authTimeout = setTimeout(() => {
                if (!socket.data?.authenticated) {
                    logger.warn(`⏰ Auth timeout: ${socket.id}`);
                    socket.emit('auth_error', { message: 'Authentication timeout' });
                    this.healthService.cleanupConnection(socket.id);
                    socket.disconnect();
                }
            }, 30000);

            socket.on('authenticate', async (authData: AuthData) => {
                clearTimeout(authTimeout);
                await authenticateConnection(socket, authData, this.connectedClients);
            });

            socket.on('join_event', async (eventId: string) => {
                await handleRoomJoin(socket, eventId, this.connectedClients);
                setTimeout(() => this.brodCastRoomCounts(eventId), 100);
            });

            socket.on('leave_event', async (eventId: string) => {
                await handleRoomLeave(socket, eventId, this.connectedClients);
                setTimeout(() => this.brodCastRoomCounts(eventId), 100);
            });

            // Enhanced heartbeat handling
            socket.on('heartbeat', (data: { timestamp: number }) => {
                this.healthService.handleHeartbeat(socket.id, data.timestamp);
                socket.emit('heartbeat_ack', {
                    timestamp: Date.now(),
                    latency: Date.now() - data.timestamp
                });
            });

            // Legacy ping support
            socket.on('ping', () => {
                socket.emit('pong', { timestamp: Date.now() });
                this.healthService.handleHeartbeat(socket.id);
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

            socket.on('disconnect', (reason: string) => {
                clearTimeout(authTimeout);
                this.healthService.handleDisconnection(socket, reason);
                // If you need to broadcast room counts, you may need to retrieve the eventId another way
            });

            socket.on('error', (error: Error) => {
                logger.error(`❌ Socket error ${socket.id}:`, error);
                this.healthService.markUnhealthy(socket.id);
            });
        });
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
        return this.healthService.getConnectionStats();
    }

    public getConnectionHealth(): ConnectionHealth[] {
        return this.healthService.getConnectionHealth();
    }

    public getEventConnections(eventId: string): Array<{ socketId: string; user: any; health: any }> {
        return this.healthService.getEventConnections(eventId);
    }

    public async cleanup(): Promise<void> {
        logger.info('🧹 Cleaning up WebSocket service...');

        this.io.emit('server_shutdown', {
            message: 'Server is shutting down for maintenance',
            timestamp: new Date()
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        await this.healthService.cleanup();
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
// services/websocket.service.ts - Fixed version with proper middleware
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

class SimpleWebSocketService {
    public io: Server;
    private connectedClients: Map<string, { user: WebSocketUser; rooms: string[] }> = new Map();

    constructor(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://localhost:3001"],
                methods: ["GET", "POST"],
                credentials: true
            },
            transports: ['websocket', 'polling'],
            pingTimeout: 60000,
            pingInterval: 25000
        });

        // Apply middleware here during initialization
        this.setupMiddleware();
        this.initializeEventHandlers();
        logger.info('🔌 Simple WebSocket service initialized with middleware');
    }

    private setupMiddleware(): void {
        // Apply middleware in the correct order
        this.io.use(websocketLogger());
        this.io.use(websocketRateLimit());
        this.io.use(websocketAuthMiddleware());
        logger.info('🔧 WebSocket middleware applied');
    }

    private initializeEventHandlers(): void {
        this.io.on('connection', (socket: Socket) => {
            logger.info(`🔗 New connection: ${socket.id} from ${socket.handshake.address}`);

            // Set authentication timeout
            const authTimeout = setTimeout(() => {
                if (!socket.data?.authenticated) {
                    logger.warn(`⏰ Auth timeout: ${socket.id}`);
                    socket.emit('auth_error', { message: 'Authentication timeout' });
                    socket.disconnect();
                }
            }, 30000);

            // Handle authentication
            socket.on('authenticate', async (authData: AuthData) => {
                clearTimeout(authTimeout);
                await this.handleAuthentication(socket, authData);
            });

            // Handle joining event room
            socket.on('join_event', async (eventId: string) => {
                if (socket.data?.authenticated && socket.data?.user?.eventId === eventId) {
                    const adminRoom = `admin_${eventId}`;  // For admin/co-host
                    const guestRoom = `guest_${eventId}`;  // For guests
                    
                    const user = socket.data.user;
                    const targetRoom = (user.type === 'admin' || user.type === 'co_host') ? adminRoom : guestRoom;
                    
                    await socket.join(targetRoom);

                    const client = this.connectedClients.get(socket.id);
                    if (client && !client.rooms.includes(targetRoom)) {
                        client.rooms.push(targetRoom);
                    }

                    logger.info(`👥 ${socket.id} (${user.type}) joined room: ${targetRoom}`);
                    
                    socket.emit('joined_event', { 
                        eventId, 
                        room: targetRoom,
                        userType: user.type 
                    });
                }
            });

            // Handle leaving event room
            socket.on('leave_event', async (eventId: string) => {
                const adminRoom = `admin_${eventId}`;
                const guestRoom = `guest_${eventId}`;
                
                await socket.leave(adminRoom);
                await socket.leave(guestRoom);
                
                const client = this.connectedClients.get(socket.id);
                if (client) {
                    client.rooms = client.rooms.filter(room => 
                        room !== adminRoom && room !== guestRoom
                    );
                }
                
                logger.info(`👋 ${socket.id} left event rooms for ${eventId}`);
            });

            // Handle disconnection
            socket.on('disconnect', (reason) => {
                clearTimeout(authTimeout);
                const client = this.connectedClients.get(socket.id);
                if (client) {
                    logger.info(`🔌 Disconnected: ${socket.id} (${client.user.type} - ${client.user.name}) - Reason: ${reason}`);
                }
                this.connectedClients.delete(socket.id);
            });

            socket.on('error', (error) => {
                logger.error(`❌ Socket error ${socket.id}:`, error);
            });

            // Heartbeat for connection monitoring
            socket.on('ping', () => {
                socket.emit('pong', { timestamp: Date.now() });
            });
        });
    }

    private async handleAuthentication(socket: Socket, authData: AuthData): Promise<void> {
        try {
            logger.info(`🔐 Authenticating: ${socket.id}`, {
                hasToken: !!authData.token,
                hasShareToken: !!authData.shareToken,
                userType: authData.userType,
                eventId: authData.eventId?.substring(0, 10) + '...'
            });

            // Find event
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

            // Admin/Co-host authentication
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
                    // Check co-host (you can add more validation here)
                    user = {
                        id: decoded.userId,
                        name: decoded.name || 'Co-host',
                        type: 'co_host',
                        eventId: actualEventId
                    };
                }
            }
            // Guest authentication
            else if (authData.shareToken || authData.userType === 'guest') {
                const shareToken = authData.shareToken || authData.eventId;

                // Basic share token validation
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

            // Set socket data
            socket.data = {
                authenticated: true,
                user: user
            };

            // Store client
            this.connectedClients.set(socket.id, {
                user: user,
                rooms: []
            });

            // Send success response
            socket.emit('auth_success', {
                success: true,
                user: {
                    id: user.id,
                    name: user.name,
                    type: user.type
                },
                eventId: actualEventId
            });

            logger.info(`✅ Authenticated: ${socket.id} as ${user.type} - ${user.name}`);

        } catch (error: any) {
            logger.error(`❌ Auth failed ${socket.id}:`, error.message);
            socket.emit('auth_error', { message: 'Authentication failed' });
        }
    }

    // PUBLIC METHOD: Emit status update to appropriate rooms
    public emitStatusUpdate(payload: StatusUpdatePayload): void {
        const adminRoom = `admin_${payload.eventId}`;
        const guestRoom = `guest_${payload.eventId}`;

        logger.info(`📤 Emitting status update to both rooms:`, {
            mediaId: payload.mediaId.substring(0, 8) + '...',
            from: payload.previousStatus,
            to: payload.newStatus,
            by: payload.updatedBy.name,
            event: payload.eventId.substring(0, 8) + '...',
            adminRoom,
            guestRoom
        });

        // Always emit to admin/co-host room (they see all status changes)
        this.io.to(adminRoom).emit('media_status_updated', payload);
        
        // Handle guest room logic based on status changes
        if (payload.newStatus === 'approved' || payload.newStatus === 'auto_approved') {
            // If media becomes approved, show it to guests
            this.io.to(guestRoom).emit('media_approved', {
                mediaId: payload.mediaId,
                eventId: payload.eventId,
                mediaData: payload.mediaData,
                timestamp: payload.timestamp
            });
        } else if (['approved', 'auto_approved'].includes(payload.previousStatus) && 
                   !['approved', 'auto_approved'].includes(payload.newStatus)) {
            // If media was approved but now changed to something else, remove from guests
            this.io.to(guestRoom).emit('media_removed', {
                mediaId: payload.mediaId,
                eventId: payload.eventId,
                reason: `Status changed to ${payload.newStatus}`,
                timestamp: payload.timestamp
            });
        }
        
        // ALSO emit the full status update to guests for consistency
        this.io.to(guestRoom).emit('media_status_updated', payload);
    }

    // Get connection stats
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

    // Get clients in specific event
    public getEventConnections(eventId: string): Array<{ socketId: string; user: WebSocketUser }> {
        const connections: Array<{ socketId: string; user: WebSocketUser }> = [];
        
        this.connectedClients.forEach((client, socketId) => {
            if (client.user.eventId === eventId) {
                connections.push({ socketId, user: client.user });
            }
        });
        
        return connections;
    }

    // Cleanup
    public async cleanup(): Promise<void> {
        logger.info('🧹 Cleaning up WebSocket service...');
        
        // Notify all clients about shutdown
        this.io.emit('server_shutdown', {
            message: 'Server is shutting down for maintenance',
            timestamp: new Date()
        });
        
        // Give clients time to receive the message
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        this.io.disconnectSockets();
        this.connectedClients.clear();
        logger.info('✅ WebSocket service cleaned up');
    }
}

// Singleton
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
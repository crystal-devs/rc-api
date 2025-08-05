// services/websocket.service.ts - Simplified without Redis
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import {
    WebSocketUser,
    SocketAuthData,
    AuthenticatedSocket,
    WEBSOCKET_EVENTS,
    MediaStatusUpdatePayload,
    NewMediaUploadPayload,
    MediaProcessingPayload,
    ConnectedClient,
    EventConnectionStats,
    WebSocketConfig
} from 'types/websocket.types';

interface GlobalConnectionStats {
    totalConnections: number;
    servers: number;
    serverStats: { [serverId: string]: number };
    timestamp: Date;
}

class WebSocketService {
    public io: Server; // Made public to access from server.ts
    private connectedClients: Map<string, ConnectedClient> = new Map();
    private eventStats: Map<string, EventConnectionStats> = new Map();
    private serverId: string;

    constructor(httpServer: HttpServer) {
        this.serverId = process.env.SERVER_ID || `server-${Date.now()}`;

        this.io = new Server(httpServer, {
            cors: {
                origin: process.env.FRONTEND_URL || "http://localhost:3000",
                methods: ["GET", "POST"],
                credentials: true
            },
            connectionStateRecovery: {
                // Enable connection state recovery
                maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
                skipMiddlewares: true,
            }
        });

        this.initializeEventHandlers();
        logger.info('🔌 WebSocket service initialized (Local mode - no Redis)');
    }

    /**
     * Initialize all WebSocket event handlers
     */
    private initializeEventHandlers(): void {
        this.io.on(WEBSOCKET_EVENTS.CONNECTION, (socket: Socket) => {
            logger.info(`🔗 New WebSocket connection: ${socket.id}`);

            // Set connection timeout
            const connectionTimeout = setTimeout(() => {
                if (!socket.data.authenticated) {
                    logger.warn(`⏰ Connection timeout for socket: ${socket.id}`);
                    socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                        code: 'CONNECTION_TIMEOUT',
                        message: 'Authentication timeout. Please reconnect.',
                    });
                    socket.disconnect();
                }
            }, 30000); // 30 seconds to authenticate

            // Handle authentication
            socket.on(WEBSOCKET_EVENTS.AUTHENTICATE, async (authData: SocketAuthData) => {
                clearTimeout(connectionTimeout);
                await this.handleAuthentication(socket, authData);
            });

            // Handle joining event
            socket.on(WEBSOCKET_EVENTS.JOIN_EVENT, async (eventId: string) => {
                await this.handleJoinEvent(socket as AuthenticatedSocket, eventId);
            });

            // Handle leaving event  
            socket.on(WEBSOCKET_EVENTS.LEAVE_EVENT, async (eventId: string) => {
                await this.handleLeaveEvent(socket as AuthenticatedSocket, eventId);
            });

            // Handle disconnection
            socket.on(WEBSOCKET_EVENTS.DISCONNECT, async () => {
                clearTimeout(connectionTimeout);
                await this.handleDisconnection(socket as AuthenticatedSocket);
            });

            // Handle errors
            socket.on('error', (error) => {
                logger.error(`❌ WebSocket error for ${socket.id}:`, error);
            });
        });

        // Log connection stats periodically
        setInterval(() => {
            this.logConnectionStats();
        }, 60000); // Every minute
    }

    /**
     * Log current connection statistics
     */
    private logConnectionStats(): void {
        const totalConnections = this.connectedClients.size;
        const eventStats = Array.from(this.eventStats.values());

        logger.info('📊 WebSocket Connection Stats:', {
            serverId: this.serverId,
            totalConnections,
            activeEvents: eventStats.length,
            eventBreakdown: eventStats.map(stat => ({
                eventId: stat.eventId,
                connections: stat.totalConnections,
                admins: stat.adminConnections,
                guests: stat.guestConnections
            }))
        });
    }

    /**
     * Handle user authentication for WebSocket connection
     */
    private async handleAuthentication(socket: Socket, authData: SocketAuthData): Promise<void> {
        try {
            logger.info(`🔐 Authenticating socket ${socket.id} with data:`, {
                hasToken: !!authData.token,
                hasShareToken: !!authData.shareToken,
                eventId: authData.eventId,
                userType: authData.userType // Add this field
            });

            // Validate eventId
            if (!authData.eventId) {
                socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                    code: 'INVALID_EVENT',
                    message: 'Event ID is required'
                });
                return;
            }

            // Find the event - support both ObjectId and share token
            let event;

            // If it looks like a share token (starts with 'evt_'), find by share_token
            if (authData.eventId.startsWith('evt_')) {
                event = await Event.findOne({ share_token: authData.eventId })
                    .populate('created_by', 'name email')
                    .populate('co_hosts.user_id', 'name email');
            } else {
                // Otherwise find by _id
                event = await Event.findById(authData.eventId)
                    .populate('created_by', 'name email')
                    .populate('co_hosts.user_id', 'name email');
            }

            if (!event) {
                socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                    code: 'INVALID_EVENT',
                    message: 'Event not found'
                });
                return;
            }

            let user: WebSocketUser;

            // JWT Authentication (for logged-in users/admins)
            if (authData.token && !authData.shareToken) {
                user = await this.authenticateWithJWT(authData.token, event, event._id.toString());
            }
            // Share Token Authentication (for guests)
            else if (authData.shareToken || authData.userType === 'guest') {
                const shareToken = authData.shareToken || authData.eventId;
                user = await this.authenticateWithShareToken(shareToken, event, event._id.toString(), authData.guestInfo);
            }
            else {
                socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                    code: 'AUTH_FAILED',
                    message: 'Authentication token is required'
                });
                return;
            }

            // Set socket data
            (socket as AuthenticatedSocket).user = user;
            (socket as AuthenticatedSocket).eventId = event._id.toString(); // Use actual event ID
            (socket as AuthenticatedSocket).authenticated = true;

            // Add to connected clients
            this.connectedClients.set(socket.id, {
                socketId: socket.id,
                user,
                connectedAt: new Date(),
                lastActivity: new Date(),
                rooms: []
            });

            // Update event stats using actual event ID
            this.updateEventStats(event._id.toString());

            // Emit success
            socket.emit(WEBSOCKET_EVENTS.AUTH_SUCCESS, {
                success: true,
                message: 'Authentication successful',
                data: {
                    user: {
                        id: user.id,
                        name: user.name || user.guestName,
                        type: user.type
                    },
                    eventId: event._id.toString() // Return actual event ID
                },
                timestamp: new Date()
            });

            logger.info(`✅ Socket ${socket.id} authenticated as ${user.type} for event ${event._id}`);

        } catch (error: any) {
            logger.error(`❌ Authentication failed for socket ${socket.id}:`, error);
            socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                code: 'AUTH_FAILED',
                message: error.message || 'Authentication failed'
            });
        }
    }

    /**
     * Authenticate user with JWT token
     */
    private async authenticateWithJWT(token: string, event: any, eventId: string): Promise<WebSocketUser> {
        try {
            // Verify JWT token
            const decoded = jwt.verify(token, keys.jwtSecret as string) as any;

            if (!decoded.userId) {
                throw new Error('Invalid token payload');
            }

            // Check if user is event creator (admin)
            if (event.created_by._id.toString() === decoded.userId) {
                return {
                    id: decoded.userId,
                    type: 'admin',
                    eventId,
                    userId: decoded.userId,
                    name: event.created_by.name,
                    email: event.created_by.email
                };
            }

            // Check if user is co-host
            const coHost = event.co_hosts.find((ch: any) =>
                ch.user_id._id.toString() === decoded.userId && ch.status === 'approved'
            );

            if (coHost) {
                return {
                    id: decoded.userId,
                    type: 'co_host',
                    eventId,
                    userId: decoded.userId,
                    name: coHost.user_id.name,
                    email: coHost.user_id.email
                };
            }

            // For private events, only admin/co-hosts can access
            if (event.visibility === 'private') {
                throw new Error('Access denied. This is a private event.');
            }

            // Regular logged user for non-private events
            return {
                id: decoded.userId,
                type: 'logged_user',
                eventId,
                userId: decoded.userId,
                name: decoded.name || 'User',
                email: decoded.email
            };

        } catch (error: any) {
            throw new Error(`JWT authentication failed: ${error.message}`);
        }
    }

    /**
     * Authenticate user with share token
     */
    private async authenticateWithShareToken(
        shareToken: string,
        event: any,
        eventId: string,
        guestInfo?: any
    ): Promise<WebSocketUser> {
        try {
            logger.info(`🔐 Authenticating with share token for event: ${eventId}`, {
                shareToken: shareToken.substring(0, 8) + '...',
                eventVisibility: event.visibility,
                shareSettingsActive: event.share_settings?.is_active,
                eventShareToken: event.share_token ? event.share_token.substring(0, 8) + '...' : 'none'
            });

            // Check if event allows share token access
            if (event.visibility === 'private') {
                logger.warn(`❌ Private event access denied for share token: ${shareToken.substring(0, 8)}...`);
                throw new Error('This event requires authentication');
            }

            // Verify share token - handle multiple scenarios
            let isValidShareToken = false;
            let validationReason = '';

            // Scenario 1: Direct share token match
            if (event.share_token && event.share_token === shareToken) {
                isValidShareToken = true;
                validationReason = 'direct_match';
            }
            // Scenario 2: Share token starts with 'evt_' and matches event share token
            else if (shareToken.startsWith('evt_') && event.share_token && shareToken === event.share_token) {
                isValidShareToken = true;
                validationReason = 'evt_prefix_match';
            }
            // Scenario 3: ShareToken is actually the eventId (fallback for compatibility)
            else if (shareToken === eventId) {
                logger.warn('⚠️ Using eventId as shareToken - consider fixing this on frontend');
                isValidShareToken = true;
                validationReason = 'eventid_fallback';
            }
            // Scenario 4: ShareToken matches event ObjectId string
            else if (shareToken === event._id.toString()) {
                logger.warn('⚠️ Using event ObjectId as shareToken - compatibility mode');
                isValidShareToken = true;
                validationReason = 'objectid_fallback';
            }

            if (!isValidShareToken) {
                logger.error(`❌ Invalid share token validation failed:`, {
                    providedToken: shareToken.substring(0, 8) + '...',
                    eventShareToken: event.share_token ? event.share_token.substring(0, 8) + '...' : 'none',
                    eventId: eventId,
                    eventObjectId: event._id.toString()
                });
                throw new Error('Invalid share token');
            }

            logger.info(`✅ Share token validated via: ${validationReason}`);

            // Check if share settings exist and are properly configured
            if (!event.share_settings) {
                logger.warn('⚠️ Event has no share_settings, creating default settings');
                // Create default share settings if they don't exist
                event.share_settings = {
                    is_active: true,
                    expires_at: null
                };
            }

            // Check if share settings allow access
            if (!event.share_settings.is_active) {
                logger.warn(`❌ Event sharing disabled for event: ${eventId}`);
                throw new Error('Event sharing is currently disabled');
            }

            // Check expiry
            if (event.share_settings.expires_at && new Date() > new Date(event.share_settings.expires_at)) {
                logger.warn(`❌ Share link expired for event: ${eventId}`, {
                    expiresAt: event.share_settings.expires_at,
                    currentTime: new Date()
                });
                throw new Error('Share link has expired');
            }

            // Check if event has ended (optional business logic)
            if (event.end_date && new Date() > new Date(event.end_date)) {
                logger.warn(`⚠️ Event has ended, but allowing guest access: ${eventId}`);
                // Don't throw error, just warn - guests might still want to view photos
            }

            // Generate unique guest ID
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).slice(2, 8);
            const guestId = `guest_${timestamp}_${randomSuffix}`;

            // Create guest user object
            const user: WebSocketUser = {
                id: guestId,
                type: 'guest',
                eventId: eventId, // Use the actual event ID
                shareToken: shareToken, // Keep the original share token
                guestId: guestId,
                guestName: guestInfo?.name || guestInfo?.guestName || 'Anonymous Guest',
                // Additional guest metadata
                // metadata: {
                //     connectedAt: new Date(),
                //     userAgent: guestInfo?.userAgent || 'Unknown',
                //     validationMethod: validationReason,
                //     shareTokenUsed: shareToken.substring(0, 8) + '...'
                // }
            };

            logger.info(`✅ Guest user created successfully:`, {
                guestId: user.guestId,
                guestName: user.guestName,
                eventId: user.eventId,
                validationMethod: validationReason,
                shareToken: shareToken.substring(0, 8) + '...'
            });

            // Optional: Track guest connection in database
            try {
                // You could add guest connection tracking here
                // await this.trackGuestConnection(user, event);
                logger.debug('📊 Guest connection tracked (if implemented)');
            } catch (trackingError) {
                logger.warn('⚠️ Failed to track guest connection (non-critical):', trackingError);
                // Don't fail authentication if tracking fails
            }

            return user;

        } catch (error: any) {
            logger.error(`❌ Share token authentication failed for event ${eventId}:`, {
                error: error.message,
                shareToken: shareToken.substring(0, 8) + '...',
                eventId: eventId,
                stack: error.stack
            });

            // Re-throw with a more specific error message
            throw new Error(`Share token authentication failed: ${error.message}`);
        }
    }


    /**
     * Handle user joining an event room
     */
    private async handleJoinEvent(socket: AuthenticatedSocket, eventId: string): Promise<void> {
        try {
            if (!socket.authenticated || socket.eventId !== eventId) {
                socket.emit(WEBSOCKET_EVENTS.ERROR, {
                    code: 'PERMISSION_DENIED',
                    message: 'Not authenticated for this event'
                });
                return;
            }

            const eventRoom = this.getEventRoom(eventId);

            // Join the event room
            await socket.join(eventRoom);

            // Update client data
            const client = this.connectedClients.get(socket.id);
            if (client) {
                client.rooms.push(eventRoom);
                client.lastActivity = new Date();
            }

            // Update event stats
            this.updateEventStats(eventId);

            // Notify others in the room
            socket.to(eventRoom).emit(WEBSOCKET_EVENTS.GUEST_JOINED, {
                user: {
                    id: socket.user.id,
                    name: socket.user.name || socket.user.guestName,
                    type: socket.user.type
                },
                timestamp: new Date()
            });

            logger.info(`👥 Socket ${socket.id} joined event room: ${eventRoom}`);

        } catch (error: any) {
            logger.error(`❌ Failed to join event ${eventId} for socket ${socket.id}:`, error);
            socket.emit(WEBSOCKET_EVENTS.ERROR, {
                code: 'SERVER_ERROR',
                message: 'Failed to join event'
            });
        }
    }

    /**
     * Handle user leaving an event room
     */
    private async handleLeaveEvent(socket: AuthenticatedSocket, eventId: string): Promise<void> {
        try {
            const eventRoom = this.getEventRoom(eventId);

            // Leave the room
            await socket.leave(eventRoom);

            // Update client data
            const client = this.connectedClients.get(socket.id);
            if (client) {
                client.rooms = client.rooms.filter(room => room !== eventRoom);
                client.lastActivity = new Date();
            }

            // Update event stats
            this.updateEventStats(eventId);

            // Notify others in the room
            socket.to(eventRoom).emit(WEBSOCKET_EVENTS.GUEST_LEFT, {
                user: {
                    id: socket.user.id,
                    name: socket.user.name || socket.user.guestName,
                    type: socket.user.type
                },
                timestamp: new Date()
            });

            logger.info(`👋 Socket ${socket.id} left event room: ${eventRoom}`);

        } catch (error: any) {
            logger.error(`❌ Failed to leave event ${eventId} for socket ${socket.id}:`, error);
        }
    }

    /**
     * Handle socket disconnection
     */
    private async handleDisconnection(socket: AuthenticatedSocket): Promise<void> {
        try {
            const client = this.connectedClients.get(socket.id);

            if (client) {
                // Update event stats for all rooms the client was in
                client.rooms.forEach(room => {
                    const eventId = room.replace('event_', '');
                    this.updateEventStats(eventId);
                });

                // Remove from connected clients
                this.connectedClients.delete(socket.id);

                logger.info(`🔌 Socket ${socket.id} disconnected (${client.user.type})`);
            }

        } catch (error: any) {
            logger.error(`❌ Error handling disconnection for socket ${socket.id}:`, error);
        }
    }

    /**
     * Get event room name
     */
    private getEventRoom(eventId: string): string {
        return `event_${eventId}`;
    }

    /**
     * Update event statistics
     */
    private updateEventStats(eventId: string): void {
        const eventRoom = this.getEventRoom(eventId);
        const roomClients = Array.from(this.connectedClients.values())
            .filter(client => client.rooms.includes(eventRoom));

        // Count different user types
        const adminConnections = roomClients.filter(c =>
            c.user.type === 'admin' || c.user.type === 'co_host'
        ).length;

        const guestConnections = roomClients.filter(c =>
            c.user.type === 'guest'
        ).length;

        const moderatorConnections = roomClients.filter(c =>
            c.user.type === 'moderator'
        ).length;

        const loggedUserConnections = roomClients.filter(c =>
            c.user.type === 'logged_user'
        ).length;

        const stats: EventConnectionStats = {
            eventId,
            totalConnections: roomClients.length,
            adminConnections,
            guestConnections,
            moderatorConnections, // Added missing property
            loggedUserConnections, // Added missing property
            activeRooms: [eventRoom],
            lastActivity: new Date()
        };

        this.eventStats.set(eventId, stats);
    }

    // ==========================================
    // PUBLIC METHODS FOR CONTROLLERS
    // ==========================================

    /**
     * Emit media status update to all users in event
     */
    public async emitMediaStatusUpdate(payload: MediaStatusUpdatePayload & {
        guestVisibility?: {
            wasVisible: boolean;
            isVisible: boolean;
            changed: boolean;
        };
    }): Promise<void> {
        try {
            const eventRoom = this.getEventRoom(payload.eventId);

            // Get the number of clients in the room for debugging
            const roomClients = await this.io.in(eventRoom).allSockets();
            const clientCount = roomClients.size;

            if (clientCount === 0) {
                logger.warn(`⚠️ No clients in event room ${eventRoom} for media status update`);
            } else {
                logger.info(`📤 Emitting media status update to ${clientCount} clients in room ${eventRoom}:`, {
                    mediaId: payload.mediaId,
                    previousStatus: payload.previousStatus,
                    newStatus: payload.newStatus,
                    guestVisibilityChanged: payload.guestVisibility?.changed
                });
            }

            // Emit to all users in the event room
            this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.MEDIA_STATUS_UPDATED, payload);

        } catch (error: any) {
            logger.error(`❌ Failed to emit media status update to room ${this.getEventRoom(payload.eventId)}:`, {
                error: error.message,
                stack: error.stack,
                mediaId: payload.mediaId,
                eventId: payload.eventId
            });
            throw error; // Re-throw to allow controller to handle
        }
    }

    /**
     * Emit new media upload notification
     */
    public emitNewMediaUpload(payload: NewMediaUploadPayload): void {
        const eventRoom = this.getEventRoom(payload.eventId);

        logger.info(`📤 Emitting new media upload to room ${eventRoom}:`, {
            mediaId: payload.mediaId,
            uploadedBy: payload.uploadedBy.name,
            status: payload.status
        });

        this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.NEW_MEDIA_UPLOADED, payload);
    }

    /**
     * Emit media processing update
     */
    public emitMediaProcessingUpdate(payload: MediaProcessingPayload): void {
        const eventRoom = this.getEventRoom(payload.eventId);
        this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_UPDATE, payload);
    }

    /**
     * Get connection statistics for a specific event or all events
     */
    public getConnectionStats(eventId?: string): EventConnectionStats | EventConnectionStats[] {
        if (eventId) {
            return this.eventStats.get(eventId) || {
                eventId,
                totalConnections: 0,
                adminConnections: 0,
                guestConnections: 0,
                moderatorConnections: 0, // Added missing property
                loggedUserConnections: 0, // Added missing property
                activeRooms: [this.getEventRoom(eventId)], // Fixed undefined array
                lastActivity: new Date()
            };
        }
        return Array.from(this.eventStats.values());
    }
    /**
     * Get global connection statistics (local server only in non-Redis mode)
     */
    public async getGlobalConnectionStats(): Promise<GlobalConnectionStats> {
        return {
            totalConnections: this.connectedClients.size,
            servers: 1, // Only this server in non-Redis mode
            serverStats: { [this.serverId]: this.connectedClients.size },
            timestamp: new Date()
        };
    }

    /**
     * Get total connected clients count (local server only)
     */
    public getTotalConnections(): number {
        return this.connectedClients.size;
    }

    /**
     * Disconnect all clients for an event (utility method)
     */
    public disconnectEventClients(eventId: string, reason: string = 'Event ended'): void {
        const eventRoom = this.getEventRoom(eventId);

        this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.ERROR, {
            code: 'EVENT_ENDED',
            message: reason
        });

        // Disconnect all sockets in the room
        this.io.to(eventRoom).disconnectSockets();

        logger.info(`🔌 Disconnected all clients from event ${eventId}: ${reason}`);
    }

    /**
     * Emit guest activity tracking
     */
    public emitGuestActivity(payload: {
        shareToken: string;
        eventId: string;
        activity: string;
        photoCount?: number;
        page?: number;
        guestInfo?: any;
    }): void {
        if (!payload.eventId) return;

        const eventRoom = this.getEventRoom(payload.eventId);

        logger.debug(`📊 Emitting guest activity to room ${eventRoom}:`, {
            activity: payload.activity,
            photoCount: payload.photoCount,
            page: payload.page
        });

        // Emit guest activity (admins can see guest engagement)
        this.io.to(eventRoom).emit('guest_activity', {
            ...payload,
            guestInfo: {
                ...payload.guestInfo,
                shareToken: payload.shareToken.substring(0, 8) + '...' // Hide full token
            }
        });
    }

    /**
     * Cleanup resources and connections
     */
    public async cleanup(): Promise<void> {
        try {
            logger.info('🧹 Starting WebSocket service cleanup...');

            // Disconnect all sockets
            this.io.disconnectSockets();

            // Clear local data structures
            this.connectedClients.clear();
            this.eventStats.clear();

            logger.info('✅ WebSocket service cleanup completed');
        } catch (error) {
            logger.error('❌ Error during WebSocket cleanup:', error);
            throw error;
        }
    }
}

// Singleton instance
let webSocketService: WebSocketService | null = null;

/**
 * Initialize WebSocket service
 */
export const initializeWebSocketService = (httpServer: HttpServer): WebSocketService => {
    if (!webSocketService) {
        webSocketService = new WebSocketService(httpServer);
    }
    return webSocketService;
};

/**
 * Get WebSocket service instance
 */
export const getWebSocketService = (): WebSocketService => {
    if (!webSocketService) {
        throw new Error('WebSocket service not initialized. Call initializeWebSocketService first.');
    }
    return webSocketService;
};

export default WebSocketService;
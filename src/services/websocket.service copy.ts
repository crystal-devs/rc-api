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
    ConnectedClient,
    EventConnectionStats,
    MediaProcessingPayload,
} from 'types/websocket.types';

interface GlobalConnectionStats {
    totalConnections: number;
    servers: number;
    serverStats: { [serverId: string]: number };
    timestamp: Date;
}

// Enhanced authentication data interface
interface EnhancedSocketAuthData extends SocketAuthData {
    guestInfo?: {
        name?: string;
        userAgent?: string;
        timestamp?: Date;
    };
}

class WebSocketService {
    public io: Server;
    private connectedClients: Map<string, ConnectedClient> = new Map();
    private eventStats: Map<string, EventConnectionStats> = new Map();
    private serverId: string;
    private authTimeouts: Map<string, NodeJS.Timeout> = new Map();

    constructor(httpServer: HttpServer) {
        this.serverId = process.env.SERVER_ID || `server-${Date.now()}`;

        this.io = new Server(httpServer, {
            cors: {
                origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://localhost:3001"],
                methods: ["GET", "POST"],
                credentials: true
            },
            connectionStateRecovery: {
                maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
                skipMiddlewares: true,
            },
            transports: ['websocket', 'polling'],
            allowEIO3: true, // Support older Socket.IO clients
            pingTimeout: 60000,
            pingInterval: 25000
        });

        this.initializeEventHandlers();
        this.startCleanupInterval();

        logger.info('🔌 Enhanced WebSocket service initialized', {
            serverId: this.serverId,
            transports: ['websocket', 'polling']
        });
    }

    /**
     * Initialize all WebSocket event handlers with enhanced error handling
     */
    private initializeEventHandlers(): void {
        this.io.on(WEBSOCKET_EVENTS.CONNECTION, (socket: Socket) => {
            const clientInfo = {
                id: socket.id,
                ip: socket.handshake.address,
                userAgent: socket.handshake.headers['user-agent']?.substring(0, 100),
                connectedAt: new Date()
            };

            logger.info(`🔗 New WebSocket connection:`, clientInfo);

            // Set connection timeout with longer duration for mobile clients
            const isMobile = clientInfo.userAgent?.toLowerCase().includes('mobile');
            const timeoutDuration = isMobile ? 45000 : 30000; // 45s for mobile, 30s for desktop

            const connectionTimeout = setTimeout(() => {
                if (!socket.data.authenticated) {
                    logger.warn(`⏰ Authentication timeout for socket: ${socket.id}`, {
                        duration: timeoutDuration,
                        userAgent: clientInfo.userAgent
                    });

                    socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                        code: 'CONNECTION_TIMEOUT',
                        message: 'Authentication timeout. Please reconnect.',
                        details: 'Connection must be authenticated within 30 seconds'
                    });

                    socket.disconnect(true);
                }
            }, timeoutDuration);

            this.authTimeouts.set(socket.id, connectionTimeout);

            // Handle authentication with enhanced data
            socket.on(WEBSOCKET_EVENTS.AUTHENTICATE, async (authData: EnhancedSocketAuthData) => {
                await this.handleAuthentication(socket, authData, clientInfo);
            });

            // Handle joining event
            socket.on(WEBSOCKET_EVENTS.JOIN_EVENT, async (eventId: string) => {
                await this.handleJoinEvent(socket as AuthenticatedSocket, eventId);
            });

            // Handle leaving event
            socket.on(WEBSOCKET_EVENTS.LEAVE_EVENT, async (eventId: string) => {
                await this.handleLeaveEvent(socket as AuthenticatedSocket, eventId);
            });

            // Handle guest ping (for activity tracking)
            socket.on('guest_ping', (data: any) => {
                if (socket.data.authenticated && socket.data.user?.type === 'guest') {
                    this.updateClientActivity(socket.id);

                    // Optional: emit guest activity
                    this.emitGuestActivity({
                        shareToken: socket.data.user.shareToken || '',
                        eventId: socket.data.eventId || '',
                        activity: 'ping',
                        guestInfo: {
                            guestId: socket.data.user.guestId,
                            lastActivity: new Date(),
                            ...data
                        }
                    });
                }
            });

            // Handle disconnection
            socket.on(WEBSOCKET_EVENTS.DISCONNECT, async (reason: string) => {
                await this.handleDisconnection(socket as AuthenticatedSocket, reason);
            });

            // Enhanced error handling
            socket.on('error', (error: any) => {
                logger.error(`❌ WebSocket error for ${socket.id}:`, {
                    error: error.message,
                    stack: error.stack,
                    clientInfo
                });

                // Clean up on error
                this.cleanupSocket(socket.id);
            });

            // Handle connection errors
            socket.on('connect_error', (error: any) => {
                logger.error(`❌ WebSocket connection error for ${socket.id}:`, {
                    error: error.message,
                    clientInfo
                });
            });
        });

        // Enhanced global error handler
        this.io.engine.on("connection_error", (err: any) => {
            logger.error("❌ Socket.IO connection error:", {
                code: err.code,
                message: err.message,
                context: err.context,
                type: err.type
            });
        });

        // Log connection stats periodically
        setInterval(() => {
            this.logConnectionStats();
        }, 60000); // Every minute
    }

    /**
     * Enhanced authentication handler with better guest support
     */
    private async handleAuthentication(
        socket: Socket,
        authData: EnhancedSocketAuthData,
        clientInfo: any
    ): Promise<void> {
        const authTimeout = this.authTimeouts.get(socket.id);
        if (authTimeout) {
            clearTimeout(authTimeout);
            this.authTimeouts.delete(socket.id);
        }

        try {
            logger.info(`🔐 Authenticating socket ${socket.id}:`, {
                hasToken: !!authData.token,
                hasShareToken: !!authData.shareToken,
                eventId: authData.eventId?.substring(0, 12) + '...',
                userType: authData.userType,
                guestName: authData.guestInfo?.name || 'Anonymous',
                clientInfo
            });

            // Enhanced validation
            if (!authData.eventId) {
                socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                    code: 'INVALID_EVENT',
                    message: 'Event ID is required',
                    details: 'Please provide a valid event ID'
                });
                return;
            }

            // Find event with better error handling
            let event;
            let actualEventId: string;

            try {
                // Handle different event ID formats
                if (authData.eventId.startsWith('evt_')) {
                    event = await Event.findOne({ share_token: authData.eventId })
                        .populate('created_by', 'name email')
                        .populate('co_hosts.user_id', 'name email')
                        .lean();
                    actualEventId = event?._id.toString() || '';
                } else if (authData.eventId.match(/^[0-9a-fA-F]{24}$/)) {
                    // Valid ObjectId
                    event = await Event.findById(authData.eventId)
                        .populate('created_by', 'name email')
                        .populate('co_hosts.user_id', 'name email')
                        .lean();
                    actualEventId = authData.eventId;
                } else {
                    throw new Error('Invalid event ID format');
                }

                if (!event) {
                    throw new Error('Event not found');
                }
            } catch (dbError: any) {
                logger.error(`❌ Database error during event lookup:`, {
                    error: dbError.message,
                    eventId: authData.eventId,
                    socketId: socket.id
                });

                socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                    code: 'EVENT_NOT_FOUND',
                    message: 'Event not found or inaccessible',
                    details: 'Please check your event link'
                });
                return;
            }

            let user: WebSocketUser;

            // Determine authentication method based on provided data
            if (authData.token && !authData.shareToken && authData.userType !== 'guest') {
                // JWT Authentication (for admins/co-hosts/logged users)
                user = await this.authenticateWithJWT(authData.token, event, actualEventId);
            } else if (authData.shareToken || authData.userType === 'guest') {
                // Share Token Authentication (for guests)
                const shareToken = authData.shareToken || authData.eventId;
                user = await this.authenticateWithShareToken(
                    shareToken,
                    event,
                    actualEventId,
                    {
                        ...authData.guestInfo,
                        userAgent: clientInfo.userAgent,
                        ip: clientInfo.ip,
                        connectedAt: clientInfo.connectedAt
                    }
                );
            } else {
                socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                    code: 'AUTH_FAILED',
                    message: 'Authentication credentials required',
                    details: 'Please provide either an auth token or share token'
                });
                return;
            }

            // Set socket data
            (socket as AuthenticatedSocket).user = user;
            (socket as AuthenticatedSocket).eventId = actualEventId;
            (socket as AuthenticatedSocket).authenticated = true;
            socket.data = {
                authenticated: true,
                user,
                eventId: actualEventId,
                connectedAt: new Date()
            };

            // Add to connected clients with enhanced info
            this.connectedClients.set(socket.id, {
                socketId: socket.id,
                user,
                connectedAt: new Date(),
                lastActivity: new Date(),
                rooms: [],
                clientInfo: {
                    ip: clientInfo.ip,
                    userAgent: clientInfo.userAgent,
                    authMethod: user.shareToken ? 'share_token' : 'jwt'
                }
            });

            // Update event stats
            this.updateEventStats(actualEventId);

            // Emit success with enhanced response
            const authResponse = {
                success: true,
                message: 'Authentication successful',
                data: {
                    user: {
                        id: user.id,
                        name: user.name || user.guestName || 'User',
                        type: user.type
                    },
                    eventId: actualEventId,
                    permissions: this.getUserPermissions(user, event),
                    serverInfo: {
                        serverId: this.serverId,
                        connectionId: socket.id,
                        timestamp: new Date()
                    }
                },
                timestamp: new Date()
            };

            socket.emit(WEBSOCKET_EVENTS.AUTH_SUCCESS, authResponse);

            logger.info(`✅ Socket ${socket.id} authenticated successfully:`, {
                userId: user.id,
                userType: user.type,
                userName: user.name || user.guestName || 'Anonymous',
                eventId: actualEventId,
                authMethod: user.shareToken ? 'share_token' : 'jwt'
            });

        } catch (error: any) {
            logger.error(`❌ Authentication failed for socket ${socket.id}:`, {
                error: error.message,
                stack: error.stack,
                authData: {
                    hasToken: !!authData.token,
                    hasShareToken: !!authData.shareToken,
                    eventId: authData.eventId?.substring(0, 8) + '...',
                    userType: authData.userType
                }
            });

            socket.emit(WEBSOCKET_EVENTS.AUTH_ERROR, {
                code: 'AUTH_FAILED',
                message: error.message || 'Authentication failed',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });

            // Clean up failed connection after a delay
            setTimeout(() => {
                if (!socket.data?.authenticated) {
                    socket.disconnect(true);
                }
            }, 1000);
        }
    }

    /**
     * Get user permissions based on user type and event settings
     */
    private getUserPermissions(user: WebSocketUser, event: any): any {
        const basePermissions = {
            view_media: true,
            upload_media: false,
            moderate_media: false,
            delete_media: false,
            manage_event: false
        };

        switch (user.type) {
            case 'admin':
                return {
                    ...basePermissions,
                    upload_media: true,
                    moderate_media: true,
                    delete_media: true,
                    manage_event: true
                };

            case 'co_host':
                return {
                    ...basePermissions,
                    upload_media: true,
                    moderate_media: true,
                    delete_media: event.co_host_permissions?.can_delete || false
                };

            case 'logged_user':
                return {
                    ...basePermissions,
                    upload_media: event.upload_settings?.allow_logged_users || false
                };

            case 'guest':
                return {
                    ...basePermissions,
                    upload_media: event.upload_settings?.allow_guests || false,
                    view_media: true // Guests can always view approved media
                };

            default:
                return basePermissions;
        }
    }

    /**
     * Enhanced JWT authentication
     */
    private async authenticateWithJWT(token: string, event: any, eventId: string): Promise<WebSocketUser> {
        try {
            const decoded = jwt.verify(token, keys.jwtSecret as string) as any;

            if (!decoded.userId) {
                throw new Error('Invalid token payload - missing userId');
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
            const coHost = event.co_hosts?.find((ch: any) =>
                ch.user_id._id.toString() === decoded.userId && ch.status === 'approved'
            );

            if (coHost) {
                return {
                    id: decoded.userId,
                    type: 'co_host',
                    eventId,
                    userId: decoded.userId,
                    name: coHost.user_id.name,
                    email: coHost.user_id.email,
                    coHostPermissions: coHost.permissions || {}
                };
            }

            // For private events, only admin/co-hosts can access
            if (event.visibility === 'private') {
                throw new Error('Access denied. This is a private event.');
            }

            // Regular logged user for public events
            return {
                id: decoded.userId,
                type: 'logged_user',
                eventId,
                userId: decoded.userId,
                name: decoded.name || 'User',
                email: decoded.email
            };

        } catch (error: any) {
            if (error.name === 'TokenExpiredError') {
                throw new Error('Authentication token has expired');
            } else if (error.name === 'JsonWebTokenError') {
                throw new Error('Invalid authentication token');
            }
            throw new Error(`JWT authentication failed: ${error.message}`);
        }
    }

    /**
     * Enhanced share token authentication with better validation
     */
    private async authenticateWithShareToken(
        shareToken: string,
        event: any,
        eventId: string,
        guestInfo?: any
    ): Promise<WebSocketUser> {
        try {
            logger.info(`🔐 Validating share token for event: ${eventId}`, {
                shareToken: shareToken.substring(0, 8) + '...',
                eventVisibility: event.visibility,
                shareSettingsActive: event.share_settings?.is_active,
                hasGuestInfo: !!guestInfo
            });

            // Enhanced private event check
            if (event.visibility === 'private') {
                logger.warn(`❌ Private event access denied:`, {
                    eventId,
                    shareToken: shareToken.substring(0, 8) + '...'
                });
                throw new Error('This event is private and requires authentication');
            }

            // Validate share token with multiple scenarios
            let isValidShareToken = false;
            let validationMethod = '';

            // Scenario 1: Direct share token match
            if (event.share_token && event.share_token === shareToken) {
                isValidShareToken = true;
                validationMethod = 'direct_match';
            }
            // Scenario 2: Event ID used as share token (compatibility)
            else if (shareToken === eventId || shareToken === event._id.toString()) {
                logger.warn('⚠️ Using eventId as shareToken - compatibility mode');
                isValidShareToken = true;
                validationMethod = 'eventid_fallback';
            }
            // Scenario 3: Share token format validation for evt_ prefix
            else if (shareToken.startsWith('evt_') && event.share_token === shareToken) {
                isValidShareToken = true;
                validationMethod = 'evt_prefix_match';
            }

            if (!isValidShareToken) {
                logger.error(`❌ Share token validation failed:`, {
                    providedToken: shareToken.substring(0, 8) + '...',
                    eventShareToken: event.share_token?.substring(0, 8) + '...' || 'none',
                    eventId: eventId
                });
                throw new Error('Invalid or expired share link');
            }

            logger.info(`✅ Share token validated via: ${validationMethod}`);

            // Check share settings
            if (!event.share_settings) {
                logger.warn('⚠️ Creating default share settings for event');
                event.share_settings = {
                    is_active: true,
                    expires_at: null,
                    max_guests: null
                };
            }

            if (!event.share_settings.is_active) {
                throw new Error('Event sharing is currently disabled');
            }

            // Check expiry
            if (event.share_settings.expires_at && new Date() > new Date(event.share_settings.expires_at)) {
                throw new Error('Share link has expired');
            }

            // Check guest limits (optional)
            if (event.share_settings.max_guests && event.share_settings.max_guests > 0) {
                const currentGuestCount = this.getEventGuestCount(eventId);
                if (currentGuestCount >= event.share_settings.max_guests) {
                    logger.warn(`⚠️ Guest limit reached for event: ${eventId}`);
                    throw new Error('Event has reached maximum guest capacity');
                }
            }

            // Generate unique guest ID
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).slice(2, 8);
            const guestId = `guest_${timestamp}_${randomSuffix}`;

            // Create enhanced guest user object
            const user: WebSocketUser = {
                id: guestId,
                type: 'guest',
                eventId: eventId,
                shareToken: shareToken,
                guestId: guestId,
                guestName: guestInfo?.name || 'Anonymous Guest',
                guestMetadata: {
                    connectedAt: new Date(),
                    userAgent: guestInfo?.userAgent || 'Unknown',
                    ip: guestInfo?.ip,
                    validationMethod: validationMethod,
                    shareTokenUsed: shareToken.substring(0, 8) + '...',
                    sessionInfo: {
                        connectionAttempts: 1,
                        lastActivity: new Date()
                    }
                }
            };

            logger.info(`✅ Guest user created:`, {
                guestId: user.guestId,
                guestName: user.guestName,
                eventId: user.eventId,
                validationMethod,
                ip: guestInfo?.ip
            });

            return user;

        } catch (error: any) {
            logger.error(`❌ Share token authentication failed:`, {
                error: error.message,
                eventId,
                shareToken: shareToken.substring(0, 8) + '...',
                stack: error.stack
            });

            throw new Error(`Share token authentication failed: ${error.message}`);
        }
    }

    /**
     * Enhanced event joining with better room management
     */
    private async handleJoinEvent(socket: AuthenticatedSocket, eventId: string): Promise<void> {
        try {
            if (!socket.authenticated || !socket.user) {
                socket.emit(WEBSOCKET_EVENTS.ERROR, {
                    code: 'NOT_AUTHENTICATED',
                    message: 'Authentication required to join event'
                });
                return;
            }

            if (socket.eventId !== eventId) {
                socket.emit(WEBSOCKET_EVENTS.ERROR, {
                    code: 'PERMISSION_DENIED',
                    message: 'Not authorized for this event'
                });
                return;
            }

            const eventRoom = this.getEventRoom(eventId);

            // Join the event room
            await socket.join(eventRoom);

            // Update client data
            const client = this.connectedClients.get(socket.id);
            if (client) {
                if (!client.rooms.includes(eventRoom)) {
                    client.rooms.push(eventRoom);
                }
                client.lastActivity = new Date();
            }

            // Update event stats
            this.updateEventStats(eventId);

            // Get current room stats for logging
            const roomSockets = await this.io.in(eventRoom).allSockets();
            const roomCount = roomSockets.size;

            // Notify others in the room (except for guest joins to reduce noise)
            if (socket.user.type !== 'guest') {
                socket.to(eventRoom).emit(WEBSOCKET_EVENTS.GUEST_JOINED, {
                    user: {
                        id: socket.user.id,
                        name: socket.user.name || socket.user.guestName || 'User',
                        type: socket.user.type
                    },
                    timestamp: new Date(),
                    roomStats: {
                        totalConnected: roomCount
                    }
                });
            }

            // Send room info to the joining user
            socket.emit('room_joined', {
                eventId,
                roomName: eventRoom,
                connectedClients: roomCount,
                userType: socket.user.type,
                permissions: this.getUserPermissions(socket.user, {}), // You might want to pass actual event data
                timestamp: new Date()
            });

            logger.info(`👥 Socket ${socket.id} joined event room: ${eventRoom}`, {
                userId: socket.user.id,
                userType: socket.user.type,
                userName: socket.user.name || socket.user.guestName,
                totalInRoom: roomCount
            });

        } catch (error: any) {
            logger.error(`❌ Failed to join event ${eventId}:`, {
                error: error.message,
                socketId: socket.id,
                userId: socket.user?.id
            });

            socket.emit(WEBSOCKET_EVENTS.ERROR, {
                code: 'JOIN_FAILED',
                message: 'Failed to join event room',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Enhanced event leaving
     */
    private async handleLeaveEvent(socket: AuthenticatedSocket, eventId: string): Promise<void> {
        try {
            const eventRoom = this.getEventRoom(eventId);
            await socket.leave(eventRoom);

            // Update client data
            const client = this.connectedClients.get(socket.id);
            if (client) {
                client.rooms = client.rooms.filter(room => room !== eventRoom);
                client.lastActivity = new Date();
            }

            // Update event stats
            this.updateEventStats(eventId);

            // Notify others (except for guest leaves to reduce noise)
            if (socket.user?.type !== 'guest') {
                socket.to(eventRoom).emit(WEBSOCKET_EVENTS.GUEST_LEFT, {
                    user: {
                        id: socket.user.id,
                        name: socket.user.name || socket.user.guestName || 'User',
                        type: socket.user.type
                    },
                    timestamp: new Date()
                });
            }

            logger.info(`👋 Socket ${socket.id} left event room: ${eventRoom}`, {
                userId: socket.user?.id,
                userType: socket.user?.type
            });

        } catch (error: any) {
            logger.error(`❌ Failed to leave event ${eventId}:`, {
                error: error.message,
                socketId: socket.id
            });
        }
    }

    /**
     * Enhanced disconnection handling
     */
    private async handleDisconnection(socket: AuthenticatedSocket, reason: string): Promise<void> {
        try {
            this.cleanupSocket(socket.id);

            const client = this.connectedClients.get(socket.id);

            if (client) {
                // Update event stats for all rooms the client was in
                const uniqueEventIds = new Set(
                    client.rooms.map(room => room.replace('event_', ''))
                );

                uniqueEventIds.forEach(eventId => {
                    this.updateEventStats(eventId);
                });

                // Log disconnection with details
                logger.info(`🔌 Socket ${socket.id} disconnected:`, {
                    reason,
                    userId: client.user.id,
                    userType: client.user.type,
                    userName: client.user.name || client.user.guestName,
                    connectedDuration: Date.now() - client.connectedAt.getTime(),
                    roomsCount: client.rooms.length
                });

                // Remove from connected clients
                this.connectedClients.delete(socket.id);
            }

        } catch (error: any) {
            logger.error(`❌ Error handling disconnection for socket ${socket.id}:`, {
                error: error.message,
                reason
            });
        }
    }

    /**
     * Cleanup socket resources
     */
    private cleanupSocket(socketId: string): void {
        // Clear any auth timeouts
        const authTimeout = this.authTimeouts.get(socketId);
        if (authTimeout) {
            clearTimeout(authTimeout);
            this.authTimeouts.delete(socketId);
        }
    }

    /**
     * Start periodic cleanup of inactive connections
     */
    private startCleanupInterval(): void {
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Clean up inactive connections
     */
    private cleanupInactiveConnections(): void {
        const now = Date.now();
        const maxInactivity = 30 * 60 * 1000; // 30 minutes

        let cleanedCount = 0;

        for (const [socketId, client] of Array.from(this.connectedClients.entries())) {
            const inactiveTime = now - client.lastActivity.getTime();

            if (inactiveTime > maxInactivity) {
                logger.info(`🧹 Cleaning up inactive connection: ${socketId}`, {
                    userId: client.user.id,
                    inactiveMinutes: Math.round(inactiveTime / 60000)
                });

                this.connectedClients.delete(socketId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info(`🧹 Cleaned up ${cleanedCount} inactive connections`);
        }
    }

    /**
     * Update client activity timestamp
     */
    private updateClientActivity(socketId: string): void {
        const client = this.connectedClients.get(socketId);
        if (client) {
            client.lastActivity = new Date();
        }
    }

    /**
     * Get current guest count for an event
     */
    private getEventGuestCount(eventId: string): number {
        const eventRoom = this.getEventRoom(eventId);
        return Array.from(this.connectedClients.values())
            .filter(client =>
                client.rooms.includes(eventRoom) &&
                client.user.type === 'guest'
            ).length;
    }

    /**
     * Get event room name
     */
    private getEventRoom(eventId: string): string {
        return `event_${eventId}`;
    }

    /**
     * Enhanced event statistics update
     */
    private updateEventStats(eventId: string): void {
        const eventRoom = this.getEventRoom(eventId);
        const roomClients = Array.from(this.connectedClients.values())
            .filter(client => client.rooms.includes(eventRoom));

        // Count different user types
        const stats = {
            adminConnections: 0,
            guestConnections: 0,
            moderatorConnections: 0,
            loggedUserConnections: 0,
            coHostConnections: 0
        };

        roomClients.forEach(client => {
            switch (client.user.type) {
                case 'admin':
                    stats.adminConnections++;
                    break;
                case 'guest':
                    stats.guestConnections++;
                    break;
                case 'moderator':
                    stats.moderatorConnections++;
                    break;
                case 'logged_user':
                    stats.loggedUserConnections++;
                    break;
                case 'co_host':
                    stats.coHostConnections++;
                    break;
            }
        });

        const eventStats: EventConnectionStats = {
            eventId,
            totalConnections: roomClients.length,
            ...stats,
            activeRooms: [eventRoom],
            lastActivity: new Date()
        };

        this.eventStats.set(eventId, eventStats);
    }

    /**
     * Enhanced connection stats logging
     */
    private logConnectionStats(): void {
        const totalConnections = this.connectedClients.size;
        const eventStats = Array.from(this.eventStats.values());

        if (totalConnections > 0 || eventStats.length > 0) {
            logger.info('📊 Enhanced WebSocket Connection Stats:', {
                serverId: this.serverId,
                totalConnections,
                activeEvents: eventStats.length,
                eventBreakdown: eventStats.map(stat => ({
                    eventId: stat.eventId.substring(0, 8) + '...',
                    total: stat.totalConnections,
                    admins: stat.adminConnections,
                    guests: stat.guestConnections,
                    coHosts: stat.coHostConnections,
                    loggedUsers: stat.loggedUserConnections
                })),
                memoryUsage: {
                    connectedClients: this.connectedClients.size,
                    eventStats: this.eventStats.size,
                    authTimeouts: this.authTimeouts.size
                }
            });
        }
    }

    // ==========================================
    // PUBLIC METHODS FOR CONTROLLERS
    // ==========================================

    /**
     * Enhanced media status update emission
     */
    public async emitMediaStatusUpdate(payload: MediaStatusUpdatePayload): Promise<void> {
        try {
            const eventRoom = this.getEventRoom(payload.eventId);

            // Get room information
            const roomSockets = await this.io.in(eventRoom).allSockets();
            const clientCount = roomSockets.size;

            if (clientCount === 0) {
                logger.warn(`⚠️ No clients in event room ${eventRoom} for media status update`);
                return;
            }

            // Enhanced logging
            logger.info(`📤 Emitting media status update to ${clientCount} clients:`, {
                eventRoom,
                mediaId: payload.mediaId.substring(0, 8) + '...',
                previousStatus: payload.previousStatus,
                newStatus: payload.newStatus,
                updatedBy: payload.updatedBy.name,
                guestVisibilityChanged: payload.guestVisibility?.changed,
                changeType: payload.guestVisibility?.changeType
            });

            // Emit to all users in the event room
            // You could potentially emit different data to different user types here
            this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.MEDIA_STATUS_UPDATED, payload);

            // Optional: Emit specific events for different visibility changes
            if (payload.guestVisibility?.changed) {
                const visibilityEvent = payload.guestVisibility.isVisible
                    ? 'media_became_visible'
                    : 'media_became_hidden';

                this.io.to(eventRoom).emit(visibilityEvent, {
                    mediaId: payload.mediaId,
                    eventId: payload.eventId,
                    newStatus: payload.newStatus,
                    timestamp: new Date()
                });
            }

        } catch (error: any) {
            logger.error(`❌ Failed to emit media status update:`, {
                error: error.message,
                stack: error.stack,
                eventRoom: this.getEventRoom(payload.eventId),
                mediaId: payload.mediaId
            });
            throw error;
        }
    }

    /**
     * Enhanced new media upload emission
     */
    public emitNewMediaUpload(payload: NewMediaUploadPayload): void {
        try {
            const eventRoom = this.getEventRoom(payload.eventId);

            logger.info(`📤 Emitting new media upload to room ${eventRoom}:`, {
                mediaId: payload.mediaId.substring(0, 8) + '...',
                uploadedBy: payload.uploadedBy.name,
                status: payload.status,
                uploaderType: payload.uploadedBy.type
            });

            this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.NEW_MEDIA_UPLOADED, payload);

        } catch (error: any) {
            logger.error(`❌ Failed to emit new media upload:`, {
                error: error.message,
                eventId: payload.eventId,
                mediaId: payload.mediaId
            });
        }
    }

    /**
     * Enhanced guest activity emission
     */
    public emitGuestActivity(payload: {
        shareToken: string;
        eventId: string;
        activity: string;
        photoCount?: number;
        page?: number;
        guestInfo?: any;
    }): void {
        try {
            if (!payload.eventId) {
                logger.warn('⚠️ Cannot emit guest activity: missing eventId');
                return;
            }

            const eventRoom = this.getEventRoom(payload.eventId);

            logger.debug(`📊 Emitting guest activity to room ${eventRoom}:`, {
                activity: payload.activity,
                photoCount: payload.photoCount,
                page: payload.page,
                hasGuestInfo: !!payload.guestInfo
            });

            // Create sanitized payload
            const sanitizedPayload = {
                ...payload,
                shareToken: payload.shareToken.substring(0, 8) + '...', // Hide full token
                guestInfo: {
                    ...payload.guestInfo,
                    // Remove sensitive info
                    ip: undefined,
                    userAgent: payload.guestInfo?.userAgent?.substring(0, 50) + '...'
                },
                timestamp: new Date()
            };

            // Emit to admins only (guests don't need to see other guest activity)
            this.io.to(eventRoom).emit('guest_activity', sanitizedPayload);

        } catch (error: any) {
            logger.error(`❌ Failed to emit guest activity:`, {
                error: error.message,
                eventId: payload.eventId,
                activity: payload.activity
            });
        }
    }

    /**
     * Get enhanced connection statistics
     */
    public getConnectionStats(eventId?: string): EventConnectionStats | EventConnectionStats[] {
        if (eventId) {
            const stats = this.eventStats.get(eventId);
            if (stats) {
                return stats;
            }

            // Return empty stats if event not found
            return {
                eventId,
                totalConnections: 0,
                adminConnections: 0,
                guestConnections: 0,
                moderatorConnections: 0,
                loggedUserConnections: 0,
                coHostConnections: 0,
                activeRooms: [this.getEventRoom(eventId)],
                lastActivity: new Date()
            };
        }

        return Array.from(this.eventStats.values());
    }

    /**
     * Get global connection statistics
     */
    public async getGlobalConnectionStats(): Promise<GlobalConnectionStats> {
        return {
            totalConnections: this.connectedClients.size,
            servers: 1,
            serverStats: { [this.serverId]: this.connectedClients.size },
            timestamp: new Date()
        };
    }

    /**
     * Get total connected clients count
     */
    public getTotalConnections(): number {
        return this.connectedClients.size;
    }

    /**
     * Disconnect all clients for an event
     */
    public disconnectEventClients(eventId: string, reason: string = 'Event ended'): void {
        const eventRoom = this.getEventRoom(eventId);

        logger.info(`🔌 Disconnecting all clients from event ${eventId}: ${reason}`);

        this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.ERROR, {
            code: 'EVENT_ENDED',
            message: reason,
            action: 'disconnect'
        });

        // Give clients time to handle the message before disconnecting
        setTimeout(() => {
            this.io.to(eventRoom).disconnectSockets(true);
        }, 1000);
    }

    public emitMediaProcessingUpdate(payload: MediaProcessingPayload): void {
        try {
            const eventRoom = this.getEventRoom(payload.eventId);

            logger.info(`📤 Emitting media processing update to room ${eventRoom}:`, {
                mediaId: payload.mediaId.substring(0, 8) + '...',
                processingStatus: payload.processingStatus,
                progress: payload.progress,
                stage: payload.stage
            });

            this.io.to(eventRoom).emit(WEBSOCKET_EVENTS.MEDIA_PROCESSING_UPDATE, payload);

        } catch (error: any) {
            logger.error(`❌ Failed to emit media processing update:`, {
                error: error.message,
                eventId: payload.eventId,
                mediaId: payload.mediaId
            });
        }
    }

    /**
     * Enhanced cleanup method
     */
    public async cleanup(): Promise<void> {
        try {
            logger.info('🧹 Starting enhanced WebSocket service cleanup...');

            // Clear all timeouts
            for (const timeout of Array.from(this.authTimeouts.values())) {
                clearTimeout(timeout);
            }
            this.authTimeouts.clear();

            // Disconnect all sockets gracefully
            this.io.emit('server_shutdown', {
                message: 'Server is shutting down',
                timestamp: new Date()
            });

            // Wait a bit for clients to handle the message
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Force disconnect all sockets
            this.io.disconnectSockets();

            // Clear data structures
            this.connectedClients.clear();
            this.eventStats.clear();

            logger.info('✅ Enhanced WebSocket service cleanup completed');
        } catch (error: any) {
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

        // Add graceful shutdown handling
        process.on('SIGTERM', async () => {
            logger.info('📴 SIGTERM received, shutting down WebSocket service gracefully...');
            try {
                await webSocketService?.cleanup();
                process.exit(0);
            } catch (error) {
                logger.error('❌ Error during graceful shutdown:', error);
                process.exit(1);
            }
        });

        process.on('SIGINT', async () => {
            logger.info('📴 SIGINT received, shutting down WebSocket service gracefully...');
            try {
                await webSocketService?.cleanup();
                process.exit(0);
            } catch (error) {
                logger.error('❌ Error during graceful shutdown:', error);
                process.exit(1);
            }
        });
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
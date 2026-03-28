// services/websocket/websocket.service.ts - Enhanced with Bulk Operations
// ====================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { websocketAuthMiddleware, websocketRateLimit, websocketLogger } from '@middlewares/websocket-auth.middleware';
import { createAdapter } from '@socket.io/redis-adapter';

// Import our management services
import { authenticateConnection, handleSubscription } from './management/websocket-auth.service';
import { WebSocketHealthService } from './management/websocket-health.service';
import { getRedisClient } from '@configs/redis.config';
import { RedisClientType } from 'redis';

export interface BulkOperationState {
    operationId: string;
    type: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    progress: { completed: number; total: number; errors: number };
    startTime: number;
    userId: string;
    eventId: string;
}

import type {
    ClientConnectionState,
    AuthData,
    StatusUpdatePayload,
    ConnectionStats,
    ConnectionHealth,
    SubscriptionData
} from './websocket.types';

// New types for bulk operations
interface BulkStatusUpdatePayload {
    type: 'bulk_status_update';
    eventId: string;
    operation: {
        mediaIds: string[];
        newStatus: string;
        previousStatus: string;
        updatedBy: {
            id: string;
            name: string;
            type: string;
        };
        reason?: string;
        hideReason?: string;
        timestamp: Date;
        summary: {
            totalRequested: number;
            totalModified: number;
            totalFailed: number;
            success: boolean;
        };
    };
}

interface BulkStatusBatchPayload {
    type: 'bulk_status_batch';
    eventId: string;
    batchIndex: number;
    totalBatches: number;
    mediaIds: string[];
    newStatus: string;
    updatedBy: {
        id: string;
        name: string;
        type: string;
    };
    timestamp: Date;
}

interface BulkProgressPayload {
    operationId: string;
    eventId: string;
    operationType: 'status_update' | 'delete' | 'move';
    progress: {
        completed: number;
        total: number;
        percentage: number;
        errors: number;
    };
    status: 'in_progress' | 'completed' | 'failed';
    updatedBy: {
        id: string;
        name: string;
        type: string;
    };
    timestamp: Date;
}

interface IndividualStatusUpdate {
    type: 'status_update';
    mediaId: string;
    eventId: string;
    newStatus: string;
    previousStatus: string;
    updatedBy: {
        id: string;
        name: string;
        type: string;
    };
    timestamp: Date;
    bulkOperation: boolean;
}

class SimpleWebSocketService {
    public io: Server;
    private connectedClients: Map<string, ClientConnectionState> = new Map();
    private healthService: WebSocketHealthService;

    // Track subscriptions separately from Socket.IO rooms
    private eventSubscriptions: Map<string, Set<string>> = new Map(); // eventId -> Set(socketIds)
    private clientSubscriptions: Map<string, Set<string>> = new Map(); // socketId -> Set(eventIds)

    private redis: RedisClientType | null = getRedisClient();
    private readonly BULK_OP_TTL = 3600; // 1 hour

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
        this.attachRedisAdapter();
        logger.info('🔌 Enhanced WebSocket service initialized with subscription management and bulk operations');
    }

    /**
     * Attach a Redis pub/sub adapter so Socket.IO events are propagated
     * across all instances (horizontal scaling).
     * Falls back gracefully if Redis is not available (dev / single-instance).
     */
    private async attachRedisAdapter(): Promise<void> {
        try {
            const redisClient = getRedisClient();
            if (!redisClient || !redisClient.isReady) {
                logger.warn('⚠️ Redis not ready — WebSocket running in single-instance mode (no pub/sub adapter)');
                return;
            }

            // The adapter requires two separate connections:
            // one for publishing (write) and one for subscribing (blocked read).
            const pubClient = redisClient.duplicate();
            const subClient = redisClient.duplicate();

            await Promise.all([pubClient.connect(), subClient.connect()]);

            this.io.adapter(createAdapter(pubClient, subClient));
            logger.info('✅ Socket.IO Redis pub/sub adapter attached — horizontal scaling enabled');
        } catch (error) {
            logger.error('❌ Failed to attach Redis adapter — falling back to single-instance mode:', error);
        }
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
            this.clientSubscriptions.set(socket.id, new Set());

            const authTimeout = setTimeout(() => {
                if (!socket.data?.authenticated) {
                    logger.warn(`⏰ Auth timeout: ${socket.id}`);
                    socket.emit('auth_error', { message: 'Authentication timeout' });
                    this.cleanupClientSubscriptions(socket.id);
                    socket.disconnect();
                }
            }, 30000);

            socket.on('authenticate', async (authData: AuthData) => {
                clearTimeout(authTimeout);
                await authenticateConnection(socket, authData, this.connectedClients);
            });

            // Subscription-based event handling
            socket.on('subscribe_to_event', async (data: SubscriptionData) => {
                await this.handleEventSubscription(socket, data);
            });

            socket.on('unsubscribe_from_event', async (data: SubscriptionData) => {
                await this.handleEventUnsubscription(socket, data);
            });

            // LEGACY: Backward compatibility with room-based system
            socket.on('join_event', async (eventId: string) => {
                logger.info(`🔄 Legacy join_event converted to subscription for ${socket.id}`);
                await this.handleEventSubscription(socket, { eventId });
            });

            socket.on('leave_event', async (eventId: string) => {
                logger.info(`🔄 Legacy leave_event converted to unsubscription for ${socket.id}`);
                await this.handleEventUnsubscription(socket, { eventId });
            });

            // NEW: Bulk operation event handlers
            socket.on('bulk_operation_status', async (data: { operationId: string }) => {
                if (!this.redis) return;

                try {
                    const opKey = `bulk_op:${data.operationId}`;
                    const operationStr = await this.redis.get(opKey);

                    if (operationStr) {
                        const operation = JSON.parse(operationStr as string);
                        socket.emit('bulk_operation_info', {
                            operationId: data.operationId,
                            ...operation,
                            duration: Date.now() - operation.startTime
                        });
                    } else {
                        socket.emit('bulk_operation_not_found', { operationId: data.operationId });
                    }
                } catch (error) {
                    logger.error('Error fetching bulk op status:', error);
                }
            });
            // NEW: Subscription synchronization
            socket.on('sync_subscriptions', async (data: { subscriptions: string[] }) => {
                if (!socket.data?.authenticated) {
                    logger.warn(` Unauthenticated sync attempt from ${socket.id}`);
                    return;
                }

                try {
                    const serverSubs = Array.from(this.clientSubscriptions.get(socket.id) || []);
                    const clientSubs = data.subscriptions || [];

                    logger.info(` Syncing subscriptions for ${socket.id}:`, {
                        server: serverSubs,
                        client: clientSubs
                    });

                    // Find differences
                    const toAdd = clientSubs.filter(e => !serverSubs.includes(e));
                    const toRemove = serverSubs.filter(e => !clientSubs.includes(e));

                    // Reconcile: Add missing subscriptions
                    for (const eventId of toAdd) {
                        logger.info(` Adding subscription: ${eventId}`);
                        await this.handleEventSubscription(socket, { eventId });
                    }

                    // Reconcile: Remove extra subscriptions
                    for (const eventId of toRemove) {
                        logger.info(` Removing subscription: ${eventId}`);
                        await this.handleEventUnsubscription(socket, { eventId });
                    }

                    // Get final state
                    const finalSubs = Array.from(this.clientSubscriptions.get(socket.id) || []);

                    // Send confirmation
                    socket.emit('sync_complete', {
                        synced: finalSubs,
                        added: toAdd,
                        removed: toRemove,
                        timestamp: new Date()
                    });

                    logger.info(` Sync complete for ${socket.id}:`, {
                        synced: finalSubs.length,
                        added: toAdd.length,
                        removed: toRemove.length
                    });

                } catch (error: any) {
                    logger.error(` Sync failed for ${socket.id}:`, error);
                    socket.emit('sync_error', {
                        message: error.message || 'Sync failed'
                    });
                }
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
                const subscriptions = this.clientSubscriptions.get(socket.id);

                socket.emit('connection_status', {
                    isHealthy: client?.isHealthy ?? false,
                    lastHeartbeat: client?.lastHeartbeat ?? new Date(),
                    connectedAt: client?.connectedAt ?? new Date(),
                    reconnectCount: client?.reconnectCount ?? 0,
                    subscriptions: Array.from(subscriptions || [])
                });
            });

            socket.on('disconnect', (reason: string) => {
                clearTimeout(authTimeout);
                this.cleanupClientSubscriptions(socket.id);
                this.healthService.handleDisconnection(socket, reason);

                // Broadcast updated counts for all events this client was subscribed to
                const subscriptions = this.clientSubscriptions.get(socket.id);
                if (subscriptions) {
                    subscriptions.forEach(eventId => {
                        setTimeout(() => this.broadcastSubscriptionCounts(eventId), 100);
                    });
                }
            });

            socket.on('error', (error: Error) => {
                logger.error(`❌ Socket error ${socket.id}:`, error);
                this.healthService.markUnhealthy(socket.id);
            });
        });
    }

    private async handleEventSubscription(socket: Socket, data: SubscriptionData): Promise<void> {
        const { eventId, shareToken } = data;

        if (!socket.data?.authenticated) {
            socket.emit('subscription_error', {
                eventId,
                message: 'Not authenticated'
            });
            return;
        }

        try {
            // Validate subscription access
            const isValid = await handleSubscription(socket, eventId, shareToken || '', this.connectedClients);

            if (!isValid) {
                socket.emit('subscription_error', {
                    eventId,
                    message: 'Access denied to event'
                });
                return;
            }

            // Add to subscription tracking
            if (!this.eventSubscriptions.has(eventId)) {
                this.eventSubscriptions.set(eventId, new Set());
            }
            this.eventSubscriptions.get(eventId)!.add(socket.id);

            const clientSubs = this.clientSubscriptions.get(socket.id);
            if (clientSubs) {
                clientSubs.add(eventId);
            }

            // Join Socket.IO room for efficient broadcasting
            const user = socket.data.user;
            const roomName = this.getRoomName(eventId, user.type);
            await socket.join(roomName);

            logger.info(`📝 ${socket.id} (${user.type}) subscribed to event ${eventId}`);

            socket.emit('subscription_success', {
                eventId,
                room: roomName,
                userType: user.type
            });

            // For backward compatibility, also emit joined_event
            socket.emit('joined_event', {
                eventId,
                room: roomName,
                userType: user.type
            });

            // Broadcast updated counts
            setTimeout(() => this.broadcastSubscriptionCounts(eventId), 100);

        } catch (error: any) {
            logger.error(`❌ Subscription error for event ${eventId}:`, error);
            socket.emit('subscription_error', {
                eventId,
                message: error.message || 'Subscription failed'
            });
        }
    }

    private async handleEventUnsubscription(socket: Socket, data: SubscriptionData): Promise<void> {
        const { eventId } = data;

        if (!socket.data?.authenticated) {
            return;
        }

        try {
            // Remove from subscription tracking
            if (this.eventSubscriptions.has(eventId)) {
                this.eventSubscriptions.get(eventId)!.delete(socket.id);

                // Clean up empty event subscriptions
                if (this.eventSubscriptions.get(eventId)!.size === 0) {
                    this.eventSubscriptions.delete(eventId);
                }
            }

            const clientSubs = this.clientSubscriptions.get(socket.id);
            if (clientSubs) {
                clientSubs.delete(eventId);
            }

            // Leave Socket.IO rooms
            const user = socket.data.user;
            const adminRoom = this.getRoomName(eventId, 'admin');
            const guestRoom = this.getRoomName(eventId, 'guest');

            await socket.leave(adminRoom);
            await socket.leave(guestRoom);

            logger.info(`📝 ${socket.id} unsubscribed from event ${eventId}`);

            socket.emit('unsubscription_success', { eventId });

            // Broadcast updated counts
            setTimeout(() => this.broadcastSubscriptionCounts(eventId), 100);

        } catch (error: any) {
            logger.error(`❌ Unsubscription error for event ${eventId}:`, error);
        }
    }

    private cleanupClientSubscriptions(socketId: string): void {
        const clientSubs = this.clientSubscriptions.get(socketId);

        if (clientSubs) {
            // Remove client from all event subscriptions
            clientSubs.forEach(eventId => {
                if (this.eventSubscriptions.has(eventId)) {
                    this.eventSubscriptions.get(eventId)!.delete(socketId);

                    // Clean up empty event subscriptions
                    if (this.eventSubscriptions.get(eventId)!.size === 0) {
                        this.eventSubscriptions.delete(eventId);
                    }
                }
            });

            // Remove client subscriptions
            this.clientSubscriptions.delete(socketId);
        }
    }

    private getRoomName(eventId: string, userType: string): string {
        return userType === 'admin' || userType === 'co_host'
            ? `admin_${eventId}`
            : `guest_${eventId}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Single media status update
    // Emits slim guest events: new_photos_available or photo_removed
    // Emits full details to admin room: media_status_updated
    // ─────────────────────────────────────────────────────────────────────────
    public emitStatusUpdate(payload: StatusUpdatePayload): void {
        const adminRoom = `admin_${payload.eventId}`;
        const guestRoom = `guest_${payload.eventId}`;
        const isNowVisible = payload.newStatus === 'approved' || payload.newStatus === 'auto_approved';
        const wasVisible = payload.previousStatus === 'approved' || payload.previousStatus === 'auto_approved';

        logger.info(`📤 Status update: ${payload.mediaId.substring(0, 8)} (${payload.previousStatus} → ${payload.newStatus})`);

        // Admin gets full detail
        this.io.to(adminRoom).emit('media_status_updated', payload);

        // Guest gets only meaningful state changes — no full payloads
        if (isNowVisible && !wasVisible) {
            // Photo became visible
            this.io.to(guestRoom).emit('new_photos_available', {
                eventId: payload.eventId,
                count: 1,
                timestamp: new Date()
            });
        } else if (!isNowVisible) {
            // Unconditionally emit removal for non-visible statuses
            // The guest UI ignores mediaIds it doesn't currently display
            this.io.to(guestRoom).emit('photo_removed', {
                mediaId: payload.mediaId,
                eventId: payload.eventId,
                timestamp: new Date()
            });
        }
        // No emit for status changes that don't affect guest visibility
        // (e.g. pending → rejected when photo was never shown)
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Bulk status update — admin gets started + complete events, guests get
    // a single new_photos_available or photo_removed at the end.
    // ─────────────────────────────────────────────────────────────────────────
    public async emitBulkStatusUpdate(payload: BulkStatusUpdatePayload): Promise<void> {
        try {
            const { eventId } = payload;
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;
            const operationId = `bulk_${eventId}_${Date.now()}`;
            const { mediaIds, newStatus, previousStatus, updatedBy, summary, timestamp } = payload.operation;

            // Track in Redis
            await this.startBulkOperation({
                operationId,
                type: 'status_update',
                status: 'completed',
                progress: { completed: mediaIds.length, total: mediaIds.length, errors: summary.totalFailed },
                startTime: timestamp.getTime(),
                userId: updatedBy.id,
                eventId
            });

            // Admin: single summary event (not per-batch / per-item noise)
            this.io.to(adminRoom).emit('bulk_operation_complete', {
                operationId,
                eventId,
                operationType: 'status_update',
                newStatus,
                summary: {
                    requested: summary.totalRequested,
                    completed: summary.totalModified,
                    failed: summary.totalFailed,
                    skipped: summary.totalRequested - summary.totalModified - summary.totalFailed,
                    duration: 0
                },
                updatedBy,
                success: summary.success,
                timestamp: timestamp.toISOString()
            });

            const isNowVisible = ['approved', 'auto_approved'].includes(newStatus);

            // Guest: one notification per batch, not per item
            if (isNowVisible && summary.totalModified > 0) {
                this.io.to(guestRoom).emit('new_photos_available', {
                    eventId,
                    count: summary.totalModified,
                    timestamp: new Date()
                });
            } else if (!isNowVisible && summary.totalModified > 0) {
                // Emitting removal unconditionally for non-visible statuses.
                // The guest frontend safely ignores mediaIds it doesn't currently display.
                for (const mediaId of mediaIds) {
                    this.io.to(guestRoom).emit('photo_removed', {
                        mediaId,
                        eventId,
                        timestamp: new Date()
                    });
                }
            }

            logger.info(`✅ Bulk status update → bulk_operation_complete + guest event: event=${eventId}, count=${mediaIds.length}, status=${newStatus}`);
        } catch (error: any) {
            logger.error('❌ Failed to emit bulk status update:', { error: error.message, eventId: payload.eventId });
            throw error;
        }
    }

    /**
     * @deprecated — per-batch events removed. Use emitBulkStatusUpdate instead.
     * Kept as a no-op so existing callers don't break.
     */
    public async emitBulkStatusBatch(_payload: BulkStatusBatchPayload): Promise<void> {
        // No-op: granular batch events replaced by single bulk_operation_complete
        return;
    }

    /**
     * @deprecated — per-item events removed. No-op kept for backward compat.
     */
    public async emitBulkIndividualUpdates(_updates: any[]): Promise<void> {
        // No-op: replaced by single new_photos_available / photo_removed
        return;
    }

    /**
     * @deprecated — per-progress events removed. No-op kept for backward compat.
     */
    public async emitBulkProgress(_payload: any): Promise<void> {
        // No-op: admin progress moved to SSE
        return;
    }

    /**
     * @deprecated — Use emitBulkStatusUpdate which now emits bulk_operation_complete internally.
     * Kept as a thin wrapper for any external callers.
     */
    public async emitBulkOperationComplete(payload: any): Promise<void> {
        try {
            const { eventId, operationType, summary, updatedBy, timestamp } = payload;
            const adminRoom = `admin_${eventId}`;

            this.io.to(adminRoom).emit('bulk_operation_complete', {
                eventId,
                operationType,
                summary,
                updatedBy,
                success: summary.completed > 0,
                timestamp: timestamp instanceof Date ? timestamp.toISOString() : timestamp
            });

            logger.info(`🏁 Bulk operation complete: ${eventId} - ${operationType}`);
        } catch (error: any) {
            logger.error('❌ emitBulkOperationComplete failed:', { error: error.message });
        }
    }


    // EXISTING methods (unchanged)
    public getSubscriptionCounts(): Record<string, number> {
        const counts: Record<string, number> = {};

        // Count subscriptions by room type
        this.connectedClients.forEach((client, socketId) => {
            const clientSubs = this.clientSubscriptions.get(socketId);
            if (clientSubs && client.user) {
                clientSubs.forEach(eventId => {
                    const roomName = this.getRoomName(eventId, client.user.type);
                    counts[roomName] = (counts[roomName] || 0) + 1;
                });
            }
        });

        return counts;
    }

    public broadcastSubscriptionCounts(eventId: string): void {
        const adminRoom = `admin_${eventId}`;
        const guestRoom = `guest_${eventId}`;
        const subscriptionCounts = this.getSubscriptionCounts();

        const adminCount = subscriptionCounts[adminRoom] || 0;
        const guestCount = subscriptionCounts[guestRoom] || 0;
        const total = adminCount + guestCount;

        // Send to admin room (they see both counts)
        this.io.to(adminRoom).emit('room_user_counts', {
            eventId,
            adminCount,
            guestCount,
            total
        });

        logger.info(`📊 Subscription counts for ${eventId}: Admin(${adminCount}) Guest(${guestCount}) Total(${total})`);
    }

    // Legacy method for backward compatibility
    public getRoomUserCounts(): Record<string, number> {
        return this.getSubscriptionCounts();
    }

    // Legacy method for backward compatibility
    public brodCastRoomCounts(eventId: string): void {
        this.broadcastSubscriptionCounts(eventId);
    }

    public async getConnectionStats(): Promise<ConnectionStats> {
        const baseStats = this.healthService.getConnectionStats();
        const totalSubs = Array.from(this.eventSubscriptions.values())
            .reduce((total, subscribers) => total + subscribers.size, 0);

        // Fetch active bulk operation count from Redis
        let activeBulkOpCount = 0;
        if (this.redis) {
            try {
                activeBulkOpCount = await this.redis.sCard('active_bulk_ops');
            } catch (error) {
                logger.error('Error fetching bulk op count:', error);
            }
        }

        return {
            totalConnections: baseStats.totalConnections,
            byType: baseStats.byType,
            byEvent: baseStats.byEvent,
            totalSubscriptions: totalSubs,
            activeEvents: this.eventSubscriptions.size,
            averageSubscriptionsPerClient: baseStats.totalConnections > 0
                ? totalSubs / baseStats.totalConnections
                : 0,
            activeBulkOperations: activeBulkOpCount
        };
    }

    public getConnectionHealth(): ConnectionHealth[] {
        return this.healthService.getConnectionHealth();
    }

    public getEventConnections(eventId: string): Array<{ socketId: string; user: any; health: any }> {
        return this.healthService.getEventConnections(eventId);
    }

    public getEventSubscriptions(eventId: string): string[] {
        return Array.from(this.eventSubscriptions.get(eventId) || []);
    }

    public getClientSubscriptions(socketId: string): string[] {
        return Array.from(this.clientSubscriptions.get(socketId) || []);
    }

    // NEW: Get active bulk operations
    public async getActiveBulkOperations(): Promise<Array<BulkOperationState>> {
        if (!this.redis) return [];

        try {
            const activeOps = await this.redis.sMembers('active_bulk_ops');
            const operations: BulkOperationState[] = [];

            for (const opId of activeOps) {
                const opData = await this.redis.get(`bulk_op:${opId}`);
                if (opData) {
                    const op = JSON.parse(opData as string);
                    operations.push({
                        ...op,
                        duration: Date.now() - op.startTime
                    });
                }
            }
            return operations;
        } catch (error) {
            logger.error('Error fetching active bulk ops:', error);
            return [];
        }
    }

    public async startBulkOperation(op: BulkOperationState): Promise<void> {
        if (!this.redis) return;
        try {
            const opKey = `bulk_op:${op.operationId}`;
            await this.redis.setEx(opKey, this.BULK_OP_TTL, JSON.stringify(op));
            await this.redis.sAdd('active_bulk_ops', op.operationId);
        } catch (error) {
            logger.error('Error starting bulk op:', error);
        }
    }

    public async completeBulkOperation(operationId: string, result: any): Promise<void> {
        if (!this.redis) return;
        try {
            const opKey = `bulk_op:${operationId}`;
            const opData = await this.redis.get(opKey);
            if (opData) {
                const op = JSON.parse(opData as string);
                op.status = 'completed';
                op.progress.completed = op.progress.total;
                op.result = result;
                await this.redis.setEx(opKey, this.BULK_OP_TTL, JSON.stringify(op));
            }
            await this.redis.sRem('active_bulk_ops', operationId);
        } catch (error) {
            logger.error('Error completing bulk op:', error);
        }
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
        this.eventSubscriptions.clear();
        this.clientSubscriptions.clear();
        // this.activeBulkOperations.clear(); // Redis handles its own state
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

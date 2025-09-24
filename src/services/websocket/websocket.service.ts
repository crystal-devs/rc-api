// services/websocket/websocket.service.ts - Enhanced with Bulk Operations
// ====================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { websocketAuthMiddleware, websocketRateLimit, websocketLogger } from '@middlewares/websocket-auth.middleware';

// Import our management services
import { authenticateConnection, handleSubscription, handleUnsubscription } from './management/websocket-auth.service';
import { WebSocketHealthService } from './management/websocket-health.service';

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

    // New: Track active bulk operations for rate limiting and monitoring
    private activeBulkOperations: Map<string, {
        operationType: string;
        startTime: Date;
        totalItems: number;
        userId: string;
    }> = new Map();

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
        logger.info('🔌 Enhanced WebSocket service initialized with subscription management and bulk operations');
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
            socket.on('bulk_operation_status', (data: { operationId: string }) => {
                const operation = this.activeBulkOperations.get(data.operationId);
                if (operation) {
                    socket.emit('bulk_operation_info', {
                        operationId: data.operationId,
                        ...operation,
                        duration: Date.now() - operation.startTime.getTime()
                    });
                } else {
                    socket.emit('bulk_operation_not_found', { operationId: data.operationId });
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

    // EXISTING: Single status update method (unchanged)
    public emitStatusUpdate(payload: StatusUpdatePayload): void {
        const adminRoom = `admin_${payload.eventId}`;
        const guestRoom = `guest_${payload.eventId}`;

        logger.info(`📤 Emitting status update: ${payload.mediaId.substring(0, 8)}... (${payload.previousStatus} → ${payload.newStatus})`);

        // Send to admin room
        this.io.to(adminRoom).emit('media_status_updated', payload);

        // ALWAYS send media_status_updated to guest room for any status change
        this.io.to(guestRoom).emit('media_status_updated', payload);

        // Additional specific events for guests (optional, for specialized handling)
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
    }

    // NEW: Bulk status update methods
    public async emitBulkStatusUpdate(payload: BulkStatusUpdatePayload): Promise<void> {
        try {
            const eventId = payload.eventId;
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;

            // Create operation ID for tracking
            const operationId = `bulk_${eventId}_${Date.now()}`;

            // Track the operation
            this.activeBulkOperations.set(operationId, {
                operationType: 'status_update',
                startTime: payload.operation.timestamp,
                totalItems: payload.operation.mediaIds.length,
                userId: payload.operation.updatedBy.id
            });

            const emitPayload = {
                ...payload,
                operationId,
                timestamp: payload.operation.timestamp.toISOString()
            };

            // Emit to admin room with full details
            this.io.to(adminRoom).emit('bulk_media_status_update', {
                ...emitPayload,
                details: {
                    reason: payload.operation.reason,
                    hideReason: payload.operation.hideReason
                }
            });

            // Emit to guest room (filtered for guest-relevant updates)
            if (['approved', 'auto_approved'].includes(payload.operation.newStatus)) {
                // Guests see approved content
                this.io.to(guestRoom).emit('bulk_media_approved', {
                    eventId,
                    operationId,
                    mediaIds: payload.operation.mediaIds,
                    newStatus: payload.operation.newStatus,
                    summary: payload.operation.summary,
                    timestamp: payload.operation.timestamp.toISOString()
                });
            } else if (['rejected', 'hidden', 'pending'].includes(payload.operation.newStatus)) {
                // Guests see content removal
                this.io.to(guestRoom).emit('bulk_media_removed', {
                    eventId,
                    operationId,
                    mediaIds: payload.operation.mediaIds,
                    reason: `Status changed to ${payload.operation.newStatus}`,
                    summary: payload.operation.summary,
                    timestamp: payload.operation.timestamp.toISOString()
                });
            }

            logger.info(`✅ Bulk status update emitted for event ${eventId}:`, {
                operationId,
                mediaCount: payload.operation.mediaIds.length,
                status: payload.operation.newStatus,
                modifiedCount: payload.operation.summary.totalModified
            });

            // Clean up operation tracking after 5 minutes
            setTimeout(() => {
                this.activeBulkOperations.delete(operationId);
            }, 5 * 60 * 1000);

        } catch (error: any) {
            logger.error('❌ Failed to emit bulk status update:', {
                error: error.message,
                eventId: payload.eventId,
                mediaCount: payload.operation.mediaIds.length
            });
            throw error;
        }
    }

    public async emitBulkStatusBatch(payload: BulkStatusBatchPayload): Promise<void> {
        try {
            const eventId = payload.eventId;
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;

            const batchPayload = {
                ...payload,
                timestamp: payload.timestamp.toISOString(),
                progress: {
                    current: payload.batchIndex + 1,
                    total: payload.totalBatches,
                    percentage: Math.round(((payload.batchIndex + 1) / payload.totalBatches) * 100)
                }
            };

            // Emit to admin room
            this.io.to(adminRoom).emit('bulk_status_batch', batchPayload);

            // Emit to guest room only for relevant status changes
            if (['approved', 'auto_approved'].includes(payload.newStatus)) {
                this.io.to(guestRoom).emit('bulk_batch_approved', {
                    eventId,
                    mediaIds: payload.mediaIds,
                    batchIndex: payload.batchIndex,
                    totalBatches: payload.totalBatches,
                    progress: batchPayload.progress,
                    timestamp: batchPayload.timestamp
                });
            }

            logger.debug(`✅ Bulk status batch emitted: ${payload.batchIndex + 1}/${payload.totalBatches}`, {
                eventId,
                mediaCount: payload.mediaIds.length,
                status: payload.newStatus
            });

        } catch (error: any) {
            logger.error('❌ Failed to emit bulk status batch:', {
                error: error.message,
                eventId: payload.eventId,
                batchIndex: payload.batchIndex
            });
            throw error;
        }
    }

    public async emitBulkIndividualUpdates(updates: IndividualStatusUpdate[]): Promise<void> {
        try {
            if (updates.length === 0) return;

            const eventId = updates[0].eventId;
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;

            // Group updates by chunks to avoid overwhelming the network
            const chunkSize = 5;
            const chunks = [];

            for (let i = 0; i < updates.length; i += chunkSize) {
                chunks.push(updates.slice(i, i + chunkSize));
            }

            // Emit chunks with small delays
            for (let index = 0; index < chunks.length; index++) {
                const chunk = chunks[index];
                const adminChunkPayload = {
                    type: 'bulk_individual_updates',
                    eventId,
                    updates: chunk.map((update:any) => ({
                        ...update,
                        timestamp: update.timestamp.toISOString()
                    })),
                    chunkInfo: {
                        index,
                        total: chunks.length,
                        isLast: index === chunks.length - 1
                    }
                };

                // Send full updates to admin room
                this.io.to(adminRoom).emit('bulk_individual_updates', adminChunkPayload);

                // Send filtered updates to guest room
                const guestUpdates = chunk.filter((update: any) =>
                    ['approved', 'auto_approved'].includes(update.newStatus) ||
                    (['approved', 'auto_approved'].includes(update.previousStatus) &&
                        !['approved', 'auto_approved'].includes(update.newStatus))
                );

                if (guestUpdates.length > 0) {
                    this.io.to(guestRoom).emit('bulk_individual_updates', {
                        ...adminChunkPayload,
                        updates: guestUpdates.map((update: any) => ({
                            ...update,
                            timestamp: update.timestamp.toISOString()
                        }))
                    });
                }

                // Small delay between chunks for large operations
                if (index < chunks.length - 1 && updates.length > 20) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }

            logger.debug(`✅ Bulk individual updates emitted: ${updates.length} updates in ${chunks.length} chunks`, {
                eventId
            });

        } catch (error: any) {
            logger.error('❌ Failed to emit bulk individual updates:', {
                error: error.message,
                updateCount: updates.length
            });
            throw error;
        }
    }

    public async emitBulkProgress(payload: BulkProgressPayload): Promise<void> {
        try {
            const eventId = payload.eventId;
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;

            const progressPayload = {
                type: 'bulk_progress',
                ...payload,
                timestamp: payload.timestamp.toISOString()
            };

            // Emit to admin room
            this.io.to(adminRoom).emit('bulk_operation_progress', progressPayload);

            // Emit simplified progress to guest room
            this.io.to(guestRoom).emit('bulk_operation_progress', {
                type: 'bulk_progress',
                eventId,
                operationType: payload.operationType,
                progress: {
                    percentage: payload.progress.percentage,
                    completed: payload.progress.completed,
                    total: payload.progress.total
                },
                status: payload.status,
                timestamp: progressPayload.timestamp
            });

            // Log only significant progress milestones to avoid spam
            const { percentage } = payload.progress;
            if (percentage % 25 === 0 || payload.status !== 'in_progress') {
                logger.info(`📊 Bulk operation progress: ${eventId} - ${payload.operationType}`, {
                    progress: `${payload.progress.completed}/${payload.progress.total} (${percentage}%)`,
                    status: payload.status,
                    errors: payload.progress.errors
                });
            }

        } catch (error: any) {
            logger.error('❌ Failed to emit bulk progress:', {
                error: error.message,
                eventId: payload.eventId,
                operation: payload.operationType
            });
            throw error;
        }
    }

    public async emitBulkOperationComplete(payload: {
        eventId: string;
        operationType: 'status_update' | 'delete' | 'move';
        summary: {
            requested: number;
            completed: number;
            failed: number;
            skipped: number;
            duration: number; // in milliseconds
        };
        newStatus?: string;
        updatedBy: {
            id: string;
            name: string;
            type: string;
        };
        timestamp: Date;
    }): Promise<void> {
        try {
            const eventId = payload.eventId;
            const adminRoom = `admin_${eventId}`;
            const guestRoom = `guest_${eventId}`;

            const completionPayload = {
                type: 'bulk_operation_complete',
                ...payload,
                timestamp: payload.timestamp.toISOString(),
                success: payload.summary.completed > 0,
                successRate: payload.summary.requested > 0
                    ? Math.round((payload.summary.completed / payload.summary.requested) * 100)
                    : 0
            };

            // Emit to admin room
            this.io.to(adminRoom).emit('bulk_operation_complete', completionPayload);

            // Emit to guest room (simplified)
            this.io.to(guestRoom).emit('bulk_operation_complete', {
                type: 'bulk_operation_complete',
                eventId,
                operationType: payload.operationType,
                summary: {
                    completed: payload.summary.completed,
                    total: payload.summary.requested
                },
                success: completionPayload.success,
                timestamp: completionPayload.timestamp
            });

            logger.info(`🏁 Bulk operation completed: ${eventId} - ${payload.operationType}`, {
                summary: payload.summary,
                duration: `${payload.summary.duration}ms`,
                successRate: completionPayload.successRate + '%'
            });

        } catch (error: any) {
            logger.error('❌ Failed to emit bulk operation complete:', {
                error: error.message,
                eventId: payload.eventId,
                operation: payload.operationType
            });
            throw error;
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

        // Send to guest room (they see guest count)
        this.io.to(guestRoom).emit('room_user_counts', {
            eventId,
            guestCount,
            total: guestCount
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

    public getConnectionStats(): ConnectionStats {
        const baseStats = this.healthService.getConnectionStats();
        const totalSubs = Array.from(this.eventSubscriptions.values())
            .reduce((total, subscribers) => total + subscribers.size, 0);

        return {
            totalConnections: baseStats.totalConnections,
            byType: baseStats.byType,
            byEvent: baseStats.byEvent,
            totalSubscriptions: totalSubs,
            activeEvents: this.eventSubscriptions.size,
            averageSubscriptionsPerClient: baseStats.totalConnections > 0
                ? totalSubs / baseStats.totalConnections
                : 0,
            activeBulkOperations: this.activeBulkOperations.size // NEW
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
    public getActiveBulkOperations(): Array<{
        operationId: string;
        operationType: string;
        startTime: Date;
        totalItems: number;
        userId: string;
        duration: number;
    }> {
        const operations: any[] = [];
        this.activeBulkOperations.forEach((operation, operationId) => {
            operations.push({
                operationId,
                ...operation,
                duration: Date.now() - operation.startTime.getTime()
            });
        });
        return operations;
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
        this.activeBulkOperations.clear(); // NEW
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
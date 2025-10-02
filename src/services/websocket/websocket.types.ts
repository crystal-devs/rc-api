// services/websocket/websocket.types.ts - Complete Type Definitions
// ====================================

import { Socket } from "socket.io";

export interface WebSocketUser {
    id: string;
    name: string;
    type: 'admin' | 'co_host' | 'guest';
    eventId: string;
    shareToken?: string;
}

export interface AuthData {
    token?: string;
    shareToken?: string;
    eventId: string;
    userType?: 'admin' | 'guest';
    guestName?: string;
}

export interface SubscriptionData {
    eventId: string;
    shareToken?: string;
}

export interface StatusUpdatePayload {
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

// NEW: Bulk operation types
export interface BulkStatusUpdatePayload {
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

export interface BulkStatusBatchPayload {
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

export interface BulkProgressPayload {
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

export interface IndividualStatusUpdate {
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

export interface BulkOperationSummary {
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
}

export interface ActiveBulkOperation {
    operationId: string;
    operationType: string;
    startTime: Date;
    totalItems: number;
    userId: string;
    duration: number;
}

// UPDATED: Extended ConnectionStats to include subscription metrics and bulk operations
export interface ConnectionStats {
    totalConnections: number;
    byType: {
        admin: number;
        co_host: number;
        guest: number;
    };
    byEvent: Record<string, number>;
    totalSubscriptions: number;
    activeEvents: number;
    averageSubscriptionsPerClient: number;
    activeBulkOperations?: number; // NEW
}

export interface ClientConnectionState {
    user: WebSocketUser;
    rooms: string[];
    connectedAt: Date;
    lastHeartbeat: Date;
    isHealthy: boolean;
    reconnectCount: number;
}

export interface ConnectionHealth {
    socketId: string;
    isConnected: boolean;
    isHealthy: boolean;
    lastHeartbeat: Date;
    latency: number;
    reconnectCount: number;
}

export interface RoomUserCounts {
    eventId: string;
    adminCount: number;
    guestCount: number;
    total: number;
}

// Subscription management events
export interface SubscriptionEvents {
    subscribe_to_event: (data: SubscriptionData) => void;
    unsubscribe_from_event: (data: SubscriptionData) => void;
    subscription_success: (data: { eventId: string; room?: string; userType?: string }) => void;
    subscription_error: (data: { eventId: string; message: string }) => void;
    unsubscription_success: (data: { eventId: string }) => void;
}

// Enhanced authentication events
export interface AuthenticationEvents {
    authenticate: (data: AuthData) => void;
    auth_success: (data: {
        success: boolean;
        user: {
            id: string;
            name: string;
            type: string;
        };
        eventId: string;
        connectionSettings: {
            heartbeatInterval: number;
            heartbeatTimeout: number;
        };
    }) => void;
    auth_error: (data: { message: string }) => void;
}

// Health and monitoring events
export interface HealthEvents {
    heartbeat: (data: { timestamp: number }) => void;
    heartbeat_ack: (data: { timestamp: number; latency: number }) => void;
    ping: () => void;
    pong: (data: { timestamp: number }) => void;
    connection_check: () => void;
    connection_status: (data: {
        isHealthy: boolean;
        lastHeartbeat: Date;
        connectedAt: Date;
        reconnectCount: number;
        subscriptions: string[];
    }) => void;
}

// Media status events
export interface MediaEvents {
    media_status_updated: (payload: StatusUpdatePayload) => void;
    media_approved: (data: {
        mediaId: string;
        eventId: string;
        mediaData?: any;
        timestamp: Date;
    }) => void;
    media_removed: (data: {
        mediaId: string;
        eventId: string;
        reason: string;
        timestamp: Date;
    }) => void;
}

// NEW: Bulk operation events
export interface BulkOperationEvents {
    // Server to client events
    bulk_media_status_update: (payload: BulkStatusUpdatePayload & { 
        operationId: string; 
        timestamp: string;
        details?: {
            reason?: string;
            hideReason?: string;
        };
    }) => void;
    
    bulk_media_approved: (payload: {
        eventId: string;
        operationId: string;
        mediaIds: string[];
        newStatus: string;
        summary: BulkStatusUpdatePayload['operation']['summary'];
        timestamp: string;
    }) => void;
    
    bulk_media_removed: (payload: {
        eventId: string;
        operationId: string;
        mediaIds: string[];
        reason: string;
        summary: BulkStatusUpdatePayload['operation']['summary'];
        timestamp: string;
    }) => void;
    
    bulk_status_batch: (payload: BulkStatusBatchPayload & { 
        timestamp: string; 
        progress: { current: number; total: number; percentage: number };
    }) => void;
    
    bulk_batch_approved: (payload: {
        eventId: string;
        mediaIds: string[];
        batchIndex: number;
        totalBatches: number;
        progress: { current: number; total: number; percentage: number };
        timestamp: string;
    }) => void;
    
    bulk_individual_updates: (payload: {
        type: 'bulk_individual_updates';
        eventId: string;
        updates: (IndividualStatusUpdate & { timestamp: string })[];
        chunkInfo: {
            index: number;
            total: number;
            isLast: boolean;
        };
    }) => void;
    
    bulk_operation_progress: (payload: BulkProgressPayload & { 
        type: 'bulk_progress'; 
        timestamp: string;
    }) => void;
    
    bulk_operation_complete: (payload: BulkOperationSummary & { 
        type: 'bulk_operation_complete'; 
        timestamp: string; 
        success: boolean; 
        successRate: number;
    }) => void;
    
    bulk_operation_info: (payload: ActiveBulkOperation) => void;
    bulk_operation_not_found: (payload: { operationId: string }) => void;
    
    // Admin-specific bulk events
    bulk_admin_update: (payload: BulkStatusUpdatePayload & { 
        operationId: string; 
        timestamp: string;
        details: {
            reason?: string;
            hideReason?: string;
        };
    }) => void;
    
    bulk_admin_batch: (payload: BulkStatusBatchPayload & { 
        timestamp: string; 
        progress: { current: number; total: number; percentage: number };
    }) => void;
    
    bulk_admin_progress: (payload: BulkProgressPayload & { 
        type: 'bulk_progress'; 
        timestamp: string;
    }) => void;
    
    bulk_admin_complete: (payload: BulkOperationSummary & { 
        type: 'bulk_operation_complete'; 
        timestamp: string; 
        success: boolean; 
        successRate: number;
    }) => void;
    
    // Client to server events
    bulk_operation_status: (data: { operationId: string }) => void;
}

// Room/subscription count events
export interface CountEvents {
    room_user_counts: (data: RoomUserCounts) => void;
    subscription_counts: (data: RoomUserCounts) => void; // Alias for backward compatibility
}

// Legacy events for backward compatibility
export interface LegacyEvents {
    join_event: (eventId: string) => void;
    leave_event: (eventId: string) => void;
    joined_event: (data: {
        eventId: string;
        room: string;
        userType: string;
    }) => void;
    join_error: (data: { message: string }) => void;
}

// Server management events
export interface ServerEvents {
    server_shutdown: (data: {
        message: string;
        timestamp: Date;
    }) => void;
}

// Complete event interface combining all event types
export interface WebSocketEvents extends
    SubscriptionEvents,
    AuthenticationEvents,
    HealthEvents,
    MediaEvents,
    BulkOperationEvents, // NEW
    CountEvents,
    LegacyEvents,
    ServerEvents { }

// Event subscription validation interface
export interface EventAccessValidation {
    hasAccess: boolean;
    userRole: 'admin' | 'co_host' | 'guest' | 'photowall';
    permissions: {
        canView: boolean;
        canUpload: boolean;
        canApprove: boolean;
        canManage: boolean;
    };
    reason?: string; // If access denied
}

// Subscription metrics for monitoring
export interface SubscriptionMetrics {
    eventId: string;
    totalSubscribers: number;
    adminSubscribers: number;
    guestSubscribers: number;
    activeConnections: number;
    averageLatency: number;
    lastActivity: Date;
}

// Authenticated socket interface for type safety
export interface AuthenticatedSocket extends Socket {
    data: {
        authenticated: true;
        user: WebSocketUser;
        connectionInitializedAt: Date;
    };
}

// Export utility type for socket handlers
export type SocketHandler<T = any> = (socket: Socket, data: T) => Promise<void> | void;

// NEW: Client-side emit events (for complete type safety)
export interface ClientEmitEvents {
    // Authentication
    authenticate: (data: AuthData) => void;
    
    // Subscription management
    subscribe_to_event: (data: SubscriptionData) => void;
    unsubscribe_from_event: (data: SubscriptionData) => void;
    
    // Legacy compatibility
    join_event: (eventId: string) => void;
    leave_event: (eventId: string) => void;
    
    // Health monitoring
    heartbeat: (data: { timestamp: number }) => void;
    ping: () => void;
    connection_check: () => void;
    
    // NEW: Bulk operation queries
    bulk_operation_status: (data: { operationId: string }) => void;
}

// NEW: Helper types for Socket.IO with proper typing
export interface TypedServer {
    emit<K extends keyof WebSocketEvents>(
        event: K,
        ...args: Parameters<WebSocketEvents[K]>
    ): boolean;
    
    to(room: string): {
        emit<K extends keyof WebSocketEvents>(
            event: K,
            ...args: Parameters<WebSocketEvents[K]>
        ): boolean;
    };
}

export interface TypedSocket {
    emit<K extends keyof ClientEmitEvents>(
        event: K,
        ...args: Parameters<ClientEmitEvents[K]>
    ): this;
    
    on<K extends keyof WebSocketEvents>(
        event: K,
        listener: WebSocketEvents[K]
    ): this;
    
    off<K extends keyof WebSocketEvents>(
        event: K,
        listener?: WebSocketEvents[K]
    ): this;
}

// NEW: Configuration constants for bulk operations
export const BULK_OPERATION_CONFIG = {
    MAX_BATCH_SIZE: 100,
    SMALL_BATCH_SIZE: 10,
    CHUNK_SIZE: 5,
    LARGE_OPERATION_THRESHOLD: 20,
    VERY_LARGE_OPERATION_THRESHOLD: 50,
    BATCH_DELAY_MS: 10,
    CHUNK_DELAY_MS: 5,
    OPERATION_CLEANUP_DELAY_MS: 5 * 60 * 1000, // 5 minutes
    PROGRESS_LOG_INTERVAL: 25 // Log every 25% progress
} as const;

// NEW: Type guards for runtime type checking
export const isAuthenticatedSocket = (socket: Socket): socket is AuthenticatedSocket => {
    return socket.data?.authenticated === true && !!socket.data?.user;
};

export const isBulkStatusUpdate = (payload: any): payload is BulkStatusUpdatePayload => {
    return payload?.type === 'bulk_status_update' && 
           payload?.eventId && 
           payload?.operation?.mediaIds && 
           Array.isArray(payload.operation.mediaIds);
};

export const isBulkProgressPayload = (payload: any): payload is BulkProgressPayload => {
    return payload?.eventId && 
           payload?.operationType && 
           payload?.progress && 
           typeof payload.progress.percentage === 'number';
};
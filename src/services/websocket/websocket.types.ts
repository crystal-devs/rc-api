// services/websocket/websocket.types.ts - Fixed Type Conflicts
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

// NEW: Missing SubscriptionData interface
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

// UPDATED: Extended ConnectionStats to include subscription metrics
export interface ConnectionStats {
    totalConnections: number;
    byType: {
        admin: number;
        co_host: number;
        guest: number;
    };
    byEvent: Record<string, number>;
    // NEW: Added subscription-related stats
    totalSubscriptions: number;
    activeEvents: number;
    averageSubscriptionsPerClient: number;
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
    CountEvents,
    LegacyEvents,
    ServerEvents {}

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
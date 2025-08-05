// types/websocket.types.ts - Compatible version with your current implementation
import { Types } from 'mongoose';
import { Socket } from 'socket.io';

// ==========================================
// CONNECTION & AUTHENTICATION TYPES
// ==========================================

export interface SocketAuthData {
    token?: string;
    shareToken?: string;
    eventId: string;
    userType?: 'admin' | 'moderator' | 'guest';
    guestInfo?: {
        name?: string;
        guestName?: string;
        timestamp?: string;
        userAgent?: string;
        ip?: string;
        socketId?: string;
        [key: string]: any;
    };
}

export interface WebSocketUser {
    id: string;
    type: 'admin' | 'co_host' | 'moderator' | 'logged_user' | 'guest';
    eventId: string;
    
    // For authenticated users
    userId?: string;
    name?: string;
    email?: string;
    
    // For guests
    shareToken?: string;
    guestId?: string;
    guestName?: string;
    
    // Optional metadata (commented out to match your current implementation)
    // metadata?: {
    //     connectedAt?: Date;
    //     userAgent?: string;
    //     validationMethod?: string;
    //     shareTokenUsed?: string;
    //     ip?: string;
    //     socketId?: string;
    //     [key: string]: any;
    // };
}

// ==========================================
// ROOM TYPES
// ==========================================

export interface EventRoom {
    eventRoom: string; // event_123 (everyone in this event)
}

export type RoomType = 'event';

// ==========================================
// EVENT PAYLOAD TYPES
// ==========================================

// Media Status Events
export interface MediaStatusUpdatePayload {
    mediaId: string;
    eventId: string;
    previousStatus: string;
    newStatus: string;
    updatedBy: {
        id: string;
        name: string;
        type: 'admin' | 'co_host' | 'moderator' | 'logged_user';
    };
    updatedAt: Date;
    media?: {
        url: string;
        thumbnailUrl?: string;
        filename: string;
        type: 'image' | 'video';
        size?: number;
    };
    reason?: string;
    // Guest visibility tracking (optional)
    guestVisibility?: {
        wasVisible: boolean;
        isVisible: boolean;
        changed: boolean;
    };
    timestamp?: Date;
}

// New Media Upload Events
export interface NewMediaUploadPayload {
    mediaId: string;
    eventId: string;
    albumId?: string;
    uploadedBy: {
        id: string;
        name: string;
        type: 'admin' | 'co_host' | 'moderator' | 'logged_user' | 'guest';
        email?: string;
    };
    media: {
        url: string;
        thumbnailUrl?: string;
        filename: string;
        originalFilename?: string;
        type: 'image' | 'video';
        size: number;
        format?: string;
    };
    status: 'pending' | 'approved' | 'auto_approved' | 'rejected';
    uploadedAt: Date;
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    timestamp?: Date;
}

// Media Processing Events
export interface MediaProcessingPayload {
    mediaId: string;
    eventId: string;
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number; // 0-100
    stage?: 'upload' | 'validation' | 'thumbnail' | 'variants' | 'completed';
    variantsGenerated?: boolean;
    variants?: {
        thumbnail?: string;
        display?: string;
        full?: string;
    };
    error?: {
        code: string;
        message: string;
        details?: any;
    };
    timestamp?: Date;
}

// Bulk Operations
export interface BulkMediaUpdatePayload {
    eventId: string;
    mediaIds: string[];
    action: 'approve' | 'reject' | 'delete' | 'hide';
    updatedBy: {
        id: string;
        name: string;
        type: 'admin' | 'co_host' | 'moderator';
        email?: string;
    };
    count: number;
    affectedMediaIds: string[];
    guestVisibleCount?: number; // How many became visible to guests
    reason?: string;
    updatedAt: Date;
    timestamp?: Date;
}

// Event Statistics
export interface EventStatsPayload {
    eventId: string;
    stats: {
        totalMedia: number;
        pendingApproval: number;
        approved: number;
        autoApproved?: number;
        rejected: number;
        hidden?: number;
        deleted?: number;
        totalUploaders: number;
        activeGuests: number;
        activeAdmins?: number;
        totalConnections?: number;
    };
    breakdown?: {
        mediaByType?: { [key: string]: number };
        mediaByStatus?: { [key: string]: number };
        uploadersByType?: { [key: string]: number };
    };
    updatedAt: Date;
    timestamp?: Date;
}

// ==========================================
// WEBSOCKET EVENT NAMES
// ==========================================

export const WEBSOCKET_EVENTS = {
    // Connection events
    CONNECTION: 'connection',
    DISCONNECT: 'disconnect',
    JOIN_EVENT: 'join_event',
    LEAVE_EVENT: 'leave_event',
    
    // Authentication events
    AUTHENTICATE: 'authenticate',
    AUTH_SUCCESS: 'auth_success',
    AUTH_ERROR: 'auth_error',
    
    // Media status events
    MEDIA_STATUS_UPDATED: 'media_status_updated',
    MEDIA_APPROVED: 'media_approved',
    MEDIA_REJECTED: 'media_rejected',
    MEDIA_HIDDEN: 'media_hidden',
    
    // Media upload events
    NEW_MEDIA_UPLOADED: 'new_media_uploaded',
    MEDIA_PROCESSING_UPDATE: 'media_processing_update',
    MEDIA_PROCESSING_COMPLETE: 'media_processing_complete',
    MEDIA_UPLOAD_FAILED: 'media_upload_failed',
    
    // Bulk operations
    BULK_MEDIA_UPDATE: 'bulk_media_update',
    
    // Event updates
    EVENT_STATS_UPDATE: 'event_stats_update',
    
    // User connection events
    GUEST_JOINED: 'guest_joined',
    GUEST_LEFT: 'guest_left',
    USER_JOINED: 'user_joined',
    USER_LEFT: 'user_left',
    
    // Admin-specific events
    ADMIN_NEW_UPLOAD_NOTIFICATION: 'admin_new_upload_notification',
    ADMIN_GUEST_ACTIVITY: 'admin_guest_activity',
    
    // Guest-specific events
    GUEST_MEDIA_APPROVED: 'guest_media_approved',
    GUEST_MEDIA_REMOVED: 'guest_media_removed',
    GUEST_EVENT_UPDATE: 'guest_event_update',
    GUEST_ACTIVITY: 'guest_activity',
    
    // System events
    HEARTBEAT: 'heartbeat',
    HEARTBEAT_RESPONSE: 'heartbeat_response',
    
    // Error events
    ERROR: 'error',
    RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
    CONNECTION_TIMEOUT: 'connection_timeout'
} as const;

export type WebSocketEventName = typeof WEBSOCKET_EVENTS[keyof typeof WEBSOCKET_EVENTS];

// ==========================================
// WEBSOCKET RESPONSE TYPES
// ==========================================

export interface WebSocketResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: any;
    };
    timestamp: Date;
}

export interface WebSocketError {
    code: 'AUTH_FAILED' | 'INVALID_EVENT' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 
          'SERVER_ERROR' | 'CONNECTION_TIMEOUT' | 'INVALID_TOKEN' | 'EVENT_ENDED' |
          'SHARE_EXPIRED';
    message: string;
    details?: any;
    eventId?: string;
    userId?: string;
    timestamp?: Date;
}

// ==========================================
// CONNECTION STATE TYPES - FIXED
// ==========================================

export interface ConnectedClient {
    socketId: string;
    user: WebSocketUser;
    connectedAt: Date;
    lastActivity: Date;
    rooms: string[];
    connectionMetadata?: {
        userAgent?: string;
        ip?: string;
        reconnectionCount?: number;
        lastReconnection?: Date;
    };
}

// FIXED: Added missing properties
export interface EventConnectionStats {
    eventId: string;
    totalConnections: number;
    adminConnections: number;
    guestConnections: number;
    moderatorConnections: number; // Added this
    loggedUserConnections: number; // Added this
    activeRooms: string[];
    lastActivity: Date;
    peakConnections?: number;
    connectionHistory?: {
        timestamp: Date;
        count: number;
    }[];
}

export interface GlobalConnectionStats {
    totalConnections: number;
    servers: number;
    serverStats: { [serverId: string]: number };
    eventBreakdown?: { [eventId: string]: EventConnectionStats };
    timestamp: Date;
}

// ==========================================
// MIDDLEWARE TYPES
// ==========================================

export interface AuthenticatedSocket extends Socket {
    user: WebSocketUser;
    eventId: string;
    authenticated: boolean;
    connectionStartTime?: Date;
    lastActivity?: Date;
    metadata?: {
        userAgent?: string;
        ip?: string;
        reconnectionCount?: number;
    };
}

// ==========================================
// SERVICE METHOD TYPES
// ==========================================

export interface WebSocketServiceMethods {
    // Connection management
    handleConnection(socket: Socket): Promise<void>;
    handleDisconnection(socket: AuthenticatedSocket): Promise<void>;
    
    // Authentication
    authenticateConnection(socket: Socket, authData: SocketAuthData): Promise<WebSocketUser>;
    authenticateWithJWT(token: string, event: any, eventId: string): Promise<WebSocketUser>;
    authenticateWithShareToken(shareToken: string, event: any, eventId: string, guestInfo?: any): Promise<WebSocketUser>;
    
    // Room management
    joinEventRoom(socket: AuthenticatedSocket, eventId: string): Promise<void>;
    leaveEventRoom(socket: AuthenticatedSocket, eventId: string): Promise<void>;
    getEventRoom(eventId: string): string;
    
    // Event emission methods
    emitToEvent(eventId: string, event: WebSocketEventName, payload: any): Promise<void>;
    
    // Media events
    emitMediaStatusUpdate(payload: MediaStatusUpdatePayload & { guestVisibility?: any }): Promise<void>;
    emitNewMediaUpload(payload: NewMediaUploadPayload): void;
    emitMediaProcessingUpdate(payload: MediaProcessingPayload): void;
    emitBulkMediaUpdate?(payload: BulkMediaUpdatePayload): Promise<void>;
    
    // Activity tracking
    emitGuestActivity(payload: {
        shareToken: string;
        eventId: string;
        activity: string;
        photoCount?: number;
        page?: number;
        guestInfo?: any;
    }): void;
    
    // Statistics and monitoring
    getConnectionStats(eventId?: string): EventConnectionStats | EventConnectionStats[];
    getGlobalConnectionStats(): Promise<GlobalConnectionStats>;
    getTotalConnections(): number;
    
    // Utility methods
    disconnectEventClients(eventId: string, reason?: string): void;
    testConnection?(eventId: string): Promise<{ eventRoom: string; connectedClients: number; clientTypes: { [key: string]: number } }>;
    cleanup(): Promise<void>;
}

// ==========================================
// CONFIGURATION TYPES
// ==========================================

export interface WebSocketConfig {
    cors: {
        origin: string | string[];
        methods: string[];
        credentials: boolean;
    };
    connectionTimeout?: number;
    heartbeatInterval?: number;
    maxConnections?: number;
    rateLimiting?: {
        windowMs: number;
        maxRequests: number;
    };
    connectionStateRecovery?: {
        maxDisconnectionDuration: number;
        skipMiddlewares: boolean;
    };
    logging?: {
        level?: 'debug' | 'info' | 'warn' | 'error';
        logConnections?: boolean;
        logAuthentication?: boolean;
    };
}

// Re-export Socket type
export { Socket } from 'socket.io';
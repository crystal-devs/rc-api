import { Socket } from 'socket.io';

// ==========================================
// CONNECTION & AUTHENTICATION TYPES
// ==========================================

export interface SocketAuthData {
    token?: string;
    shareToken?: string;
    eventId?: string;
    userType?: 'admin' | 'moderator' | 'guest' | 'logged_user' | 'co_host';
}

export interface WebSocketUser {
    id: string;
    type: 'admin' | 'moderator' | 'guest' | 'logged_user' | 'co_host';
    eventId: string;
    userId?: string;
    name?: string;
    email?: string;
    shareToken?: string;
    guestId?: string;
    guestName?: string;
    coHostPermissions?: any;
    guestMetadata?: {
        connectedAt: Date;
        userAgent: string;
        ip?: string;
        validationMethod: string;
        shareTokenUsed: string;
        sessionInfo: {
            connectionAttempts: number;
            lastActivity: Date;
        };
    };
}

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
    guestVisibility?: {
        wasVisible: boolean;
        isVisible: boolean;
        changed: boolean;
        changeType?: 'show' | 'hide' | 'none';
    };
    adminMetadata?: { [key: string]: any }; // Added to match implementation
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

// Media Processing Events (kept but not used in current implementation)
export interface MediaProcessingPayload {
    mediaId: string;
    eventId: string;
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
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

// Bulk Operations (kept but not used in current implementation)
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
    guestVisibleCount?: number;
    reason?: string;
    updatedAt: Date;
    timestamp?: Date;
}

// Event Statistics (kept but not used in current implementation)
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
    BULK_UPLOAD_STARTED: 'bulk_upload_started',
    ADMIN_BULK_UPLOAD_NOTIFICATION: 'admin_bulk_upload_notification',

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
// CONNECTION STATE TYPES
// ==========================================

export interface ConnectedClient {
    socketId: string;
    user: WebSocketUser;
    connectedAt: Date;
    lastActivity: Date;
    rooms: string[];
    clientInfo: {
        ip: string;
        userAgent: string;
        authMethod: string;
    };
}

export interface EventConnectionStats {
    eventId: string;
    totalConnections: number;
    adminConnections: number;
    guestConnections: number;
    moderatorConnections: number;
    loggedUserConnections: number;
    coHostConnections: number; // Added to match implementation
    activeRooms: string[];
    lastActivity: Date;
}

export interface GlobalConnectionStats {
    totalConnections: number;
    servers: number;
    serverStats: { [serverId: string]: number };
    timestamp: Date;
}

// ==========================================
// MIDDLEWARE TYPES
// ==========================================

export interface AuthenticatedSocket extends Socket {
    authenticated?: boolean;
    user?: WebSocketUser;
    eventId?: string;
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
    connectionStateRecovery: {
        maxDisconnectionDuration: number;
        skipMiddlewares: boolean;
    };
    transports: string[];
    allowEIO3: boolean;
    pingTimeout: number;
    pingInterval: number;
}

// Re-export Socket type
export { Socket } from 'socket.io';
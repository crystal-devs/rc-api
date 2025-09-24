// 1. services/websocket/websocket.types.ts
// ====================================

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

export interface ConnectionStats {
    totalConnections: number;
    byType: {
        admin: number;
        co_host: number;
        guest: number;
    };
    byEvent: Record<string, number>;
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

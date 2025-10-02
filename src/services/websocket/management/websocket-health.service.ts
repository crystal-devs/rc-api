// 3. services/websocket/management/websocket-health.service.ts
// ====================================

import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import type { ClientConnectionState, ConnectionHealth, ConnectionStats } from '../websocket.types';

export class WebSocketHealthService {
    private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
    private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
    private readonly HEARTBEAT_TIMEOUT = 60000;  // 60 seconds timeout

    constructor(
        private connectedClients: Map<string, ClientConnectionState>,
        private io: Server
    ) {
        this.startHealthCheck();
        logger.info('🏥 Health check service started');
    }

    public handleHeartbeat(socketId: string, clientTimestamp?: number): void {
        const client = this.connectedClients.get(socketId);
        if (client) {
            client.lastHeartbeat = new Date();
            client.isHealthy = true;
        }
    }

    public markUnhealthy(socketId: string): void {
        const client = this.connectedClients.get(socketId);
        if (client) {
            client.isHealthy = false;
        }
    }

    public cleanupConnection(socketId: string): void {
        // Clear heartbeat interval
        const heartbeatInterval = this.heartbeatIntervals.get(socketId);
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            this.heartbeatIntervals.delete(socketId);
        }

        // Remove client
        this.connectedClients.delete(socketId);
    }

    public handleDisconnection(socket: Socket, reason: string): void {
        const client = this.connectedClients.get(socket.id);

        if (client) {
            const userEventId = client.user.eventId;
            logger.info(`🔌 Disconnected: ${socket.id} (${client.user.type} - ${client.user.name}) - ${reason}`);

            // Increment reconnect count for tracking
            if (reason !== 'client namespace disconnect' && reason !== 'server namespace disconnect') {
                client.reconnectCount++;
            }

            this.cleanupConnection(socket.id);
        } else {
            logger.info(`🔌 Disconnected: ${socket.id} (unknown client)`);
        }
    }

    private startHealthCheck(): void {
        // Run health check every 2 minutes
        setInterval(() => {
            this.performHealthCheck();
        }, 120000);
    }

    private performHealthCheck(): void {
        const now = new Date();
        const unhealthyClients: string[] = [];

        this.connectedClients.forEach((client, socketId) => {
            const timeSinceLastHeartbeat = now.getTime() - client.lastHeartbeat.getTime();

            // Mark as unhealthy if no heartbeat for more than timeout period
            if (timeSinceLastHeartbeat > this.HEARTBEAT_TIMEOUT) {
                client.isHealthy = false;
                unhealthyClients.push(socketId);
            }
        });

        if (unhealthyClients.length > 0) {
            logger.warn(`🏥 Found ${unhealthyClients.length} unhealthy connections`);

            // Optionally disconnect unhealthy clients
            unhealthyClients.forEach(socketId => {
                const socket = this.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('connection_unhealthy', {
                        message: 'Connection marked as unhealthy due to missed heartbeats'
                    });
                }
            });
        }
    }

    public getConnectionStats(): ConnectionStats {
        const stats: ConnectionStats = {
            totalConnections: this.connectedClients.size,
            byType: { admin: 0, co_host: 0, guest: 0 },
            byEvent: {},
            totalSubscriptions: 0,
            activeEvents: 0,
            averageSubscriptionsPerClient: 0,
        };

        this.connectedClients.forEach((client) => {
            stats.byType[client.user.type as keyof typeof stats.byType]++;
            const eventId = client.user.eventId;
            stats.byEvent[eventId] = (stats.byEvent[eventId] || 0) + 1;
        });

        return stats;
    }

    public getConnectionHealth(): ConnectionHealth[] {
        const healthStats: ConnectionHealth[] = [];

        this.connectedClients.forEach((client, socketId) => {
            const socket = this.io.sockets.sockets.get(socketId);
            const now = new Date();
            const latency = socket ? now.getTime() - client.lastHeartbeat.getTime() : -1;

            healthStats.push({
                socketId,
                isConnected: !!socket?.connected,
                isHealthy: client.isHealthy,
                lastHeartbeat: client.lastHeartbeat,
                latency,
                reconnectCount: client.reconnectCount
            });
        });

        return healthStats;
    }

    public getEventConnections(eventId: string): Array<{ socketId: string; user: any; health: any }> {
        const connections: Array<{ socketId: string; user: any; health: any }> = [];

        this.connectedClients.forEach((client, socketId) => {
            if (client.user.eventId === eventId) {
                connections.push({
                    socketId,
                    user: client.user,
                    health: {
                        isHealthy: client.isHealthy,
                        lastHeartbeat: client.lastHeartbeat,
                        connectedAt: client.connectedAt,
                        reconnectCount: client.reconnectCount
                    }
                });
            }
        });

        return connections;
    }

    public async cleanup(): Promise<void> {
        logger.info('🧹 Cleaning up health service...');

        // Clear all heartbeat intervals
        this.heartbeatIntervals.forEach(interval => clearInterval(interval));
        this.heartbeatIntervals.clear();

        this.connectedClients.clear();
        logger.info('✅ Health service cleaned up');
    }
}

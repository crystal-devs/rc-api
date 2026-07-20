// src/services/sse/sse.service.ts
import { Response } from 'express';
import { logger } from '@utils/logger';

/**
 * SseService manages Server-Sent Events (SSE) connections.
 * This is used for high-frequency updates like upload progress,
 * reducing WebSocket overhead.
 */
class SseService {
  // Map of eventId -> Set of Response objects
  private connections: Map<string, Set<Response>> = new Map();

  /**
   * Add a new SSE client
   */
  public addClient(eventId: string, res: Response): void {
    if (!this.connections.has(eventId)) {
      this.connections.set(eventId, new Set());
    }

    const clients = this.connections.get(eventId)!;
    clients.add(res);

    // Initial connection message
    this.sendToClient(res, 'connected', { eventId, timestamp: new Date() });

    logger.info(`SSE client added for event ${eventId}. Total clients: ${clients.size}`);

    // Remove client on connection close
    res.on('close', () => {
      clients.delete(res);
      if (clients.size === 0) {
        this.connections.delete(eventId);
      }
      logger.info(`SSE client removed for event ${eventId}. Remaining: ${clients.size}`);
    });
  }

  /**
   * Broadcast an event to all clients subscribed to an eventId
   */
  public broadcast(eventId: string, eventName: string, data: any): void {
    const clients = this.connections.get(eventId);
    if (!clients || clients.size === 0) return;

    clients.forEach(res => {
      this.sendToClient(res, eventName, data);
    });
  }

  /**
   * Send a formatted SSE message to a single client
   */
  private sendToClient(res: Response, eventName: string, data: any): void {
    try {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.warn(`Failed to send SSE message to client: ${error}`);
    }
  }

  /**
   * Provide a heartbeat to keep connections alive (every 30s)
   */
  public startHeartbeat(): void {
    setInterval(() => {
      this.connections.forEach((clients, eventId) => {
        clients.forEach(res => {
          res.write(': heartbeat\n\n');
        });
      });
    }, 30000);
  }
}

export const sseService = new SseService();
// Start heartbeat once
sseService.startHeartbeat();

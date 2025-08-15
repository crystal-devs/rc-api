// services/websocket/photo-wall-websocket.service.ts
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '@utils/logger';
import { PhotoWall } from '@models/photowall.model';

// Helper function to get optimized image URL
function getOptimizedImageUrlForItem(imageVariants: any, quality: string = 'large'): string {
  if (!imageVariants) return '';
  
  const variant = imageVariants[quality] || imageVariants.large || imageVariants.medium;
  
  // Prefer WebP for better compression
  if (variant?.webp?.url) {
    return variant.webp.url;
  } else if (variant?.jpeg?.url) {
    return variant.jpeg.url;
  }

  return imageVariants.original?.url || '';
}

// Helper function to get uploader name
function getUploaderName(media: any): string {
  if (media.uploader_type === 'registered_user' && media.uploaded_by?.name) {
    return media.uploaded_by.name;
  }
  if (media.guest_uploader?.name) {
    return media.guest_uploader.name;
  }
  return 'Anonymous';
}

interface WallSession {
  sessionId: string;
  currentIndex: number;
  lastFetchTime: Date;
}

interface WallRoom {
  shareToken: string;
  viewers: Map<string, WallSession>;
  isPlaying: boolean;
  lastUpdate: Date;
}

export class PhotoWallWebSocketService {
  private io: SocketIOServer;
  private rooms: Map<string, WallRoom> = new Map();

  constructor(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      path: '/socket.io/photo-wall'
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info(`📺 Photo wall connection: ${socket.id}`);

      socket.on('join-wall', (data: { 
        shareToken: string; 
        currentIndex?: number;
        sessionId?: string;
        lastFetchTime?: string;
      }) => {
        this.handleJoinWall(socket, data);
      });

      socket.on('sync-position', (data: { 
        shareToken: string; 
        currentIndex: number;
        sessionId: string;
      }) => {
        this.handleSyncPosition(socket, data);
      });

      socket.on('wall-control', (data: {
        shareToken: string;
        action: string;
        payload?: any;
      }) => {
        this.handleWallControl(socket, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private handleJoinWall(socket: Socket, data: any): void {
    const { shareToken, currentIndex = 0, sessionId, lastFetchTime } = data;
    socket.join(`wall_${shareToken}`);

    if (!this.rooms.has(shareToken)) {
      this.rooms.set(shareToken, {
        shareToken,
        viewers: new Map(),
        isPlaying: true,
        lastUpdate: new Date()
      });
    }

    const room = this.rooms.get(shareToken)!;
    const session: WallSession = {
      sessionId: sessionId || `session_${Date.now()}_${socket.id}`,
      currentIndex,
      lastFetchTime: lastFetchTime ? new Date(lastFetchTime) : new Date()
    };
    
    room.viewers.set(socket.id, session);

    // Update database stats
    PhotoWall.findOneAndUpdate(
      { shareToken, isActive: true },
      { 
        $set: { 'stats.activeViewers': room.viewers.size },
        $inc: { 'stats.totalViews': 1 }
      }
    ).exec();

    socket.emit('wall-joined', {
      sessionId: session.sessionId,
      currentIndex: session.currentIndex,
      isPlaying: room.isPlaying,
      totalViewers: room.viewers.size
    });

    socket.to(`wall_${shareToken}`).emit('viewer-update', {
      totalViewers: room.viewers.size
    });

    logger.info(`📺 Viewer joined wall ${shareToken}: ${room.viewers.size} total`);
  }

  private handleSyncPosition(socket: Socket, data: any): void {
    const { shareToken, currentIndex, sessionId } = data;
    const room = this.rooms.get(shareToken);
    
    if (room && room.viewers.has(socket.id)) {
      const session = room.viewers.get(socket.id)!;
      session.currentIndex = currentIndex;
      session.lastFetchTime = new Date();
    }
  }

  private handleWallControl(socket: Socket, data: any): void {
    const { shareToken, action, payload } = data;
    const room = this.rooms.get(shareToken);
    if (!room) return;

    // Broadcast control action to all viewers
    this.io.to(`wall_${shareToken}`).emit('wall-control', {
      action,
      payload,
      timestamp: new Date().toISOString()
    });
  }

  private handleDisconnect(socket: Socket): void {
    // Fix: Use Array.from() to avoid iterator issue
    const roomEntries = Array.from(this.rooms.entries());
    
    for (const [shareToken, room] of roomEntries) {
      if (room.viewers.has(socket.id)) {
        room.viewers.delete(socket.id);

        PhotoWall.findOneAndUpdate(
          { shareToken, isActive: true },
          { $set: { 'stats.activeViewers': room.viewers.size } }
        ).exec();

        socket.to(`wall_${shareToken}`).emit('viewer-update', {
          totalViewers: room.viewers.size
        });

        if (room.viewers.size === 0) {
          this.rooms.delete(shareToken);
        }
        break;
      }
    }
  }

  // Called when new media is uploaded
  public async notifyNewMediaUpload(eventId: string, mediaItem: any): Promise<void> {
    try {
      const walls = await PhotoWall.find({ eventId, isActive: true }).lean();

      for (const wall of walls) {
        const room = this.rooms.get(wall.shareToken);
        if (!room || room.viewers.size === 0) continue;

        const newItemData = {
          id: mediaItem._id.toString(),
          imageUrl: getOptimizedImageUrlForItem(mediaItem.image_variants, 'large'),
          uploaderName: wall.settings.showUploaderNames ? getUploaderName(mediaItem) : null,
          timestamp: mediaItem.created_at,
          isNew: true,
          insertedAt: new Date(),
          insertionStrategy: wall.settings.newImageInsertion || 'after_current'
        };

        this.io.to(`wall_${wall.shareToken}`).emit('new-media-inserted', {
          newItem: newItemData,
          strategy: wall.settings.newImageInsertion || 'after_current',
          timestamp: new Date().toISOString(),
          insertionHint: { position: 'after_current', bufferImages: 3 }
        });

        logger.info(`📺 Notified wall ${wall.shareToken} about new media: ${mediaItem._id}`);
      }
    } catch (error) {
      logger.error('❌ Error notifying walls about new media:', error);
    }
  }

  public broadcastSettingsUpdate(shareToken: string, newSettings: any): void {
    this.io.to(`wall_${shareToken}`).emit('settings-updated', {
      settings: newSettings,
      timestamp: new Date().toISOString()
    });
  }

  public getConnectionStats(): any {
    const roomValues = Array.from(this.rooms.values());
    return {
      totalActiveWalls: this.rooms.size,
      totalConnections: roomValues.reduce((sum, room) => sum + room.viewers.size, 0)
    };
  }

  public async cleanup(): Promise<void> {
    this.io.disconnectSockets(true);
    this.rooms.clear();
    logger.info('📺 Photo wall WebSocket service cleaned up');
  }
}

// Singleton instance
let photoWallWebSocketService: PhotoWallWebSocketService | null = null;

export const initializePhotoWallWebSocket = (server: HTTPServer): PhotoWallWebSocketService => {
  if (!photoWallWebSocketService) {
    photoWallWebSocketService = new PhotoWallWebSocketService(server);
    logger.info('📺 Photo Wall WebSocket service initialized');
  }
  return photoWallWebSocketService;
};

export const getPhotoWallWebSocketService = (): PhotoWallWebSocketService | null => {
  return photoWallWebSocketService;
};
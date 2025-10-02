// services/websocket/photo-wall-websocket.service.ts
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model'; // 🚀 Use Event instead of PhotoWall

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
  // 🚀 Store event settings locally for quick access
  settings: {
    isEnabled: boolean;
    displayMode: string;
    showUploaderNames: boolean;
    newImageInsertion: string;
    autoAdvance: boolean;
    transitionDuration: number;
  } | null;
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

  private async handleJoinWall(socket: Socket, data: any): Promise<void> {
    const { shareToken, currentIndex = 0, sessionId, lastFetchTime } = data;
    
    try {
      // 🚀 Get event and photowall settings
      const event = await Event.findOne({ share_token: shareToken })
        .select('_id photowall_settings share_settings')
        .lean();

      if (!event || !event.share_settings?.is_active || !event.photowall_settings?.isEnabled) {
        socket.emit('wall-error', {
          message: 'Photo wall not available or disabled'
        });
        return;
      }

      socket.join(`wall_${shareToken}`);

      // Create or get room
      if (!this.rooms.has(shareToken)) {
        this.rooms.set(shareToken, {
          shareToken,
          viewers: new Map(),
          isPlaying: event.photowall_settings.autoAdvance || true,
          lastUpdate: new Date(),
          settings: event.photowall_settings
        });
      }

      const room = this.rooms.get(shareToken)!;
      
      // Update room settings if they've changed
      if (event.photowall_settings) {
        room.settings = event.photowall_settings;
        room.isPlaying = event.photowall_settings.autoAdvance;
      }

      const session: WallSession = {
        sessionId: sessionId || `session_${Date.now()}_${socket.id}`,
        currentIndex,
        lastFetchTime: lastFetchTime ? new Date(lastFetchTime) : new Date()
      };
      
      room.viewers.set(socket.id, session);

      socket.emit('wall-joined', {
        sessionId: session.sessionId,
        currentIndex: session.currentIndex,
        isPlaying: room.isPlaying,
        totalViewers: room.viewers.size,
        settings: room.settings
      });

      socket.to(`wall_${shareToken}`).emit('viewer-update', {
        totalViewers: room.viewers.size
      });

      logger.info(`📺 Viewer joined wall ${shareToken}: ${room.viewers.size} total`);
    } catch (error) {
      logger.error('❌ Error in handleJoinWall:', error);
      socket.emit('wall-error', {
        message: 'Failed to join photo wall'
      });
    }
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

    // Update room state based on control action
    if (action === 'play') room.isPlaying = true;
    if (action === 'pause') room.isPlaying = false;
    if (action === 'toggle') room.isPlaying = !room.isPlaying;

    // Broadcast control action to all viewers
    this.io.to(`wall_${shareToken}`).emit('wall-control', {
      action,
      payload,
      isPlaying: room.isPlaying,
      timestamp: new Date().toISOString()
    });
  }

  private handleDisconnect(socket: Socket): void {
    const roomEntries = Array.from(this.rooms.entries());
    
    for (const [shareToken, room] of roomEntries) {
      if (room.viewers.has(socket.id)) {
        room.viewers.delete(socket.id);

        socket.to(`wall_${shareToken}`).emit('viewer-update', {
          totalViewers: room.viewers.size
        });

        logger.info(`📺 Viewer left wall ${shareToken}: ${room.viewers.size} remaining`);

        // Clean up empty rooms
        if (room.viewers.size === 0) {
          this.rooms.delete(shareToken);
          logger.info(`📺 Cleaned up empty wall room: ${shareToken}`);
        }
        break;
      }
    }
  }

  // 🚀 UPDATED: Called when new media is uploaded
  public async notifyNewMediaUpload(shareToken: string, mediaItem: any): Promise<void> {
    try {
      // Get event settings directly
      const event = await Event.findOne({ share_token: shareToken })
        .select('photowall_settings')
        .lean();

      if (!event?.photowall_settings?.isEnabled) {
        return; // Photo wall disabled, no notification needed
      }

      const room = this.rooms.get(shareToken);
      if (!room || room.viewers.size === 0) {
        logger.debug(`📺 No active viewers for wall ${shareToken}, skipping notification`);
        return;
      }

      const newItemData = {
        id: mediaItem._id.toString(),
        imageUrl: getOptimizedImageUrlForItem(mediaItem.image_variants, 'large'),
        uploaderName: event.photowall_settings.showUploaderNames ? getUploaderName(mediaItem) : null,
        timestamp: mediaItem.created_at,
        isNew: true,
        insertedAt: new Date(),
        insertionStrategy: event.photowall_settings.newImageInsertion || 'after_current'
      };

      this.io.to(`wall_${shareToken}`).emit('new-media-inserted', {
        newItem: newItemData,
        strategy: event.photowall_settings.newImageInsertion || 'after_current',
        timestamp: new Date().toISOString(),
        insertionHint: { position: 'after_current', bufferImages: 3 }
      });

      logger.info(`📺 Notified wall ${shareToken} about new media: ${mediaItem._id} (${room.viewers.size} viewers)`);
    } catch (error) {
      logger.error('❌ Error notifying walls about new media:', error);
    }
  }

  // 🚀 UPDATED: Called when media is removed
  public async notifyMediaRemoved(shareToken: string, mediaId: string, reason?: string): Promise<void> {
    try {
      const room = this.rooms.get(shareToken);
      if (!room || room.viewers.size === 0) {
        return; // No viewers to notify
      }

      this.io.to(`wall_${shareToken}`).emit('media-removed', {
        mediaId,
        reason: reason || 'Content removed',
        timestamp: new Date().toISOString()
      });

      logger.info(`📺 Notified wall ${shareToken} about removed media: ${mediaId}`);
    } catch (error) {
      logger.error('❌ Error notifying about removed media:', error);
    }
  }

  // 🚀 UPDATED: Broadcast settings update
  public async broadcastSettingsUpdate(shareToken: string, newSettings: any): Promise<void> {
    try {
      // Update local room cache
      const room = this.rooms.get(shareToken);
      if (room) {
        room.settings = newSettings;
        room.isPlaying = newSettings.autoAdvance || room.isPlaying;
      }

      this.io.to(`wall_${shareToken}`).emit('settings-updated', {
        settings: newSettings,
        timestamp: new Date().toISOString()
      });

      logger.info(`📺 Broadcasted settings update to wall ${shareToken}`);
    } catch (error) {
      logger.error('❌ Error broadcasting settings update:', error);
    }
  }

  // 🚀 NEW: Get wall status for a specific share token
  public getWallStatus(shareToken: string): any {
    const room = this.rooms.get(shareToken);
    if (!room) {
      return {
        isActive: false,
        totalViewers: 0,
        isPlaying: false,
        settings: null
      };
    }

    return {
      isActive: true,
      totalViewers: room.viewers.size,
      isPlaying: room.isPlaying,
      settings: room.settings,
      lastUpdate: room.lastUpdate
    };
  }

  public getConnectionStats(): any {
    const roomValues = Array.from(this.rooms.values());
    const totalConnections = roomValues.reduce((sum, room) => sum + room.viewers.size, 0);
    const activeWalls = roomValues.filter(room => room.viewers.size > 0).length;

    return {
      totalActiveWalls: this.rooms.size,
      wallsWithViewers: activeWalls,
      totalConnections,
      rooms: roomValues.map(room => ({
        shareToken: room.shareToken.substring(0, 8) + '...',
        viewers: room.viewers.size,
        isPlaying: room.isPlaying,
        isEnabled: room.settings?.isEnabled || false
      }))
    };
  }

  public async cleanup(): Promise<void> {
    this.io.disconnectSockets(true);
    this.rooms.clear();
    logger.info('📺 Photo wall WebSocket service cleaned up');
  }

  // 🚀 NEW: Utility method to check if wall is active
  public isWallActive(shareToken: string): boolean {
    const room = this.rooms.get(shareToken);
    return !!(room && room.viewers.size > 0 && room.settings?.isEnabled);
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

// 🚀 NEW: Helper function to notify media changes by shareToken
export const notifyPhotoWallMediaChange = async (shareToken: string, mediaItem: any, action: 'added' | 'removed'): Promise<void> => {
  const wsService = getPhotoWallWebSocketService();
  if (!wsService) return;

  if (action === 'added') {
    await wsService.notifyNewMediaUpload(shareToken, mediaItem);
  } else if (action === 'removed') {
    await wsService.notifyMediaRemoved(shareToken, mediaItem._id || mediaItem.id);
  }
};
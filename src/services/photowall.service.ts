// services/photo-wall.service.ts
import { PhotoWall } from "@models/photowall.model";
import { Media } from "@models/media.model";
import { logger } from "@utils/logger";
import { Event } from "@models/event.model";
import { getPhotoWallWebSocketService } from "./photoWallWebSocketService";

interface ServiceResponse<T> {
  status: boolean;
  code: number;
  message: string;
  data: T | null;
  error?: any;
}

interface PhotoWallItem {
  id: string;
  imageUrl: string;
  uploaderName?: string;
  timestamp: Date;
  position: number;
  isNew?: boolean;
  insertedAt?: Date;
}

export const getPhotoWallService = async (
  shareToken: string,
  options: { 
    quality?: string; 
    maxItems?: number;
    currentIndex?: number;
    sessionId?: string;
    lastFetchTime?: string;
  } = {}
): Promise<ServiceResponse<any>> => {
  try {
    // 1. Find event by share token
    const event = await Event.findOne({ share_token: shareToken })
      .select('_id title share_settings')
      .lean();

    if (!event || !event.share_settings?.is_active) {
      return {
        status: false,
        code: 404,
        message: 'Photo wall not found or disabled',
        data: null
      };
    }

    // 2. Get or create photo wall
    let photoWall = await PhotoWall.findOne({ shareToken, isActive: true });
    if (!photoWall) {
      photoWall = await PhotoWall.create({
        _id: `wall_${shareToken}`,
        eventId: event._id,
        shareToken,
        settings: {
          isEnabled: true,
          displayMode: 'slideshow',
          transitionDuration: 5000,
          showUploaderNames: false,
          autoAdvance: true,
          newImageInsertion: 'after_current'
        }
      });
    }

    if (!photoWall.settings.isEnabled) {
      return {
        status: false,
        code: 403,
        message: 'Photo wall is disabled',
        data: null
      };
    }

    // 3. Get fresh approved media
    const media = await Media.find({
      event_id: event._id,
      'approval.status': { $in: ['approved', 'auto_approved'] },
      type: 'image',
      'processing.variants_generated': true
    })
    .sort({ created_at: -1 })
    .limit(options.maxItems || 100)
    .select('_id image_variants metadata created_at guest_uploader uploaded_by uploader_type')
    .lean();

    // 4. Apply smart insertion logic
    const result = buildSmartPhotoQueue(
      media,
      photoWall,
      options.currentIndex || 0,
      options.lastFetchTime,
      options.sessionId
    );

    return {
      status: true,
      code: 200,
      message: 'Photo wall loaded successfully',
      data: {
        wallId: photoWall._id,
        eventTitle: event.title,
        settings: photoWall.settings,
        items: result.items,
        currentIndex: result.adjustedCurrentIndex,
        totalItems: result.items.length,
        newItemsCount: result.newItemsCount,
        serverTime: new Date().toISOString(),
        sessionId: result.sessionId,
        insertionStrategy: photoWall.settings.newImageInsertion
      }
    };

  } catch (error: any) {
    logger.error('❌ Error in getPhotoWallService:', error);
    return {
      status: false,
      code: 500,
      message: 'Failed to load photo wall',
      data: null,
      error: { message: error.message }
    };
  }
};

export const updatePhotoWallSettingsService = async (
  shareToken: string,
  newSettings: any,
  userId?: string
): Promise<ServiceResponse<any>> => {
  try {
    // Validate user has permission to update
    const event = await Event.findOne({ share_token: shareToken })
      .select('created_by co_hosts')
      .lean();

    if (!event) {
      return {
        status: false,
        code: 404,
        message: 'Event not found',
        data: null
      };
    }

    // Check permissions
    const isOwner = event.created_by.toString() === userId;
    const isCoHost = event.co_hosts?.some((coHost: any) => 
      coHost.user_id.toString() === userId && coHost.status === 'approved'
    );

    if (!isOwner && !isCoHost) {
      return {
        status: false,
        code: 403,
        message: 'Not authorized to update photo wall settings',
        data: null
      };
    }

    // Validate and filter settings
    const allowedSettings = [
      'isEnabled', 
      'displayMode', 
      'transitionDuration', 
      'showUploaderNames', 
      'autoAdvance',
      'newImageInsertion'
    ];

    const filteredSettings: any = {};
    Object.keys(newSettings).forEach(key => {
      if (allowedSettings.includes(key)) {
        filteredSettings[`settings.${key}`] = newSettings[key];
      }
    });

    // Update photo wall
    const updatedWall = await PhotoWall.findOneAndUpdate(
      { shareToken, isActive: true },
      {
        $set: {
          ...filteredSettings,
          updatedAt: new Date()
        }
      },
      { new: true }
    ).lean();

    if (!updatedWall) {
      return {
        status: false,
        code: 404,
        message: 'Photo wall not found',
        data: null
      };
    }

    // Notify WebSocket clients
    const wsService = getPhotoWallWebSocketService();
    if (wsService) {
      wsService.broadcastSettingsUpdate(shareToken, updatedWall.settings);
    }

    return {
      status: true,
      code: 200,
      message: 'Photo wall settings updated successfully',
      data: { 
        settings: updatedWall.settings,
        wallId: updatedWall._id
      }
    };

  } catch (error: any) {
    logger.error('❌ Error updating photo wall settings:', error);
    return {
      status: false,
      code: 500,
      message: 'Failed to update photo wall settings',
      data: null,
      error: { message: error.message }
    };
  }
};

export const getPhotoWallStatusService = async (
  shareToken: string
): Promise<ServiceResponse<any>> => {
  try {
    const event = await Event.findOne({ share_token: shareToken })
      .select('_id title share_settings')
      .lean();

    if (!event) {
      return {
        status: false,
        code: 404,
        message: 'Event not found',
        data: null
      };
    }

    const photoWall = await PhotoWall.findOne({ shareToken, isActive: true })
      .select('settings stats')
      .lean();

    const statusData = {
      eventTitle: event.title,
      isActive: !!photoWall,
      isEnabled: photoWall?.settings?.isEnabled || false,
      displayMode: photoWall?.settings?.displayMode || 'slideshow',
      activeViewers: photoWall?.stats?.activeViewers || 0,
      totalViews: photoWall?.stats?.totalViews || 0,
      isSharing: event.share_settings?.is_active || false
    };

    return {
      status: true,
      code: 200,
      message: 'Photo wall status retrieved',
      data: statusData
    };

  } catch (error: any) {
    logger.error('❌ Error getting photo wall status:', error);
    return {
      status: false,
      code: 500,
      message: 'Failed to get photo wall status',
      data: null,
      error: { message: error.message }
    };
  }
};

// Helper function for smart queue building
function buildSmartPhotoQueue(
  allMedia: any[],
  photoWall: any,
  currentIndex: number,
  lastFetchTime?: string,
  sessionId?: string
): {
  items: PhotoWallItem[];
  adjustedCurrentIndex: number;
  newItemsCount: number;
  sessionId: string;
} {
  
  const generatedSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Transform all media to display items
  const baseItems: PhotoWallItem[] = allMedia.map((item, index) => ({
    id: item._id.toString(),
    imageUrl: getOptimizedUrl(item.image_variants, 'large'),
    uploaderName: photoWall.settings.showUploaderNames ? getUploaderName(item) : null,
    timestamp: item.created_at,
    position: index,
    isNew: false
  }));

  // If no lastFetchTime, this is initial load
  if (!lastFetchTime) {
    return {
      items: baseItems,
      adjustedCurrentIndex: currentIndex,
      newItemsCount: 0,
      sessionId: generatedSessionId
    };
  }

  // Find new items since last fetch
  const lastFetch = new Date(lastFetchTime);
  const newItems = allMedia.filter(item => new Date(item.created_at) > lastFetch);
  
  if (newItems.length === 0) {
    return {
      items: baseItems,
      adjustedCurrentIndex: currentIndex,
      newItemsCount: 0,
      sessionId: generatedSessionId
    };
  }

  // Apply smart insertion (after_current strategy)
  const newDisplayItems: PhotoWallItem[] = newItems.map(item => ({
    id: item._id.toString(),
    imageUrl: getOptimizedUrl(item.image_variants, 'large'),
    uploaderName: photoWall.settings.showUploaderNames ? getUploaderName(item) : null,
    timestamp: item.created_at,
    position: -1,
    isNew: true,
    insertedAt: new Date()
  }));

  // Insert after current + 3 buffer (smart approach)
  const insertPosition = Math.min(currentIndex + 3, baseItems.length);
  const finalItems = [
    ...baseItems.slice(0, insertPosition),
    ...newDisplayItems,
    ...baseItems.slice(insertPosition)
  ];

  // Update positions
  finalItems.forEach((item, index) => {
    item.position = index;
  });

  return {
    items: finalItems,
    adjustedCurrentIndex: currentIndex,
    newItemsCount: newDisplayItems.length,
    sessionId: generatedSessionId
  };
}

// Helper functions
const getOptimizedUrl = (variants: any, quality: string): string => {
  if (!variants) return '';
  const variant = variants[quality] || variants.large || variants.medium;
  return variant?.webp?.url || variant?.jpeg?.url || variants.original?.url || '';
};

const getUploaderName = (media: any): string => {
  if (media.uploader_type === 'registered_user' && media.uploaded_by?.name) {
    return media.uploaded_by.name;
  }
  if (media.guest_uploader?.name) {
    return media.guest_uploader.name;
  }
  return 'Anonymous';
};

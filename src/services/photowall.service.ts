import { Event } from "@models/event.model";
import { Media } from "@models/media.model";
import { logger } from "@utils/logger";

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
}

// 🎯 SINGLE SIMPLIFIED SERVICE FOR DISPLAY
export const getPhotoWallDisplayService = async (
  shareToken: string,
  options: { quality?: string; maxItems?: number } = {}
): Promise<ServiceResponse<any>> => {
  try {
    // Get event with photowall settings in single query
    const event = await Event.findOne({ share_token: shareToken })
      .select('_id title photowall_settings share_settings')
      .lean();

    if (!event || !event.share_settings?.is_active) {
      return {
        status: false,
        code: 404,
        message: 'Photo wall not found or event sharing disabled',
        data: null
      };
    }

    if (!event.photowall_settings?.isEnabled) {
      return {
        status: false,
        code: 403,
        message: 'Photo wall is disabled for this event',
        data: null
      };
    }

    // Get approved media
    const media = await Media.find({
      event_id: event._id,
      'approval.status': { $in: ['approved', 'auto_approved'] },
      type: 'image',
      'processing.variants_generated': true
    })
      .sort({ created_at: -1 })
      .limit(options.maxItems || 100)
      .select('_id image_variants created_at guest_uploader uploaded_by uploader_type')
      .lean();

    // Transform to display items
    const items: PhotoWallItem[] = media.map((item, index) => ({
      id: item._id.toString(),
      imageUrl: getOptimizedImageUrl(item.image_variants, options.quality || 'large'),
      uploaderName: event.photowall_settings.showUploaderNames ? getUploaderName(item) : null,
      timestamp: item.created_at,
      position: index,
      isNew: false
    }));

    return {
      status: true,
      code: 200,
      message: 'Photo wall loaded successfully',
      data: {
        eventTitle: event.title,
        settings: event.photowall_settings,
        items,
        totalItems: items.length,
        serverTime: new Date().toISOString()
      }
    };

  } catch (error: any) {
    logger.error('❌ Error in getPhotoWallDisplayService:', error);
    return {
      status: false,
      code: 500,
      message: 'Failed to load photo wall',
      data: null,
      error: { message: error.message }
    };
  }
};

// Helper functions
const getOptimizedImageUrl = (variants: any, quality: string): string => {
  if (!variants) return '';
  const variant = variants[quality] || variants.large || variants.medium || variants.original;
  return variant?.webp?.url || variant?.jpeg?.url || variant?.url || '';
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
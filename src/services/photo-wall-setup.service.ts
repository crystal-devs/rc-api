// services/photo-wall-setup.service.ts
import { Event } from "@models/event.model";
import { PhotoWall } from "@models/photowall.model";
import { logger } from "@utils/logger";

export const createPhotoWallsForExistingEvents = async (): Promise<void> => {
  try {
    logger.info('🔄 Creating photo walls for existing events...');
    
    // Find events that don't have photo walls yet
    const eventsWithoutWalls = await Event.find({
      share_settings: { $exists: true },
      'share_settings.is_active': true
    }).lean();

    let created = 0;
    let skipped = 0;

    for (const event of eventsWithoutWalls) {
      try {
        // Check if wall already exists
        const existingWall = await PhotoWall.findOne({ 
          shareToken: event.share_token,
          isActive: true 
        });

        if (existingWall) {
          skipped++;
          continue;
        }

        // Create photo wall
        await PhotoWall.create({
          _id: `wall_${event.share_token}`,
          eventId: event._id,
          shareToken: event.share_token,
          settings: {
            isEnabled: true,
            displayMode: 'slideshow',
            transitionDuration: 5000,
            showUploaderNames: false,
            autoAdvance: true,
            newImageInsertion: 'after_current'
          }
        });

        created++;
        logger.info(`📺 Created photo wall for event: ${event._id}`);

      } catch (error) {
        logger.error(`❌ Failed to create photo wall for event ${event._id}:`, error);
      }
    }

    logger.info(`✅ Photo wall creation complete: ${created} created, ${skipped} skipped`);

  } catch (error) {
    logger.error('❌ Error creating photo walls for existing events:', error);
  }
};
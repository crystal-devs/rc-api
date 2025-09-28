// services/upload/core/imagekit.service.ts - FIXED VERSION

import { imagekit } from '@configs/imagekit.config';
import { logger } from '@utils/logger';

export interface ImageKitUploadOptions {
  fileName: string;
  folder: string; // This will be overridden by our path generation
  format: string;
  quality: number;
  eventId: string;
  mediaId: string;
  variantType: 'original' | 'small' | 'medium' | 'large' | 'preview';
  tags?: string[];
}

/**
 * Generate correct ImageKit folder path based on variant type
 */
function generateImageKitPath(eventId: string, variantType: string): string {
  switch (variantType) {
    case 'original':
      return `events/${eventId}/originals`;
    case 'preview':
      return `events/${eventId}/previews`;
    case 'small':
    case 'medium':
    case 'large':
      return `events/${eventId}/variants/${variantType}`;
    default:
      return `events/${eventId}/misc`;
  }
}

/**
 * Upload buffer to ImageKit with correct path structure
 */
export const uploadToImageKit = async (
  buffer: Buffer,
  options: ImageKitUploadOptions
): Promise<string> => {
  try {
    // Generate correct folder path
    const folderPath = generateImageKitPath(options.eventId, options.variantType);
    
    logger.info(`Uploading to ImageKit: ${folderPath}/${options.fileName}`);

    const uploadResponse = await imagekit.upload({
      file: buffer,
      fileName: options.fileName,
      folder: folderPath, // Use generated path
      tags: [
        'event',
        options.eventId,
        options.mediaId,
        options.variantType,
        ...(options.tags || [])
      ],
      useUniqueFileName: false, // We control the filename
      responseFields: ['fileId', 'url', 'name', 'size', 'filePath']
    });

    logger.info(`Upload successful: ${uploadResponse.url}`, {
      fileId: uploadResponse.fileId,
      filePath: uploadResponse.filePath,
      size: uploadResponse.size
    });

    return uploadResponse.url;

  } catch (error: any) {
    logger.error(`ImageKit upload failed for ${options.fileName}:`, {
      error: error.message,
      eventId: options.eventId,
      variantType: options.variantType,
      folderPath: generateImageKitPath(options.eventId, options.variantType)
    });
    throw new Error(`ImageKit upload failed: ${error.message}`);
  }
};
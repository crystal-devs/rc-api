// services/imageProcessingService.ts - Fixed ImageKit Import and Types
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import ImageKit from 'imagekit';
import { logger } from '../utils/logger';

// ImageKit configuration - adjust based on your config
const imagekit = new ImageKit({
    publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
    urlEndpoint: "https://ik.imagekit.io/roseclick",
});

interface ImageVariant {
  name: string;
  width: number;
  quality: number;
  format: 'webp' | 'jpeg';
}

interface ProcessedVariant {
  name: string;
  url: string;
  width: number;
  height: number;
  size_mb: number;
  format: 'webp' | 'jpeg';
}

interface ImageProcessingResult {
  original: {
    url: string;
    width: number;
    height: number;
    size_mb: number;
    format: string;
  };
  variants: {
    small: {
      webp: ProcessedVariant;
      jpeg: ProcessedVariant;
    };
    medium: {
      webp: ProcessedVariant;
      jpeg: ProcessedVariant;
    };
    large: {
      webp: ProcessedVariant;
      jpeg: ProcessedVariant;
    };
  };
}

class ImageProcessingService {
  // Optimized variant configuration for better performance and quality
  private readonly variants: ImageVariant[] = [
    // Small variant - for thumbnails, mobile (reduced quality for smaller files)
    { name: 'small', width: 400, quality: 75, format: 'webp' },
    { name: 'small', width: 400, quality: 80, format: 'jpeg' },
    
    // Medium variant - for desktop feed, cards (balanced quality/size)
    { name: 'medium', width: 800, quality: 80, format: 'webp' },
    { name: 'medium', width: 800, quality: 85, format: 'jpeg' },
    
    // Large variant - for lightbox, full view (high quality)
    { name: 'large', width: 1400, quality: 85, format: 'webp' },
    { name: 'large', width: 1400, quality: 90, format: 'jpeg' },
  ];

  /**
   * Process uploaded image and generate all variants
   */
  async processImage(
    file: Express.Multer.File,
    event_id: string,
    media_id: string
  ): Promise<ImageProcessingResult> {
    try {
      logger.info(`🖼️ Starting image processing for ${file.originalname}`);
      
      const fileBuffer = await fs.readFile(file.path);
      
      // Get original image metadata
      const originalMetadata = await sharp(fileBuffer).metadata();
      
      if (!originalMetadata.width || !originalMetadata.height) {
        throw new Error('Could not read image dimensions');
      }

      // Validate image size (prevent processing extremely large images)
      if (originalMetadata.width > 5000 || originalMetadata.height > 5000) {
        logger.warn(`Large image detected: ${originalMetadata.width}x${originalMetadata.height}`);
      }

      // Upload original to ImageKit
      const originalResult = await this.uploadOriginal(
        fileBuffer,
        file.originalname,
        event_id,
        media_id
      );

      // Process all variants in parallel for better performance
      const variantPromises = this.variants.map(variant =>
        this.processVariant(fileBuffer, variant, event_id, media_id, originalMetadata)
      );

      const processedVariants = await Promise.all(variantPromises);

      // Organize variants by size and format
      const organizedVariants = this.organizeVariants(processedVariants);

      const result: ImageProcessingResult = {
        original: {
          url: originalResult.url,
          width: originalMetadata.width,
          height: originalMetadata.height,
          size_mb: this.bytesToMB(originalResult.size),
          format: originalMetadata.format || 'jpeg'
        },
        variants: organizedVariants
      };

      logger.info(`✅ Image processing completed for ${file.originalname}`, {
        original_size: `${result.original.width}x${result.original.height}`,
        variants_count: this.variants.length,
        total_size_mb: this.calculateTotalSize(result),
        compression_ratio: `${Math.round((1 - this.calculateTotalVariantsSize(result) / result.original.size_mb) * 100)}%`
      });

      return result;

    } catch (error: any) {
      logger.error(`❌ Image processing failed for ${file.originalname}:`, error);
      throw new Error(`Image processing failed: ${error.message}`);
    }
  }

  /**
   * Upload original image to ImageKit with optimization
   */
  private async uploadOriginal(
    buffer: Buffer,
    originalFilename: string,
    event_id: string,
    media_id: string
  ): Promise<{ url: string; size: number }> {
    const fileName = `${media_id}_original${path.extname(originalFilename)}`;
    
    const uploadResult = await imagekit.upload({
      file: buffer,
      fileName,
      folder: `/events/${event_id}/original`,
      useUniqueFileName: false,
      tags: ['original', event_id, media_id],
      // Add some basic optimization for original
      transformation: {
        pre: 'q_auto:good,f_auto' // Auto quality and format optimization
      }
    });

    return {
      url: uploadResult.url,
      size: buffer.length
    };
  }

  /**
   * Process a single image variant with optimized settings
   */
  private async processVariant(
    originalBuffer: Buffer,
    variant: ImageVariant,
    event_id: string,
    media_id: string,
    originalMetadata: sharp.Metadata
  ): Promise<ProcessedVariant> {
    try {
      // Calculate target height maintaining aspect ratio
      const aspectRatio = originalMetadata.height! / originalMetadata.width!;
      const targetHeight = Math.round(variant.width * aspectRatio);

      // Process image with Sharp using optimized settings
      let sharpInstance = sharp(originalBuffer)
        .resize(variant.width, targetHeight, {
          fit: 'inside', // Maintain aspect ratio
          withoutEnlargement: true, // Don't upscale smaller images
          kernel: sharp.kernel.lanczos3 // Better quality resizing
        });

      // Apply format-specific optimizations
      if (variant.format === 'webp') {
        sharpInstance = sharpInstance.webp({
          quality: variant.quality,
          effort: 4, // Better compression (0-6, higher is slower but better)
          nearLossless: false, // Use lossy compression for smaller files
          smartSubsample: true // Better quality at low resolutions
        });
      } else if (variant.format === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({
          quality: variant.quality,
          progressive: true, // Progressive JPEG for better perceived loading
          mozjpeg: true, // Better compression algorithm
          optimiseScans: true, // Optimize progressive scans
          trellisQuantisation: true // Better quality at same file size
        });
      }

      const processedBuffer = await sharpInstance.toBuffer();
      const processedMetadata = await sharp(processedBuffer).metadata();

      // Upload to ImageKit
      const fileName = `${media_id}_${variant.name}.${variant.format}`;
      const uploadResult = await imagekit.upload({
        file: processedBuffer,
        fileName,
        folder: `/events/${event_id}/variants/${variant.name}`,
        useUniqueFileName: false,
        tags: [variant.name, variant.format, event_id, media_id, 'variant']
      });

      return {
        name: variant.name,
        url: uploadResult.url,
        width: processedMetadata.width!,
        height: processedMetadata.height!,
        size_mb: this.bytesToMB(processedBuffer.length),
        format: variant.format
      };

    } catch (error: any) {
      logger.error(`Failed to process variant ${variant.name} (${variant.format}):`, error);
      throw error;
    }
  }

  /**
   * Organize processed variants by size and format
   */
  private organizeVariants(variants: ProcessedVariant[]) {
    const organized = {
      small: { webp: null as ProcessedVariant | null, jpeg: null as ProcessedVariant | null },
      medium: { webp: null as ProcessedVariant | null, jpeg: null as ProcessedVariant | null },
      large: { webp: null as ProcessedVariant | null, jpeg: null as ProcessedVariant | null }
    };

    variants.forEach(variant => {
      if (variant.name === 'small') {
        organized.small[variant.format] = variant;
      } else if (variant.name === 'medium') {
        organized.medium[variant.format] = variant;
      } else if (variant.name === 'large') {
        organized.large[variant.format] = variant;
      }
    });

    // Ensure all variants are populated
    if (!organized.small.webp || !organized.small.jpeg ||
        !organized.medium.webp || !organized.medium.jpeg ||
        !organized.large.webp || !organized.large.jpeg) {
      throw new Error('Failed to generate all required variants');
    }

    return organized as {
      small: { webp: ProcessedVariant; jpeg: ProcessedVariant };
      medium: { webp: ProcessedVariant; jpeg: ProcessedVariant };
      large: { webp: ProcessedVariant; jpeg: ProcessedVariant };
    };
  }

  /**
   * Calculate total size of all variants
   */
  private calculateTotalSize(result: ImageProcessingResult): number {
    let total = result.original.size_mb;
    total += this.calculateTotalVariantsSize(result);
    return Math.round(total * 100) / 100;
  }

  /**
   * Calculate total size of variants only (excluding original)
   */
  private calculateTotalVariantsSize(result: ImageProcessingResult): number {
    let total = 0;
    Object.values(result.variants).forEach(sizeVariants => {
      Object.values(sizeVariants).forEach(formatVariant => {
        total += formatVariant.size_mb;
      });
    });
    return total;
  }

  /**
   * Convert bytes to MB with precision
   */
  private bytesToMB(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }

  /**
   * Validate if file is a supported image format
   */
  isValidImageFormat(file: Express.Multer.File): boolean {
    const supportedMimeTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/webp',
      'image/heic', // iOS photos
      'image/heif', // iOS photos
      'image/tiff',
      'image/tif'
    ];

    return supportedMimeTypes.includes(file.mimetype.toLowerCase());
  }

  /**
   * Get estimated processing time based on file size
   */
  getEstimatedProcessingTime(fileSizeBytes: number): number {
    // Rough estimate: 1MB = ~2 seconds processing time
    const sizeMB = this.bytesToMB(fileSizeBytes);
    return Math.max(5, Math.min(sizeMB * 2, 30)); // Between 5-30 seconds
  }

  /**
   * Get optimized image URL for specific context
   */
  getOptimizedUrl(
    variants: any, 
    context: 'mobile' | 'desktop' | 'lightbox', 
    supportsWebP: boolean = true
  ): string {
    try {
      let targetVariant;
      
      switch (context) {
        case 'mobile':
          targetVariant = variants.small;
          break;
        case 'desktop':
          targetVariant = variants.medium;
          break;
        case 'lightbox':
          targetVariant = variants.large;
          break;
        default:
          targetVariant = variants.medium;
      }

      // Return WebP if supported and available, otherwise JPEG
      if (supportsWebP && targetVariant?.webp?.url) {
        return targetVariant.webp.url;
      } else if (targetVariant?.jpeg?.url) {
        return targetVariant.jpeg.url;
      }

      // Fallback to any available variant
      return variants.medium?.jpeg?.url || 
             variants.small?.jpeg?.url || 
             variants.large?.jpeg?.url || '';
      
    } catch (error) {
      logger.error('Failed to get optimized URL:', error);
      return '';
    }
  }

  /**
   * Cleanup processing resources
   */
  async cleanup(): Promise<void> {
    // Any cleanup logic if needed
    logger.debug('Image processing service cleanup completed');
  }
}

export const imageProcessingService = new ImageProcessingService();

// Helper function to get the best image URL for frontend
export const getBestImageUrl = (
  variants: any, 
  context: 'mobile' | 'desktop' | 'lightbox' = 'desktop',
  userAgent?: string
): string => {
  // Detect WebP support from user agent (server-side detection)
  const supportsWebP = userAgent ? 
    /Chrome|Firefox|Edge|Opera|Android/.test(userAgent) && !/Safari|iPhone|iPad/.test(userAgent) : 
    true; // Default to true for modern browsers

  return imageProcessingService.getOptimizedUrl(variants, context, supportsWebP);
};

// Helper function to get responsive image srcset
export const getResponsiveSrcSet = (variants: any, supportsWebP: boolean = true): string => {
  const format = supportsWebP ? 'webp' : 'jpeg';
  const srcset = [];
  
  if (variants.small?.[format]?.url) {
    srcset.push(`${variants.small[format].url} ${variants.small[format].width}w`);
  }
  if (variants.medium?.[format]?.url) {
    srcset.push(`${variants.medium[format].url} ${variants.medium[format].width}w`);
  }
  if (variants.large?.[format]?.url) {
    srcset.push(`${variants.large[format].url} ${variants.large[format].width}w`);
  }
  
  return srcset.join(', ');
};
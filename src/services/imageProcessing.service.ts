// // services/imageProcessing.service.ts - Compatible with your existing schema

// import sharp from 'sharp';
// import path from 'path';
// import fs from 'fs/promises';
// import ImageKit from 'imagekit';
// import { ImageProcessingJobData, ImageProcessingResult, ProcessedImageVariant } from 'types/queue';
// import { logger } from '@utils/logger';

// // 🚀 IMAGEKIT: Reuse connection
// const imagekit = new ImageKit({
//   publicKey: process.env.IMAGE_KIT_PUBLIC_KEY!,
//   privateKey: process.env.IMAGE_KIT_PRIVATE_KEY!,
//   urlEndpoint: "https://ik.imagekit.io/roseclick",
// });

// // 🚀 OPTIMIZED VARIANTS: Map to your schema's small/medium/large structure
// interface VariantConfig {
//   name: 'small' | 'medium' | 'large'; // Match your schema
//   width: number;
//   quality: number;
//   format: 'webp' | 'jpeg';
// }

// class OptimizedImageProcessingService {
//   // 🔧 COMPATIBLE: Match your schema structure (small/medium/large)
//   private readonly variants: VariantConfig[] = [
//     // Small variants (thumbnails)
//     { name: 'small', width: 400, quality: 70, format: 'webp' },
//     { name: 'small', width: 400, quality: 75, format: 'jpeg' },

//     // Medium variants (display)
//     { name: 'medium', width: 800, quality: 80, format: 'webp' },
//     { name: 'medium', width: 800, quality: 85, format: 'jpeg' },

//     // Large variants (full size)
//     { name: 'large', width: 1600, quality: 85, format: 'webp' },
//     { name: 'large', width: 1600, quality: 90, format: 'jpeg' },
//   ];

//   /**
//    * 🚀 MAIN PROCESSING METHOD: Compatible with your existing system
//    */
//   async processImage(jobData: ImageProcessingJobData): Promise<ImageProcessingResult> {
//     const { mediaId, eventId, filePath, originalFilename } = jobData;
//     const startTime = Date.now();

//     try {
//       logger.info(`🔄 Processing: ${originalFilename}`);

//       // 🚀 STEP 1: Read and validate file
//       const fileBuffer = await fs.readFile(filePath);
//       const metadata = await sharp(fileBuffer).metadata();

//       if (!metadata.width || !metadata.height) {
//         throw new Error('Invalid image: Could not read dimensions');
//       }

//       logger.debug(`📐 Image dimensions: ${metadata.width}x${metadata.height}`);

//       // 🚀 STEP 2: Upload original and process variants in parallel
//       const [originalResult, processedVariants] = await Promise.all([
//         this.uploadOriginal(fileBuffer, jobData),
//         this.processAllVariants(fileBuffer, eventId, mediaId, metadata)
//       ]);

//       // 🚀 STEP 3: Organize results to match your schema
//       const organizedVariants = this.organizeVariantsForYourSchema(processedVariants);

//       const processingTime = Date.now() - startTime;
//       logger.info(`✅ Processing completed: ${originalFilename} in ${processingTime}ms`);

//       return {
//         mediaId,
//         original: {
//           url: originalResult.url,
//           width: metadata.width,
//           height: metadata.height,
//           size_mb: this.bytesToMB(originalResult.size),
//           format: metadata.format || 'jpeg'
//         },
//         variants: organizedVariants
//       };

//     } finally {
//       // 🧹 CLEANUP: Remove temp file
//       try {
//         await fs.unlink(filePath);
//         logger.debug(`🗑️ Cleaned up temp file: ${filePath}`);
//       } catch (error) {
//         logger.warn(`Failed to cleanup file ${filePath}:`, error);
//       }
//     }
//   }

//   /**
//    * 🚀 PARALLEL PROCESSING: Process all variants simultaneously
//    */
//   private async processAllVariants(
//     originalBuffer: Buffer,
//     eventId: string,
//     mediaId: string,
//     originalMetadata: sharp.Metadata
//   ): Promise<(ProcessedImageVariant & { name: string })[]> {

//     // 🚀 PARALLEL: Process all variants at once
//     const variantPromises = this.variants.map(variant =>
//       this.processVariant(originalBuffer, variant, eventId, mediaId, originalMetadata)
//     );

//     const results = await Promise.all(variantPromises);
//     logger.debug(`✅ Processed ${results.length} variants in parallel`);

//     return results;
//   }

//   /**
//    * 🚀 OPTIMIZED: Single variant processing
//    */
//   private async processVariant(
//     originalBuffer: Buffer,
//     variant: VariantConfig,
//     eventId: string,
//     mediaId: string,
//     originalMetadata: sharp.Metadata
//   ): Promise<ProcessedImageVariant & { name: string }> {

//     const aspectRatio = originalMetadata.height! / originalMetadata.width!;
//     const targetHeight = Math.round(variant.width * aspectRatio);

//     // 🚀 SHARP PIPELINE: Optimized settings
//     let sharpInstance = sharp(originalBuffer, {
//       sequentialRead: true,
//       limitInputPixels: false
//     })
//       .resize(variant.width, targetHeight, {
//         fit: 'inside',
//         withoutEnlargement: true,
//         kernel: sharp.kernel.lanczos3
//       });

//     // 🔧 FORMAT-SPECIFIC OPTIMIZATIONS
//     if (variant.format === 'webp') {
//       sharpInstance = sharpInstance.webp({
//         quality: variant.quality,
//         effort: 4,
//         smartSubsample: true,
//         nearLossless: false
//       });
//     } else {
//       sharpInstance = sharpInstance.jpeg({
//         quality: variant.quality,
//         progressive: true,
//         mozjpeg: true,
//         optimizeScans: true
//       });
//     }

//     // 🚀 PROCESS: Convert to buffer
//     const processedBuffer = await sharpInstance.toBuffer();
//     const processedMetadata = await sharp(processedBuffer).metadata();

//     // 🚀 UPLOAD: To ImageKit
//     const fileName = `${mediaId}_${variant.name}.${variant.format}`;
//     const uploadResult = await imagekit.upload({
//       file: processedBuffer,
//       fileName,
//       folder: `/events/${eventId}/variants`,
//       useUniqueFileName: false,
//       tags: [variant.name, variant.format, eventId],
//       transformation: {
//         pre: 'q_auto,f_auto'
//       }
//     });

//     logger.debug(`✅ Uploaded variant: ${fileName} (${this.bytesToMB(processedBuffer.length)}MB)`);

//     return {
//       name: variant.name,
//       url: uploadResult.url,
//       width: processedMetadata.width!,
//       height: processedMetadata.height!,
//       size_mb: this.bytesToMB(processedBuffer.length),
//       format: variant.format
//     };
//   }

//   /**
//    * 🚀 UPLOAD ORIGINAL: Optimized original upload
//    */
//   private async uploadOriginal(
//     buffer: Buffer,
//     jobData: ImageProcessingJobData
//   ): Promise<{ url: string; size: number }> {

//     const fileName = `${jobData.mediaId}_original${path.extname(jobData.originalFilename)}`;

//     const result = await imagekit.upload({
//       file: buffer,
//       fileName,
//       folder: `/events/${jobData.eventId}/originals`,
//       useUniqueFileName: false,
//       tags: ['original', jobData.eventId],
//       transformation: {
//         pre: 'q_90,f_auto'
//       }
//     });

//     logger.debug(`✅ Uploaded original: ${fileName} (${this.bytesToMB(buffer.length)}MB)`);

//     return { url: result.url, size: buffer.length };
//   }

//   /**
//    * 🚀 ORGANIZE: Convert to your schema structure (small/medium/large)
//    */
//   private organizeVariantsForYourSchema(variants: (ProcessedImageVariant & { name: string })[]) {
//     const organized = {
//       small: { webp: null as ProcessedImageVariant | null, jpeg: null as ProcessedImageVariant | null },
//       medium: { webp: null as ProcessedImageVariant | null, jpeg: null as ProcessedImageVariant | null },
//       large: { webp: null as ProcessedImageVariant | null, jpeg: null as ProcessedImageVariant | null }
//     };

//     variants.forEach(variant => {
//       const { name, ...variantData } = variant;

//       if ((name === 'small' || name === 'medium' || name === 'large') &&
//         (variantData.format === 'webp' || variantData.format === 'jpeg')) {
//         organized[name][variantData.format] = variantData;
//       }
//     });

//     // 🔧 VALIDATION: Ensure all variants exist
//     const sizeNames: Array<keyof typeof organized> = ['small', 'medium', 'large'];
//     for (const sizeName of sizeNames) {
//       const formats = organized[sizeName];
//       if (!formats.webp || !formats.jpeg) {
//         logger.warn(`⚠️ Missing variant: ${sizeName} - some formats may be incomplete`);
//       }
//     }

//     return organized;
//   }

//   /**
//    * 🛠️ UTILITIES
//    */
//   private bytesToMB(bytes: number): number {
//     return Math.round((bytes / (1024 * 1024)) * 100) / 100;
//   }

//   /**
//    * 🔧 VALIDATION: Check if file is processable
//    */
//   isValidImageFormat(file: Express.Multer.File): boolean {
//     const supportedMimeTypes = [
//       'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
//       'image/heic', 'image/heif', 'image/tiff', 'image/tif'
//     ];
//     return supportedMimeTypes.includes(file.mimetype.toLowerCase());
//   }

//   /**
//    * 🔧 ESTIMATION: Processing time estimate
//    */
//   getEstimatedProcessingTime(fileSizeBytes: number): number {
//     const sizeMB = this.bytesToMB(fileSizeBytes);
//     return Math.max(3, Math.min(sizeMB * 1.2, 20)); // 3-20 seconds
//   }
// }

// // 🚀 SINGLETON: Export single instance
// export const imageProcessingService = new OptimizedImageProcessingService();

// /**
//  * 🚀 HELPER FUNCTIONS: Compatible with your schema
//  */
// export const calculateVariantsCount = (variants: any): number => {
//   if (!variants || typeof variants !== 'object') return 0;

//   let count = 0;
//   // Count small/medium/large variants
//   for (const size of ['small', 'medium', 'large']) {
//     if (variants[size]) {
//       if (variants[size].webp) count++;
//       if (variants[size].jpeg) count++;
//     }
//   }
//   return count;
// };

// export const calculateTotalVariantsSize = (variants: any): number => {
//   if (!variants || typeof variants !== 'object') return 0;

//   let total = 0;
//   // Calculate size for small/medium/large variants
//   for (const size of ['small', 'medium', 'large']) {
//     if (variants[size]) {
//       if (variants[size].webp?.size_mb) total += variants[size].webp.size_mb;
//       if (variants[size].jpeg?.size_mb) total += variants[size].jpeg.size_mb;
//     }
//   }
//   return Math.round(total * 100) / 100;
// };
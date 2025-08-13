// // services/cleanupService.ts - ENHANCED with startup cleanup

// import fs from 'fs/promises';
// import path from 'path';
// import { logger } from '@utils/logger';

// /**
//  * 🧹 CLEANUP SERVICE: Remove old temporary files automatically
//  */
// export class CleanupService {
//   private uploadDir: string;
//   private tempDir: string;
//   private maxAge: number; // in milliseconds
//   private cleanupInterval: NodeJS.Timeout | null = null;

//   constructor(
//     uploadDir: string = './uploads',
//     tempDir: string = './uploads/temp',
//     maxAgeHours: number = 2 // Clean files older than 2 hours
//   ) {
//     this.uploadDir = uploadDir;
//     this.tempDir = tempDir;
//     this.maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
//   }

//   /**
//    * 🚀 START: Begin automatic cleanup
//    */
//   public async startCleanup(): Promise<void> {
//     // 🧹 IMMEDIATE: Clean orphaned files from main uploads folder
//     await this.cleanOrphanedFiles();

//     // 🧹 TEMP: Clean old temp files
//     await this.performCleanup();

//     // Then clean every 30 minutes
//     this.cleanupInterval = setInterval(() => {
//       this.performCleanup();
//     }, 30 * 60 * 1000); // 30 minutes

//     logger.info('✅ Cleanup service started - will clean temp files every 30 minutes');
//   }

//   /**
//    * 🧹 STARTUP: Clean orphaned files from main uploads directory
//    * These are the files you see in VS Code with random names
//    */
//   private async cleanOrphanedFiles(): Promise<void> {
//     try {
//       logger.info('🔍 Checking for orphaned files in uploads directory...');
      
//       // Check if upload directory exists
//       try {
//         await fs.access(this.uploadDir);
//       } catch {
//         logger.info('📁 Upload directory does not exist, nothing to clean');
//         return;
//       }

//       const files = await fs.readdir(this.uploadDir);
//       let deletedCount = 0;
//       let totalSize = 0;

//       for (const file of files) {
//         const filePath = path.join(this.uploadDir, file);

//         try {
//           const stats = await fs.stat(filePath);

//           // Skip directories (like 'temp' folder)
//           if (stats.isDirectory()) continue;

//           // 🔧 IDENTIFY ORPHANED FILES: Files with random names (no extension or temp-like names)
//           const isOrphanedFile = (
//             // Files with no extension and random-looking names
//             (!path.extname(file) && file.length > 20) ||
//             // Files that look like multer temp files
//             /^[a-f0-9]{32}$/.test(file) ||
//             // Any file older than 1 hour in main uploads (should be processed by now)
//             (Date.now() - stats.mtime.getTime()) > (60 * 60 * 1000)
//           );

//           if (isOrphanedFile) {
//             await fs.unlink(filePath);
//             deletedCount++;
//             totalSize += stats.size;
            
//             logger.info(`🗑️ Removed orphaned file: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
//           }
//         } catch (error) {
//           // File might have been deleted by another process, ignore
//           logger.debug(`Could not process file ${file}:`, error);
//         }
//       }

//       if (deletedCount > 0) {
//         logger.info(`🧹 Startup cleanup: ${deletedCount} orphaned files removed, ${(totalSize / 1024 / 1024).toFixed(2)}MB freed`);
//       } else {
//         logger.info('✅ No orphaned files found in uploads directory');
//       }

//     } catch (error) {
//       logger.error('❌ Failed to clean orphaned files:', error);
//     }
//   }

//   /**
//    * 🛑 STOP: Stop automatic cleanup
//    */
//   public stopCleanup(): void {
//     if (this.cleanupInterval) {
//       clearInterval(this.cleanupInterval);
//       this.cleanupInterval = null;
//       logger.info('🛑 Cleanup service stopped');
//     }
//   }

//   /**
//    * 🧹 PERFORM: Actually clean old files
//    */
//   private async performCleanup(): Promise<void> {
//     try {
//       const stats = await this.cleanOldFiles();
//       if (stats.deleted > 0) {
//         logger.info(`🧹 Cleanup completed: ${stats.deleted} files deleted, ${stats.totalSize}MB freed`);
//       }
//     } catch (error) {
//       logger.error('❌ Cleanup failed:', error);
//     }
//   }

//   /**
//    * 🔍 SCAN: Find and delete old files from temp directory
//    */
//   private async cleanOldFiles(): Promise<{ deleted: number; totalSize: number }> {
//     try {
//       // Check if temp directory exists
//       try {
//         await fs.access(this.tempDir);
//       } catch {
//         // Directory doesn't exist, nothing to clean
//         return { deleted: 0, totalSize: 0 };
//       }

//       const files = await fs.readdir(this.tempDir);
//       const now = Date.now();
//       let deletedCount = 0;
//       let totalSize = 0;

//       for (const file of files) {
//         const filePath = path.join(this.tempDir, file);

//         try {
//           const stats = await fs.stat(filePath);

//           // Skip directories
//           if (stats.isDirectory()) continue;

//           // Check if file is old enough to delete
//           const fileAge = now - stats.mtime.getTime();
//           if (fileAge > this.maxAge) {
//             // Delete old file
//             await fs.unlink(filePath);
//             deletedCount++;
//             totalSize += stats.size;
            
//             logger.debug(`🗑️ Deleted old temp file: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB, ${Math.round(fileAge / 1000 / 60)} min old)`);
//           }
//         } catch (error) {
//           // File might have been deleted by another process, ignore
//           logger.debug(`Could not process file ${file}:`, error);
//         }
//       }

//       return {
//         deleted: deletedCount,
//         totalSize: Math.round((totalSize / 1024 / 1024) * 100) / 100 // Convert to MB
//       };

//     } catch (error) {
//       logger.error('Error during file cleanup:', error);
//       return { deleted: 0, totalSize: 0 };
//     }
//   }

//   /**
//    * 🧹 MANUAL: Clean up immediately (for manual triggers)
//    */
//   public async cleanupNow(): Promise<{ deleted: number; totalSize: number }> {
//     logger.info('🧹 Manual cleanup triggered...');
//     return await this.cleanOldFiles();
//   }

//   /**
//    * 📊 STATS: Get current upload directory stats
//    */
//   public async getUploadDirStats(): Promise<{
//     totalFiles: number;
//     totalSizeMB: number;
//     oldestFileAge: string;
//   }> {
//     try {
//       const files = await fs.readdir(this.uploadDir);
//       let totalSize = 0;
//       let oldestTime = Date.now();
//       let fileCount = 0;

//       for (const file of files) {
//         const filePath = path.join(this.uploadDir, file);
//         try {
//           const stats = await fs.stat(filePath);
//           if (stats.isFile()) {
//             fileCount++;
//             totalSize += stats.size;
//             oldestTime = Math.min(oldestTime, stats.mtime.getTime());
//           }
//         } catch {
//           // Ignore files that can't be read
//         }
//       }

//       const oldestAge = fileCount > 0 
//         ? Math.round((Date.now() - oldestTime) / 1000 / 60) + ' minutes'
//         : 'No files';

//       return {
//         totalFiles: fileCount,
//         totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
//         oldestFileAge: oldestAge
//       };
//     } catch (error) {
//       logger.error('Error getting upload directory stats:', error);
//       return { totalFiles: 0, totalSizeMB: 0, oldestFileAge: 'Error' };
//     }
//   }
// }

// // 🚀 SINGLETON: Export single instance with proper paths
// export const cleanupService = new CleanupService(
//   process.env.UPLOAD_DIR || './uploads',
//   process.env.TEMP_UPLOAD_DIR || './uploads/temp',
//   parseInt(process.env.CLEANUP_MAX_AGE_HOURS || '2')
// );

// /**
//  * 🔧 STARTUP: Start cleanup service automatically
//  */
// export async function initializeCleanupService(): Promise<void> {
//   await cleanupService.startCleanup();

//   // Graceful shutdown
//   process.on('SIGTERM', () => {
//     cleanupService.stopCleanup();
//   });

//   process.on('SIGINT', () => {
//     cleanupService.stopCleanup();
//     process.exit(0);
//   });
// }

// /**
//  * 🚀 ENDPOINT: Manual cleanup for admin
//  */
// export async function manualCleanupEndpoint(req: any, res: any) {
//   try {
//     const result = await cleanupService.cleanupNow();
//     const stats = await cleanupService.getUploadDirStats();

//     res.json({
//       status: true,
//       message: 'Cleanup completed',
//       cleanup: result,
//       currentStats: stats
//     });
//   } catch (error: any) {
//     res.status(500).json({
//       status: false,
//       message: 'Cleanup failed',
//       error: error.message
//     });
//   }
// }
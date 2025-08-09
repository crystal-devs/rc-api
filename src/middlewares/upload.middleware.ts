// middleware/upload.middleware.ts - FIXED Multer config

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';
import { logger } from '@utils/logger';

// 🔧 PROPER TEMP DIRECTORY: Separate from main uploads
const tempUploadDir = process.env.TEMP_UPLOAD_DIR || './uploads/temp';

// 🚀 ENSURE TEMP DIRECTORY EXISTS
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
  logger.info(`📁 Created temp upload directory: ${tempUploadDir}`);
}

// 🚀 OPTIMIZED MULTER CONFIG: Use proper temp directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 🔧 IMPORTANT: Use temp directory, not main uploads folder
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    // 🔧 UNIQUE FILENAME: Add timestamp + random for uniqueness
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `temp_${uniqueSuffix}${ext}`;
    
    logger.debug(`📎 Temp file created: ${filename}`);
    cb(null, filename);
  }
});

// 🚀 OPTIMIZED UPLOAD: Handle large files efficiently
export const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // 🔧 COMBINED: Validation + logging in one place
    logger.debug(`Processing file: ${file.originalname} (${file.mimetype})`);
    
    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'image/heic', 'image/heif', 'image/tiff', 'image/tif'
    ];
    
    if (allowedMimes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      logger.warn(`❌ Rejected file type: ${file.mimetype} for file: ${file.originalname}`);
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
    files: 10, // Max 10 files per request
    fieldSize: 2 * 1024 * 1024, // 2MB for form fields
    parts: 20 // Max 20 parts in multipart
  }
});

// 🚀 MIDDLEWARE: Check file size limit per user
export const checkFileSizeLimitMiddleware = (req: any, res: any, next: any) => {
  try {
    const files = req.files as Express.Multer.File[] || [];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const totalSizeMB = totalSize / (1024 * 1024);
    
    // 🔧 DIFFERENT LIMITS: Based on user subscription
    const userRole = req.user?.role || 'free';
    const limits = {
      free: 50,      // 50MB total per upload
      premium: 200,  // 200MB total per upload
      pro: 500      // 500MB total per upload
    };
    
    const limit = limits[userRole as keyof typeof limits] || limits.free;
    
    if (totalSizeMB > limit) {
      // 🧹 CLEANUP: Remove temp files if limit exceeded
      cleanupTempFiles(files);
      
      return res.status(413).json({
        status: false,
        message: `Total upload size (${totalSizeMB.toFixed(1)}MB) exceeds limit (${limit}MB) for ${userRole} users`,
        upgrade_required: userRole === 'free'
      });
    }
    
    logger.info(`Upload size check passed: ${totalSizeMB.toFixed(1)}MB / ${limit}MB`);
    next();
    
  } catch (error) {
    logger.error('File size check error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to check file size limits'
    });
  }
};

// 🧹 CLEANUP HELPER: Remove temp files immediately
async function cleanupTempFiles(files: Express.Multer.File[]): Promise<void> {
  for (const file of files) {
    try {
      if (file.path && fs.existsSync(file.path)) {
        await fs.promises.unlink(file.path);
        logger.debug(`🗑️ Cleaned up temp file: ${file.path}`);
      }
    } catch (error) {
      logger.warn(`Failed to cleanup temp file ${file.path}:`, error);
    }
  }
}

// 🚀 MIDDLEWARE: Check storage quota
export const checkStorageLimitMiddleware = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user._id;
    const files = req.files as Express.Multer.File[] || [];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    // 🔧 QUICK QUERY: Check user's current storage usage
    const currentUsage = await getUserStorageUsage(userId);
    const userLimits = getUserStorageLimits(req.user.role);
    
    if (currentUsage + totalSize > userLimits.totalStorage) {
      // 🧹 CLEANUP: Remove temp files if quota exceeded
      await cleanupTempFiles(files);
      
      const availableSpace = userLimits.totalStorage - currentUsage;
      return res.status(507).json({
        status: false,
        message: 'Storage quota exceeded',
        storage_info: {
          current_usage_mb: Math.round(currentUsage / (1024 * 1024)),
          limit_mb: Math.round(userLimits.totalStorage / (1024 * 1024)),
          available_mb: Math.round(availableSpace / (1024 * 1024))
        },
        upgrade_required: true
      });
    }
    
    next();
    
  } catch (error) {
    logger.error('Storage limit check error:', error);
    // Don't fail upload on storage check error
    next();
  }
};

// 🚀 MIDDLEWARE: Check event photo limits
export const checkEventPhotoLimitMiddleware = async (req: any, res: any, next: any) => {
  try {
    const { event_id } = req.body;
    const files = req.files as Express.Multer.File[] || [];
    
    if (!event_id) {
      return next(); // Let controller handle this validation
    }
    
    // 🔧 QUICK COUNT: Check current photos in event
    const currentPhotoCount = await getEventPhotoCount(event_id);
    const eventLimits = getEventPhotoLimits();
    
    if (currentPhotoCount + files.length > eventLimits.maxPhotos) {
      // 🧹 CLEANUP: Remove temp files if limit exceeded
      await cleanupTempFiles(files);
      
      return res.status(429).json({
        status: false,
        message: `Event photo limit exceeded. Current: ${currentPhotoCount}, Adding: ${files.length}, Limit: ${eventLimits.maxPhotos}`,
        limit_info: {
          current_photos: currentPhotoCount,
          max_photos: eventLimits.maxPhotos,
          remaining: Math.max(0, eventLimits.maxPhotos - currentPhotoCount)
        }
      });
    }
    
    next();
    
  } catch (error) {
    logger.error('Event photo limit check error:', error);
    // Don't fail upload on limit check error
    next();
  }
};

/**
 * 🛠️ HELPER FUNCTIONS: Implement based on your data model
 */

async function getUserStorageUsage(userId: string): Promise<number> {
  try {
    // TODO: Implement efficient query to get user's total storage usage
    return 0; // Placeholder
  } catch (error) {
    logger.error('Error getting user storage usage:', error);
    return 0;
  }
}

function getUserStorageLimits(userRole: string = 'free') {
  const limits = {
    free: {
      totalStorage: 1 * 1024 * 1024 * 1024,     // 1GB
      maxFileSize: 50 * 1024 * 1024,            // 50MB
      maxFilesPerUpload: 5
    },
    premium: {
      totalStorage: 10 * 1024 * 1024 * 1024,    // 10GB
      maxFileSize: 100 * 1024 * 1024,           // 100MB
      maxFilesPerUpload: 10
    },
    pro: {
      totalStorage: 100 * 1024 * 1024 * 1024,   // 100GB
      maxFileSize: 500 * 1024 * 1024,           // 500MB
      maxFilesPerUpload: 20
    }
  };
  
  return limits[userRole as keyof typeof limits] || limits.free;
}

async function getEventPhotoCount(eventId: string): Promise<number> {
  try {
    // TODO: Implement efficient count query
    return 0; // Placeholder
  } catch (error) {
    logger.error('Error getting event photo count:', error);
    return 0;
  }
}

function getEventPhotoLimits() {
  return {
    maxPhotos: parseInt(process.env.MAX_PHOTOS_PER_EVENT || '1000'),
    maxVideos: parseInt(process.env.MAX_VIDEOS_PER_EVENT || '100')
  };
}
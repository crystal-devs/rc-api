// middleware/upload.middleware.ts - OPTIMIZED for large files

import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { logger } from '@utils/logger';

// 🚀 OPTIMIZED MULTER CONFIG: Handle large files efficiently
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create uploads directory if it doesn't exist
    const uploadDir = process.env.UPLOAD_DIR || './uploads/temp';
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 🔧 UNIQUE FILENAME: Prevent conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `img_${uniqueSuffix}${ext}`);
  }
});

// 🔧 FILE FILTER: Only allow images
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'image/heic', 'image/heif', 'image/tiff', 'image/tif'
  ];
  
  logger.debug(`Processing file: ${file.originalname} (${file.mimetype})`);
  
  if (allowedMimes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
};

// 🚀 OPTIMIZED UPLOAD: Handle large files with progress
export const upload = multer({
  storage,
  fileFilter,
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

// 🚀 MIDDLEWARE: Check storage quota
export const checkStorageLimitMiddleware = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user._id;
    const files = req.files as Express.Multer.File[] || [];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    // 🔧 QUICK QUERY: Check user's current storage usage
    // You should implement this based on your storage tracking
    const currentUsage = await getUserStorageUsage(userId);
    const userLimits = getUserStorageLimits(req.user.role);
    
    if (currentUsage + totalSize > userLimits.totalStorage) {
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
    // Example with MongoDB aggregation:
    /*
    const result = await Media.aggregate([
      { $match: { uploaded_by: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, totalSize: { $sum: "$size_mb" } } }
    ]);
    return (result[0]?.totalSize || 0) * 1024 * 1024; // Convert MB to bytes
    */
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
    // Example:
    /*
    const count = await Media.countDocuments({
      event_id: new mongoose.Types.ObjectId(eventId),
      type: 'image'
    });
    return count;
    */
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
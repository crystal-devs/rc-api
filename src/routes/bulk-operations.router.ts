// routes/bulk-operations.router.ts
import { BulkOperationsController } from '@controllers/bulk-operations.controller';
import { authMiddleware } from '@middlewares/clicky-auth.middleware';
import express, { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { injectedRequest } from 'types/injected-types';

const bulkOperationsRouter = express.Router();

// Rate limiting middleware for bulk status updates
const bulkStatusUpdateLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 30, // Max 30 bulk operations per window per user
  message: {
    success: false,
    message: 'Too many bulk operations. Please wait 2 minutes before trying again.',
    code: 'BULK_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // Custom key generator for authenticated users
  keyGenerator: (req: injectedRequest) => {
    const authHeader = req.headers.authorization;
    const userId = req.user?._id;

    if (userId) {
      return `user_${userId}`;
    } else if (authHeader) {
      return `auth_${authHeader.slice(-10)}`;
    } else {
      return req.ip;
    }
  }
});

// Rate limiter for bulk delete operations (more restrictive)
const bulkDeleteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Max 10 bulk delete operations per window
  message: {
    success: false,
    message: 'Too many bulk delete requests. Please wait 5 minutes before trying again.',
    code: 'BULK_DELETE_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req: injectedRequest) => {
    const userId = req.user?._id;
    return userId ? `delete_user_${userId}` : `delete_${req.ip}`;
  }
});

// General rate limiter for status checks and smaller operations
const generalBulkLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Max 60 requests per minute
  message: {
    success: false,
    message: 'Too many requests',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Routes with authentication and rate limiting

// Bulk status update for media
bulkOperationsRouter.patch(
  '/media/event/:event_id/status',
  authMiddleware,
  bulkStatusUpdateLimiter,
  BulkOperationsController.bulkUpdateMediaStatus as RequestHandler
);

// Bulk delete media (if needed in future)
bulkOperationsRouter.delete(
  '/media/event/:event_id/delete',
  authMiddleware,
  bulkDeleteLimiter,
  BulkOperationsController.bulkDeleteMedia as RequestHandler
);

// Bulk approve media (convenience endpoint)
bulkOperationsRouter.patch(
  '/media/event/:event_id/approve',
  authMiddleware,
  bulkStatusUpdateLimiter,
  BulkOperationsController.bulkApproveMedia as RequestHandler
);

// Bulk reject media (convenience endpoint)
bulkOperationsRouter.patch(
  '/media/event/:event_id/reject',
  authMiddleware,
  bulkStatusUpdateLimiter,
  BulkOperationsController.bulkRejectMedia as RequestHandler
);

// Bulk hide media (convenience endpoint)
bulkOperationsRouter.patch(
  '/media/event/:event_id/hide',
  authMiddleware,
  bulkStatusUpdateLimiter,
  BulkOperationsController.bulkHideMedia as RequestHandler
);

// Get bulk operation status/history
bulkOperationsRouter.get(
  '/operations/history',
  authMiddleware,
  generalBulkLimiter,
  BulkOperationsController.getBulkOperationHistory as RequestHandler
);

// Health check for bulk operations
bulkOperationsRouter.get(
  '/health',
  BulkOperationsController.healthCheck
);

export default bulkOperationsRouter;
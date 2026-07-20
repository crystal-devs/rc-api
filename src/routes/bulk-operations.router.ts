// routes/bulk-operations.router.ts
import { BulkOperationsController } from '@controllers/bulk-operations.controller';
import { authMiddleware } from '@middlewares/clicky-auth.middleware';
import express, { RequestHandler } from 'express';

import { injectedRequest } from 'types/injected-types';

const bulkOperationsRouter = express.Router();

import {
  bulkOperationsRateLimiter,
  bulkDeleteRateLimiter,
  generalBulkRateLimiter
} from '@configs/security.config';

// Routes with authentication and rate limiting

// Bulk status update for media
bulkOperationsRouter.patch(
  '/media/event/:event_id/status',
  authMiddleware,
  bulkOperationsRateLimiter,
  BulkOperationsController.bulkUpdateMediaStatus as RequestHandler
);

// Bulk delete media (if needed in future)
bulkOperationsRouter.delete(
  '/media/event/:event_id/delete',
  authMiddleware,
  bulkDeleteRateLimiter,
  BulkOperationsController.bulkDeleteMedia as RequestHandler
);

// Bulk approve media (convenience endpoint)
bulkOperationsRouter.patch(
  '/media/event/:event_id/approve',
  authMiddleware,
  bulkOperationsRateLimiter,
  BulkOperationsController.bulkApproveMedia as RequestHandler
);

// Bulk reject media (convenience endpoint)
bulkOperationsRouter.patch(
  '/media/event/:event_id/reject',
  authMiddleware,
  bulkOperationsRateLimiter,
  BulkOperationsController.bulkRejectMedia as RequestHandler
);

// Bulk hide media (convenience endpoint)
bulkOperationsRouter.patch(
  '/media/event/:event_id/hide',
  authMiddleware,
  bulkOperationsRateLimiter,
  BulkOperationsController.bulkHideMedia as RequestHandler
);

// Get bulk operation status/history
bulkOperationsRouter.get(
  '/operations/history',
  authMiddleware,
  generalBulkRateLimiter,
  BulkOperationsController.getBulkOperationHistory as RequestHandler
);

// Health check for bulk operations
bulkOperationsRouter.get(
  '/health',
  BulkOperationsController.healthCheck
);

export default bulkOperationsRouter;
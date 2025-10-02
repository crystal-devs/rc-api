// routes/index.ts or app.ts - ADD THESE ROUTES

// routes/upload-queue.routes.ts
import express from 'express';
import {
  cancelUploadController,
  clearQueueHistoryController,
  getQueueStatsController,
  getUploadQueueController,
  pauseResumeUploadController,
  retryUploadController
} from '@controllers/upload-queue.controller';

const uploadQueueRouter = express.Router();

// Ensure async controllers conform to Express's RequestHandler typing
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// GET /api/v1/upload-queue/events/:eventId - Get queue items
uploadQueueRouter.get('/events/:eventId', wrap(getUploadQueueController));

// GET /api/v1/upload-queue/events/:eventId/stats - Get queue statistics
uploadQueueRouter.get('/events/:eventId/stats', wrap(getQueueStatsController));

// POST /api/v1/upload-queue/events/:eventId/:mediaId/retry - Retry failed upload
uploadQueueRouter.post('/events/:eventId/:mediaId/retry', wrap(retryUploadController));

// POST /api/v1/upload-queue/events/:eventId/:mediaId/pause-resume - Pause/Resume upload
uploadQueueRouter.post('/events/:eventId/:mediaId/pause-resume', wrap(pauseResumeUploadController));

// DELETE /api/v1/upload-queue/events/:eventId/:mediaId/cancel - Cancel upload
uploadQueueRouter.delete('/events/:eventId/:mediaId/cancel', wrap(cancelUploadController));

// DELETE /api/v1/upload-queue/events/:eventId/history - Clear old completed/failed items
uploadQueueRouter.delete('/events/:eventId/history', wrap(clearQueueHistoryController));

export default uploadQueueRouter;

// ✅ OR if you're adding directly to app.ts:
/*
app.get('/api/events/:eventId/upload-queue', authenticateToken, getUploadQueueController);
app.get('/api/events/:eventId/upload-queue/stats', authenticateToken, getQueueStatsController);
app.post('/api/events/:eventId/upload-queue/:mediaId/retry', authenticateToken, retryUploadController);
app.post('/api/events/:eventId/upload-queue/:mediaId/pause-resume', authenticateToken, pauseResumeUploadController);
app.delete('/api/events/:eventId/upload-queue/:mediaId/cancel', authenticateToken, cancelUploadController);
app.delete('/api/events/:eventId/upload-queue/history', authenticateToken, clearQueueHistoryController);
*/
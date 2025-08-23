// routes/index.ts or app.ts - ADD THESE ROUTES

import { cancelUploadController, clearQueueHistoryController, getQueueStatsController, getUploadQueueController, pauseResumeUploadController, retryUploadController } from '@controllers/upload-queue.controller';
import express from 'express';


const router = express.Router();

// ✅ ADD THESE ROUTES to your existing routes:

// All queue routes require authentication
router.use('/events/:eventId/upload-queue', authenticateToken);

// GET /api/events/:eventId/upload-queue - Get queue items
router.get('/events/:eventId/upload-queue', getUploadQueueController);

// GET /api/events/:eventId/upload-queue/stats - Get queue statistics
router.get('/events/:eventId/upload-queue/stats', getQueueStatsController);

// POST /api/events/:eventId/upload-queue/:mediaId/retry - Retry failed upload
router.post('/events/:eventId/upload-queue/:mediaId/retry', retryUploadController);

// POST /api/events/:eventId/upload-queue/:mediaId/pause-resume - Pause/Resume upload
router.post('/events/:eventId/upload-queue/:mediaId/pause-resume', pauseResumeUploadController);

// DELETE /api/events/:eventId/upload-queue/:mediaId/cancel - Cancel upload
router.delete('/events/:eventId/upload-queue/:mediaId/cancel', cancelUploadController);

// DELETE /api/events/:eventId/upload-queue/history - Clear old completed/failed items
router.delete('/events/:eventId/upload-queue/history', clearQueueHistoryController);

export default router;

// ✅ OR if you're adding directly to app.ts:
/*
app.get('/api/events/:eventId/upload-queue', authenticateToken, getUploadQueueController);
app.get('/api/events/:eventId/upload-queue/stats', authenticateToken, getQueueStatsController);
app.post('/api/events/:eventId/upload-queue/:mediaId/retry', authenticateToken, retryUploadController);
app.post('/api/events/:eventId/upload-queue/:mediaId/pause-resume', authenticateToken, pauseResumeUploadController);
app.delete('/api/events/:eventId/upload-queue/:mediaId/cancel', authenticateToken, cancelUploadController);
app.delete('/api/events/:eventId/upload-queue/history', authenticateToken, clearQueueHistoryController);
*/
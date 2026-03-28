// src/routes/v1/sse.routes.ts
import { Router, Request, Response } from 'express';
import { sseService } from '../../services/sse/sse.service';

const router = Router();

/**
 * SSE endpoint for upload-progress.
 * Admins subscribe to this to see real-time progress for all active uploads.
 * This reduces WebSocket overhead for high-frequency progress updates.
 */
router.get('/upload-progress/:eventId', (req: Request, res: Response) => {
  const eventId = req.params.eventId;
  if (!eventId) {
    res.status(400).json({ error: 'eventId is required' });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Keep connection open
  res.write('\n'); // Flush buffer

  // Subscribe client to sseService for this eventId
  sseService.addClient(eventId, res);
});

export default router;

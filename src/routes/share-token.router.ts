import { Router } from 'express';
import * as shareTokenController from '@controllers/share-token.controller';
import { authMiddleware } from '@middlewares/clicky-auth.middleware';

const shareRouter = Router();

// Protected routes (require authentication)
shareRouter.post('/create', authMiddleware, shareTokenController.createEventShareTokenController); // Use frontend-compatible controller
shareRouter.post('/event/:eventId/share', authMiddleware, shareTokenController.createEventShareTokenController); // Frontend compatibility
shareRouter.post('/events/:eventId/share', authMiddleware, shareTokenController.createEventShareTokenController); // Frontend compatibility
shareRouter.get('/event/:event_id', authMiddleware, shareTokenController.getEventShareTokensController);
shareRouter.delete('/:token_id/revoke', authMiddleware, shareTokenController.revokeShareTokenController);

// Public routes (no authentication required)
shareRouter.post('/validate', shareTokenController.validateShareTokenController);
shareRouter.post('/shared/:token', shareTokenController.getSharedEventController);
shareRouter.get('/album/:album_id/:token', shareTokenController.getSharedAlbumMediaController);

export default shareRouter;

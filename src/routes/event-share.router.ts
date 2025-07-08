import { Router } from 'express';
import * as shareTokenController from '@controllers/share-token.controller';
import { authMiddleware } from '@middlewares/clicky-auth.middleware';

const eventShareRouter = Router();

// Route specifically for frontend compatibility
// eventShareRouter.post('/:eventId/share', authMiddleware, shareTokenController.createEventShareTokenController);

export default eventShareRouter;

// routes/guestSessionRoutes.ts
import { claimGuestContentController, getClaimableSummaryController } from '@controllers/guest-session.controller';
import { authMiddleware } from '@middlewares/clicky-auth.middleware';
import express from 'express';


const guestRouter = express.Router();

// Get claimable content summary (requires auth)
guestRouter.get(
    '/claimable/:eventId',
    authMiddleware,
    getClaimableSummaryController
);

// Claim guest content (requires auth)
guestRouter.post(
    '/claim/:eventId',
    authMiddleware,
    claimGuestContentController
);

export default guestRouter;
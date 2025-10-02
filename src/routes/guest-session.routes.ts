// routes/guestSessionRoutes.ts
import { claimGuestContentController, getClaimableSummaryController } from '@controllers/guest-session.controller';
import { authMiddleware } from '@middlewares/clicky-auth.middleware';
import express from 'express';


const router = express.Router();

// Get claimable content summary (requires auth)
router.get(
    '/claimable/:eventId',
    authMiddleware,
    getClaimableSummaryController
);

// Claim guest content (requires auth)
router.post(
    '/claim/:eventId',
    authMiddleware,
    claimGuestContentController
);

export default router;
import express from "express";
import * as shareTokenController from "@controllers/share-token.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { 
    eventAccessMiddleware, 
    requireGuestManagementAccess, 
    tokenBasedEventAccessMiddleware,
    publicTokenAccessMiddleware
} from "@middlewares/event-access.middleware";

const shareTokenRouter = express.Router();

// Apply authentication middleware to protected routes only, not to all routes
// We'll apply auth middleware individually to each route that requires it

// ============= SHARE TOKEN MANAGEMENT =============
// Get all share tokens for an event
shareTokenRouter.get("/:event_id/tokens", 
    authMiddleware,
    eventAccessMiddleware,
    requireGuestManagementAccess,
    shareTokenController.getEventShareTokensController
);

// Create new share token
shareTokenRouter.post("/event/:event_id/tokens", 
    authMiddleware,
    eventAccessMiddleware,
    requireGuestManagementAccess,
    shareTokenController.createShareTokenController
);

// Get specific share token details
shareTokenRouter.get("/:token_id", 
    publicTokenAccessMiddleware,
    shareTokenController.getShareTokenDetailsController
);

// Update share token
shareTokenRouter.patch("/:token_id", 
    authMiddleware,
    tokenBasedEventAccessMiddleware,
    requireGuestManagementAccess,
    shareTokenController.updateShareTokenController
);

// Revoke share token
shareTokenRouter.delete("/:token_id", 
    authMiddleware,
    tokenBasedEventAccessMiddleware,
    requireGuestManagementAccess,
    shareTokenController.revokeShareTokenController
);

// Get share token usage analytics
shareTokenRouter.get("/:token_id/analytics", 
    authMiddleware,
    tokenBasedEventAccessMiddleware,
    shareTokenController.getTokenAnalyticsController
);

// ============= PUBLIC TOKEN ACCESS =============
// Join event via share token (no auth required)
shareTokenRouter.post("/join/:token", 
    shareTokenController.joinEventViaTokenController
);

// Get token info (for join page preview)
shareTokenRouter.get("/info/:token", 
    shareTokenController.getTokenInfoController
);

export default shareTokenRouter;
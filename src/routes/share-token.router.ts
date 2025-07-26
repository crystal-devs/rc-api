import express from "express";
import * as shareTokenController from "@controllers/share-token.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { 
    tokenAccessMiddleware
} from "@middlewares/event-access.middleware";
import { optionalAuthMiddleware } from "@middlewares/conditional-auth.middleware";

const shareTokenRouter = express.Router();

// Apply authentication middleware to protected routes only, not to all routes
// We'll apply auth middleware individually to each route that requires it

// ============= SHARE TOKEN MANAGEMENT =============
// Get all share tokens for an event

// Get specific share token details
shareTokenRouter.get("/:token_id", 
    optionalAuthMiddleware,
    tokenAccessMiddleware,
    shareTokenController.getShareTokenDetailsController
);


export default shareTokenRouter;
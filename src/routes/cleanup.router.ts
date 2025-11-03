// routes/cleanup.router.ts
import express, { RequestHandler } from "express";
import { cleanupMediaController } from "@controllers/cleanup.controller";
import { validateLambdaToken } from "@middlewares/validateLambdaToken.middleware";

const cleanupRouter = express.Router();


/**
 * POST /admin/cleanup-media
 *
 * Cleans up deleted media documents and S3 objects
 * Can be triggered by:
 * - EventBridge Lambda (scheduled)
 * - Manual API call from dashboard
 * - Another backend service
 */
cleanupRouter.post('/admin/cleanup-media', validateLambdaToken, cleanupMediaController);

export default cleanupRouter;
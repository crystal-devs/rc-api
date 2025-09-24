// routes/photo-wall.router.ts
import express from "express";

import { getPhotoWallController, getPhotoWallStatusController, updatePhotoWallSettingsController } from "@controllers/photowall.controller";

const photoWallRouter = express.Router();

// Public endpoints (no auth needed)
photoWallRouter.get("/:shareToken", getPhotoWallController);
photoWallRouter.get("/:shareToken/status", getPhotoWallStatusController);

// Host-only endpoints (auth required)
photoWallRouter.patch("/:shareToken/settings", updatePhotoWallSettingsController);

export default photoWallRouter;
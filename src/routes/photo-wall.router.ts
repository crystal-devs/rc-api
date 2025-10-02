// routes/photo-wall.router.ts - Keep it minimal

import express from "express";
import { getPhotoWallController } from "@controllers/photowall.controller";

const photoWallRouter = express.Router();

// Single public endpoint for display
photoWallRouter.get("/:shareToken", getPhotoWallController);

export default photoWallRouter;
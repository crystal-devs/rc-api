// routes/album.routes.ts

import express from "express";
import * as albumController from "@controllers/album.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const albumRouter = express.Router();

// Apply authentication middleware to all album routes
albumRouter.use(authMiddleware);

albumRouter.post("/", albumController.createAlbumController);
albumRouter.get("/user", albumController.getUserAlbumsController);
albumRouter.get("/event/:event_id", albumController.getEventAlbumsController);

// Get, update, and delete a specific album
albumRouter.get("/:album_id", albumController.getAlbumController);
albumRouter.put("/:album_id", albumController.updateAlbumController);
albumRouter.delete("/:album_id", albumController.deleteAlbumController);

export default albumRouter;
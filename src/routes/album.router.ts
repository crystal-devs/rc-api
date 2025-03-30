import express from "express";
import * as albumController from "@controllers/album.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const albumRouter = express.Router();

albumRouter.get("/", authMiddleware, albumController.getUserAlbumsController);
albumRouter.get("/:album_id", authMiddleware, albumController.getAlbumController);
albumRouter.post("/", authMiddleware, albumController.createAlbumController);
albumRouter.put("/:album_id", authMiddleware, albumController.updateAlbumController);

export default albumRouter;

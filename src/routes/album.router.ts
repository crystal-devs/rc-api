import express from "express";
import * as albumController from "@controllers/album.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const albumRouter = express.Router();

albumRouter.use(authMiddleware)

albumRouter.get("/", albumController.getUserAlbumsController);
albumRouter.get("/:album_id", albumController.getAlbumController);
albumRouter.post("/", albumController.createAlbumController);
albumRouter.patch("/:album_id", albumController.updateAlbumController);

export default albumRouter;

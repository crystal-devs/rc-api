// routes/album.routes.ts

import express from "express";
import * as albumController from "@controllers/album.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { eventAccessMiddleware } from "@middlewares/event-access.middleware";
import { albumAccessMiddleware } from "@middlewares/resource-access.middleware";
import { authorize } from "@middlewares/authorize.middleware";

const albumRouter = express.Router();

// Apply authentication middleware to all album routes
albumRouter.use(authMiddleware);

albumRouter.post("/", albumController.createAlbumController);
albumRouter.get("/user", albumController.getUserAlbumsController);
albumRouter.get("/event/:event_id",
    eventAccessMiddleware,
    authorize('event.view'),
    albumController.getEventAlbumsController
);

// Get, update, and delete a specific album (album → event access resolution)
albumRouter.get("/:album_id",
    albumAccessMiddleware,
    authorize('event.view'),
    albumController.getAlbumController
);
albumRouter.put("/:album_id",
    albumAccessMiddleware,
    authorize('album.manage'),
    albumController.updateAlbumController
);
albumRouter.delete("/:album_id",
    albumAccessMiddleware,
    authorize('album.manage'),
    albumController.deleteAlbumController
);

export default albumRouter;
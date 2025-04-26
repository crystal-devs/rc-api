import express from "express";
import * as eventController from "@controllers/event.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const eventRouter = express.Router();

eventRouter.use(authMiddleware)

eventRouter.get("/", eventController.getUsereventsController);
eventRouter.get("/:event_id", eventController.geteventController);
eventRouter.post("/", eventController.createeventController);
eventRouter.patch("/:event_id", eventController.updateeventController);

export default eventRouter;

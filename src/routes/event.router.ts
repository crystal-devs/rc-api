import express from "express";
import * as eventController from "@controllers/event.controller";
import { createEventShareTokenController } from "@controllers/share-token.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";

const eventRouter = express.Router();

eventRouter.use(authMiddleware)

eventRouter.get("/", eventController.getUsereventsController);
eventRouter.get("/:event_id", eventController.geteventController);
eventRouter.post("/", eventController.createeventController);
eventRouter.patch("/:event_id", eventController.updateeventController);
eventRouter.delete("/:event_id", eventController.deleteEventController);
eventRouter.get("/:event_id/sharing", eventController.getEventSharingStatusController); // Get event sharing status
eventRouter.post("/:eventId/share", createEventShareTokenController); // Add endpoint for frontend share functionality

export default eventRouter;

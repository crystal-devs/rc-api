// routes/event.routes.ts
import express, { RequestHandler } from "express";
import * as eventController from "@controllers/event.controller";
import * as cohostcontroller from "@controllers/co-host.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { checkEventLimitMiddleware } from "@middlewares/subscription-limit.middleware";
import { eventAccessMiddleware } from "@middlewares/event-access.middleware";

const eventRouter = express.Router();

// Apply authentication middleware to all routes
eventRouter.use(authMiddleware);

// ============= CORE EVENT CRUD =============
// Get user's events with advanced filtering
eventRouter.get("/", eventController.getUserEventsController);

// Get specific event details
eventRouter.get("/:event_id", eventAccessMiddleware, eventController.getEventController);

// Create new event
eventRouter.post("/",
    checkEventLimitMiddleware as RequestHandler,
    eventController.createEventController
);

// Update event (only owner/co-hosts)
eventRouter.patch("/:event_id",
    eventAccessMiddleware,
    eventController.updateEventController
);

// Delete event (only owner)
eventRouter.delete("/:event_id",
    eventAccessMiddleware,
    eventController.deleteEventController
);

// ============= EVENT DISCOVERY & SEARCH =============
// Advanced search with filters
eventRouter.get("/search/query", eventController.searchEventsController);

// Get events by tag
eventRouter.get("/tags/:tag", eventController.getEventsByTagController);

// Get featured/public events
eventRouter.get("/discover/featured", eventController.getFeaturedEventsController);

// ============= EVENT ANALYTICS & STATS =============
// Get comprehensive event statistics
eventRouter.get("/:event_id/analytics",
    eventAccessMiddleware,
    eventController.getEventAnalyticsController
);

// Get real-time activity feed
eventRouter.get("/:event_id/activity",
    eventAccessMiddleware,
    eventController.getEventActivityController
);

// ============= PARTICIPANT MANAGEMENT =============
// Get event participants
// eventRouter.get("/:event_id/participants",
//     eventAccessMiddleware,
//     participantController.getEventParticipantsController
// );

// // Invite participants (bulk support)
// eventRouter.post("/:event_id/participants/invite",
//     eventAccessMiddleware,
//     participantController.inviteParticipantsController
// );

// // Update participant permissions
// eventRouter.patch("/:event_id/participants/:participant_id",
//     eventAccessMiddleware,
//     participantController.updateParticipantController
// );

// // Remove participant
// eventRouter.delete("/:event_id/participants/:participant_id",
//     eventAccessMiddleware,
//     participantController.removeParticipantController
// );

// // Get participant activity logs
// eventRouter.get("/:event_id/participants/:participant_id/activity",
//     eventAccessMiddleware,
//     participantController.getParticipantActivityController
// );

// ============= EVENT ALBUMS MANAGEMENT =============
// Get event albums
eventRouter.get("/:event_id/albums",
    eventAccessMiddleware,
    eventController.getEventAlbumsController
);

// Create album within event
eventRouter.post("/:event_id/albums",
    eventAccessMiddleware,
    eventController.createEventAlbumController
);

// ============= EVENT SETTINGS & PREFERENCES =============
// Update privacy settings
eventRouter.patch("/:event_id/privacy",
    eventAccessMiddleware,
    eventController.updateEventPrivacyController
);

// Update default guest permissions
eventRouter.patch("/:event_id/permissions",
    eventAccessMiddleware,
    eventController.updateDefaultPermissionsController
);

// Archive/Unarchive event
eventRouter.patch("/:event_id/archive",
    eventAccessMiddleware,
    eventController.toggleEventArchiveController
);

// ============= CO-HOST MANAGEMENT =============

eventRouter.post('/join-cohost/:token', authMiddleware, cohostcontroller.joinAsCoHostController);
eventRouter.get('/:event_id/cohost-invite', authMiddleware, cohostcontroller.getCoHostInviteController);

eventRouter.get('/:event_id/cohosts', authMiddleware, cohostcontroller.getEventCoHostsController);
eventRouter.patch('/:event_id/cohosts/:user_id', authMiddleware, cohostcontroller.manageCoHostController);


export default eventRouter;

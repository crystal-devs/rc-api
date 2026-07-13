// routes/event.routes.ts
import express, { RequestHandler } from "express";
import * as eventController from "@controllers/event.controller";
import * as cohostController from "@controllers/co-host.controller"
import * as participantController from "@controllers/participant.controller";
import * as invitationController from "@controllers/invitation.controller";
import { getEventGuestSessionsController, revokeGuestSessionController } from "@controllers/event/guest-management.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { checkEventLimitMiddleware } from "@middlewares/subscription-limit.middleware";
import { eventAccessMiddleware } from "@middlewares/event-access.middleware";
import { authorize } from "@middlewares/authorize.middleware";
import { getEventParticipantsController } from "@controllers/participant.controller";

const eventRouter = express.Router();

// Apply authentication middleware to all routes
eventRouter.use(authMiddleware);

// ============= CORE EVENT CRUD =============
// Get user's events with advanced filtering
eventRouter.get("/", eventController.getUserEventsController);

// Get specific event details
eventRouter.get("/:event_id", eventAccessMiddleware, eventController.getEventController);

// Caller's role + computed permissions for this event (drives client-side RBAC UI)
eventRouter.get("/:event_id/my-access", eventAccessMiddleware, eventController.getMyAccessController);

// Create new event
eventRouter.post("/",
    checkEventLimitMiddleware as RequestHandler,
    eventController.createEventController
);

// Update event (only owner/co-hosts)
eventRouter.patch("/:event_id",
    eventAccessMiddleware,
    authorize('event.update'),
    eventController.updateEventController
);

// Delete event (only owner)
eventRouter.delete("/:event_id",
    eventAccessMiddleware,
    authorize('event.delete'),
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
    authorize('analytics.view'),
    eventController.getEventAnalyticsController
);

// Get real-time activity feed
eventRouter.get("/:event_id/activity",
    eventAccessMiddleware,
    authorize('analytics.view'),
    eventController.getEventActivityController
);

// ============= PARTICIPANT MANAGEMENT =============
// Get event participants with filtering and pagination
eventRouter.get("/:event_id/participants",
    eventAccessMiddleware,
    authorize('participants.manage'),
    participantController.getEventParticipantsController
);

// Invite participants (bulk support)
eventRouter.post("/:event_id/participants/invite",
    eventAccessMiddleware,
    authorize('participants.invite'),
    participantController.inviteParticipantsController
);

// Update participant permissions/role
eventRouter.patch("/:event_id/participants/:participant_id",
    eventAccessMiddleware,
    authorize('participants.update'),
    participantController.updateParticipantController
);

// Remove participant
eventRouter.delete("/:event_id/participants/:participant_id",
    eventAccessMiddleware,
    authorize('participants.remove'),
    participantController.removeParticipantController
);

// Get participant activity logs
eventRouter.get("/:event_id/participants/:participant_id/activity",
    eventAccessMiddleware,
    authorize('participants.manage'),
    participantController.getParticipantActivityController
);

// Get participant statistics
eventRouter.get("/:event_id/participants/:participant_id/stats",
    eventAccessMiddleware,
    authorize('participants.manage'),
    participantController.getParticipantStatsController
);

// ============= INVITATION MANAGEMENT =============
// Send invitations (simple format)
eventRouter.post("/:event_id/invitations",
    eventAccessMiddleware,
    authorize('participants.invite'),
    invitationController.sendInvitationsController
);

// Get event invitations
eventRouter.get("/:event_id/invitations",
    eventAccessMiddleware,
    authorize('participants.manage'),
    invitationController.getEventInvitationsController
);

// Revoke invitation
eventRouter.delete("/:event_id/invitations/:invitation_id",
    eventAccessMiddleware,
    authorize('participants.invite'),
    invitationController.revokeInvitationController
);

// ============= EVENT ALBUMS MANAGEMENT =============
// Get event albums
eventRouter.get("/:event_id/albums",
    eventAccessMiddleware,
    authorize('event.view'),
    eventController.getEventAlbumsController
);

// Create album within event
eventRouter.post("/:event_id/albums",
    eventAccessMiddleware,
    authorize('album.manage'),
    eventController.createEventAlbumController
);

// ============= EVENT SETTINGS & PREFERENCES =============
// Update privacy settings
eventRouter.patch("/:event_id/privacy",
    eventAccessMiddleware,
    authorize('event.update'),
    eventController.updateEventPrivacyController
);

// Update default guest permissions
eventRouter.patch("/:event_id/permissions",
    eventAccessMiddleware,
    authorize('event.update'),
    eventController.updateDefaultPermissionsController
);

// Archive/Unarchive event — creator only (product decision 2026-07-11)
eventRouter.patch("/:event_id/archive",
    eventAccessMiddleware,
    authorize('event.archive'),
    eventController.toggleEventArchiveController
);

// ============= CO-HOST MANAGEMENT =============

// ✅ FIXED: Complete co-host routes
// Create co-host invite link
eventRouter.post('/:event_id/cohost-invite',
    eventAccessMiddleware,
    authorize('cohost.invite'),
    cohostController.createCoHostInviteController
);

// Get co-host invite details
eventRouter.get('/:event_id/cohost-invite',
    eventAccessMiddleware,
    authorize('cohost.invite'),
    cohostController.getCoHostInviteController
);

// Revoke co-host invite
eventRouter.delete('/:event_id/cohost-invite/:invitation_id',
    eventAccessMiddleware,
    authorize('cohost.invite'),
    cohostController.revokeCoHostInviteController
);

// Join as co-host using token (public route for invited users)
eventRouter.post('/join-cohost/:token',
    authMiddleware,
    cohostController.joinAsCoHostController
);

// Get all co-hosts for an event
eventRouter.get('/:event_id/cohosts',
    eventAccessMiddleware,
    authorize('participants.manage'),
    cohostController.getEventCoHostsController
);

// Manage specific co-host (approve, reject, remove, block, unblock) — creator only.
// The service had NO caller check at all before this gate was added.
eventRouter.patch('/:event_id/cohosts/:user_id',
    eventAccessMiddleware,
    authorize('cohost.manage'),
    cohostController.manageCoHostController
);

// ============= GUEST SESSION MANAGEMENT =============
// Get active guest sessions (Host Dashboard)
eventRouter.get("/:eventId/guest-sessions",
    eventAccessMiddleware,
    authorize('participants.manage'),
    getEventGuestSessionsController as unknown as express.RequestHandler
);

// Revoke guest session
eventRouter.patch("/:eventId/guest-sessions/:sessionId/revoke",
    eventAccessMiddleware,
    authorize('participants.remove'),
    revokeGuestSessionController as unknown as express.RequestHandler
);

export default eventRouter;

import express from "express";
import * as participantController from "@controllers/participant.controller";
import { authMiddleware } from "@middlewares/clicky-auth.middleware";
import { eventAccessMiddleware, requireGuestManagementAccess } from "@middlewares/event-access.middleware";

const participantRouter = express.Router();

// Apply authentication middleware
participantRouter.use(authMiddleware);

// ============= PARTICIPANT MANAGEMENT =============
// Get event participants with filtering and pagination
participantRouter.get("/:event_id/participants", 
    eventAccessMiddleware,
    participantController.getEventParticipantsController
);

// Invite participants (bulk support)
participantRouter.post("/:event_id/participants/invite", 
    eventAccessMiddleware,
    requireGuestManagementAccess,
    participantController.inviteParticipantsController
);

// Get participant details
participantRouter.get("/:event_id/participants/:participant_id", 
    eventAccessMiddleware,
    participantController.getParticipantDetailsController
);

// Update participant permissions/role
participantRouter.patch("/:event_id/participants/:participant_id", 
    eventAccessMiddleware,
    requireGuestManagementAccess,
    participantController.updateParticipantController
);

// Remove participant from event
participantRouter.delete("/:event_id/participants/:participant_id", 
    eventAccessMiddleware,
    requireGuestManagementAccess,
    participantController.removeParticipantController
);

// Get participant activity history
participantRouter.get("/:event_id/participants/:participant_id/activity", 
    eventAccessMiddleware,
    participantController.getParticipantActivityController
);

// Bulk participant operations
participantRouter.patch("/:event_id/participants/bulk", 
    eventAccessMiddleware,
    requireGuestManagementAccess,
    participantController.bulkUpdateParticipantsController
);

// Export participant list
participantRouter.get("/:event_id/participants/export/csv", 
    eventAccessMiddleware,
    requireGuestManagementAccess,
    participantController.exportParticipantsController
);

export default participantRouter;
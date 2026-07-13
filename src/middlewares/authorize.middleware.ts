// middlewares/authorize.middleware.ts
//
// The single route-level permission gate. Usage:
//
//   eventRouter.patch('/:event_id',
//       eventAccessMiddleware,        // resolves who you are in this event
//       authorize('event.update'),    // declares what this route requires
//       controller
//   );
//
// Must run AFTER eventAccessMiddleware or tokenAccessMiddleware (they attach
// req.eventAccess with the computed permission set). Policy lives in
// configs/permissions.policy.ts — controllers should not re-check roles.

import { NextFunction, Response } from "express";
import { injectedRequest } from "types/injected-types";
import { sendResponse } from "@utils/express.util";
import { logger } from "@utils/logger";
import { Action } from "@configs/permissions.policy";

export const authorize = (action: Action) => {
    return (req: injectedRequest, res: Response, next: NextFunction): void => {
        const access = req.eventAccess;

        // Misconfiguration guard: an access middleware must have run first.
        if (!access || typeof access.can !== 'function') {
            logger.error('authorize() used without an access middleware', {
                path: req.path,
                method: req.method,
                action
            });
            sendResponse(res, {
                status: false,
                code: 500,
                message: "Server configuration error",
                data: null,
                error: { message: `authorize('${action}') requires eventAccessMiddleware or tokenAccessMiddleware before it` },
                other: null
            });
            return;
        }

        if (!access.can(action)) {
            logger.warn('Action forbidden', {
                path: req.path,
                method: req.method,
                action,
                role: access.role,
                eventId: access.eventId
            });
            sendResponse(res, {
                status: false,
                code: 403,
                message: "You don't have permission to do this",
                data: null,
                error: { message: `Requires '${action}' permission`, code: 'FORBIDDEN', action },
                other: null
            });
            return;
        }

        next();
    };
};

// middlewares/resource-access.middleware.ts
//
// Access resolution for id-scoped resources (media, albums). Each middleware
// looks up the resource's event and then delegates to eventAccessMiddleware,
// so participant resolution + policy attachment live in exactly one place.
// Follow with authorize(action) to gate the route:
//
//   mediaRouter.delete('/:media_id',
//       authMiddleware,
//       mediaAccessMiddleware,
//       authorize('media.delete'),
//       controller
//   );

import { NextFunction, Response } from "express";
import mongoose from "mongoose";
import { injectedRequest } from "types/injected-types";
import { sendResponse } from "@utils/express.util";
import { Media } from "@models/media.model";
import { Album } from "@models/album.model";
import { eventAccessMiddleware } from "./event-access.middleware";

const invalidId = (res: Response, what: string) =>
    sendResponse(res, {
        status: false,
        code: 400,
        message: `Valid ${what} ID is required`,
        data: null,
        error: { message: `Invalid ${what} ID` },
        other: null
    });

const notFound = (res: Response, what: string) =>
    sendResponse(res, {
        status: false,
        code: 404,
        message: `${what} not found`,
        data: null,
        error: { message: `${what} not found` },
        other: null
    });

/** Resolves media → event, then runs the standard event access resolution. */
export const mediaAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const mediaId = req.params.media_id || req.params.mediaId;

        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return invalidId(res, "media");
        }

        const media = await Media.findById(mediaId).select('event_id').lean();
        if (!media?.event_id) {
            return notFound(res, "Media");
        }

        // Delegate: eventAccessMiddleware reads event_id from params
        req.params.event_id = media.event_id.toString();
        return eventAccessMiddleware(req, res, next);
    } catch (error: any) {
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Error checking media access",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};

/** Resolves album → event, then runs the standard event access resolution. */
export const albumAccessMiddleware = async (
    req: injectedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const albumId = req.params.album_id || req.params.albumId;

        if (!albumId || !mongoose.Types.ObjectId.isValid(albumId)) {
            return invalidId(res, "album");
        }

        const album = await Album.findById(albumId).select('event_id').lean();
        if (!album?.event_id) {
            return notFound(res, "Album");
        }

        req.params.event_id = album.event_id.toString();
        return eventAccessMiddleware(req, res, next);
    } catch (error: any) {
        return sendResponse(res, {
            status: false,
            code: 500,
            message: "Error checking album access",
            data: null,
            error: { message: error.message },
            other: null
        });
    }
};

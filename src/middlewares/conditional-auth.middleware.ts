// middlewares/conditional-auth.middleware.ts

import { RequestHandler, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from './clicky-auth.middleware';
import { Event } from '@models/event.model';
import { Album } from '@models/album.model';
import { injectedRequest } from 'types/injected-types';

export const conditionalAuthMiddleware: RequestHandler = async (req: injectedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const eventId = req.params.event_id;
        const albumId = req.params.album_id;
        
        let targetEventId = eventId;
        
        // If we have album_id, get the event_id from the album
        if (albumId && !eventId) {
            if (!mongoose.Types.ObjectId.isValid(albumId)) {
                res.status(400).json({ 
                    status: false,
                    message: 'Invalid album ID',
                    error: { message: 'Invalid album ID format' }
                });
                return;
            }

            const album = await Album.findById(new mongoose.Types.ObjectId(albumId)).lean();
            if (!album) {
                res.status(404).json({ 
                    status: false,
                    message: 'Album not found',
                    error: { message: 'The specified album does not exist' }
                });
                return;
            }
            targetEventId = album.event_id.toString();
        }
        
        if (!targetEventId) {
            res.status(400).json({ 
                status: false,
                message: 'Event ID required',
                error: { message: 'Event ID is required' }
            });
            return;
        }

        // Validate event ID format
        if (!mongoose.Types.ObjectId.isValid(targetEventId)) {
            res.status(400).json({ 
                status: false,
                message: 'Invalid event ID',
                error: { message: 'Invalid event ID format' }
            });
            return;
        }
        
        // Check if event exists and get its settings
        const event = await Event.findById(new mongoose.Types.ObjectId(targetEventId)).lean();
        
        if (!event) {
            res.status(404).json({ 
                status: false,
                message: 'Event not found',
                error: { message: 'The specified event does not exist' }
            });
            return;
        }
        
        // If event allows guest access based on visibility and permissions
        const allowsGuestAccess = event.visibility === 'anyone_with_link' && 
                                 event.permissions?.can_view === true;
        
        if (allowsGuestAccess) {
            // Set a flag to indicate this is a guest request
            // req.isGuestAccess = true;
            // req.guestEvent = {
            //     id: event._id.toString(),
            //     visibility: event.visibility,
            //     permissions: {
            //         can_view: event.permissions?.can_view || false,
            //         can_upload: event.permissions?.can_upload || false,
            //         can_download: event.permissions?.can_download || false,
            //         require_approval: event.permissions?.require_approval || true,
            //         allowed_media_types: event.permissions?.allowed_media_types || {
            //             images: true,
            //             videos: true
            //         }
            //     }
            // };
            return next();
        }
        
        // If event requires auth, apply the auth middleware
        return authMiddleware(req, res, next);
        
    } catch (error) {
        console.error('Error in conditional auth middleware:', error);
        res.status(500).json({ 
            status: false,
            message: 'Internal server error',
            error: { message: 'An unexpected error occurred' }
        });
        return;
    }
};
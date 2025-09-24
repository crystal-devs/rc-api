// ====================================
// 5. services/album/album-query.service.ts
// ====================================

import mongoose from "mongoose";
import { Album } from "@models/album.model";
import { MODEL_NAMES } from "@models/names";
import { logger } from "@utils/logger";

import type { AlbumQueryParams, AlbumType, AlbumServiceResponse } from './album.types';

export class AlbumQueryService {
    /**
     * 🔍 GET: Albums by various parameters
     */
    async getAlbumsByParams(params: AlbumQueryParams): Promise<AlbumServiceResponse<AlbumType[]>> {
        try {
            const { album_id, event_id, user_id } = params;
            let albums: AlbumType[] = [];

            // Fetch albums by user ID using aggregation
            if (user_id) {
                const userAlbums = await this.getAlbumsByUser(user_id);
                albums = userAlbums;
            }

            // Fetch albums by event ID
            if (event_id) {
                const eventAlbums = await this.getAlbumsByEvent(event_id);
                
                if (eventAlbums.length > 0) {
                    if (albums.length > 0) {
                        // Merge without duplicates
                        const existingIds = new Set(albums.map(a => a._id.toString()));
                        eventAlbums.forEach(album => {
                            if (!existingIds.has(album._id.toString())) {
                                albums.push(album);
                            }
                        });
                    } else {
                        albums = eventAlbums;
                    }
                }
            }

            // Fetch specific album by ID
            if (album_id) {
                const album = await this.getAlbumById(album_id);
                if (album) {
                    const exists = albums.some(a => a._id.toString() === album._id.toString());
                    if (!exists) {
                        albums.push(album);
                    }
                }
            }

            return {
                status: true,
                code: 200,
                message: "Albums fetched successfully",
                data: albums,
                error: null,
                other: null
            };
        } catch (err: any) {
            logger.error('Error fetching albums:', err);
            
            return {
                status: false,
                code: 500,
                message: "Failed to get albums",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        }
    }

    /**
     * 🔍 GET: Album by ID
     */
    async getAlbumById(albumId: string): Promise<AlbumType | null> {
        try {
            return await Album.findById(albumId).lean();
        } catch (error) {
            logger.error('Error fetching album by ID:', error);
            return null;
        }
    }

    /**
     * 🔍 GET: Albums by event ID
     */
    async getAlbumsByEvent(eventId: string): Promise<AlbumType[]> {
        try {
            return await Album.find({
                event_id: new mongoose.Types.ObjectId(eventId)
            }).lean();
        } catch (error) {
            logger.error('Error fetching albums by event:', error);
            return [];
        }
    }

    /**
     * 🔍 GET: Albums by user ID (events where user is owner or co-host)
     */
    async getAlbumsByUser(userId: string): Promise<AlbumType[]> {
        try {
            const userObjectId = new mongoose.Types.ObjectId(userId);

            return await Album.aggregate([
                {
                    $lookup: {
                        from: MODEL_NAMES.EVENT,
                        localField: "event_id",
                        foreignField: "_id",
                        as: "event"
                    }
                },
                { $unwind: "$event" },
                {
                    $match: {
                        $or: [
                            { "event.created_by": userObjectId },
                            {
                                "event.co_hosts.user_id": userObjectId,
                                "event.co_hosts.status": "approved"
                            }
                        ]
                    }
                },
                {
                    $project: {
                        event: 0 // Remove the event data, keep only album fields
                    }
                }
            ]);
        } catch (error) {
            logger.error('Error fetching albums by user:', error);
            return [];
        }
    }

    /**
     * 🔍 GET: Default album for event
     */
    async getDefaultAlbum(eventId: string): Promise<AlbumServiceResponse<AlbumType | null>> {
        try {
            const defaultAlbum = await Album.findOne({
                event_id: new mongoose.Types.ObjectId(eventId),
                is_default: true
            });

            if (!defaultAlbum) {
                return {
                    status: false,
                    code: 404,
                    message: "Default album not found",
                    data: null,
                    error: null,
                    other: null
                };
            }

            return {
                status: true,
                code: 200,
                message: "Default album found",
                data: defaultAlbum,
                error: null,
                other: null
            };
        } catch (err: any) {
            logger.error('Error getting default album:', err);

            return {
                status: false,
                code: 500,
                message: "Failed to get default album",
                data: null,
                error: {
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
                },
                other: null
            };
        }
    }
}

// Singleton instance
export const albumQueryService = new AlbumQueryService();
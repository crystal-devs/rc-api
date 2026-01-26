import { getCachedSignedUrl } from '@utils/signedUrl';
import { Media } from "@models/media.model";
import { Request, Response } from 'express';
import { mediaNotificationService } from '@services/websocket/notifications';

interface AuthenticatedRequest extends Request {
    user?: {
        _id: string;
        role?: string;
    };
}

interface UpdateMediaRequest {
    uploadId: string;
    original?: {
        width: number;
        height: number;
        aspectRatio: number;
    };
    variants: {
        small: string;
        medium: string;
        large: string;
    };
    processedAt: string;
}

export const updateMediaController = async (
    req: AuthenticatedRequest,
    res: Response,
) => {
    try {
        const { uploadId, original, variants, processedAt } = req.body as UpdateMediaRequest;

        console.log('🔍 LAMBDA PAYLOAD RECEIVED:', JSON.stringify(req.body, null, 2));
        console.log('📏 Original dimensions:', original ? `width: ${original.width}, height: ${original.height}, aspectRatio: ${original.aspectRatio}` : 'No original data');

        // 1. Validate input
        if (!uploadId || !variants || !processedAt) {
            return res.status(400).json({ error: 'Missing required fields: uploadId, variants, processedAt' });
        }

        // 2. Find Media document
        const media = await Media.findOne({ upload_id: uploadId });
        if (!media) {
            console.error('Media not found for uploadId:', uploadId);
            return res.status(404).json({ error: 'Media not found' });
        }

        // 3. Update original metadata if provided
        if (original) {
            media.original = {
                public_id: media.original?.public_id || '',
                filename: media.original?.filename || '',
                width: original.width,
                height: original.height,
                format: media.original?.format || 'jpeg',
                size_mb: media.original?.size_mb || 0,
            };
        }

        // 4. Update variants based on media type
        if (media.type === 'image') {
            if (!media.variants.images) media.variants.images = {};
            if (variants.small) {
                media.variants.images.small = { public_id: variants.small };
            }
            if (variants.medium) {
                media.variants.images.medium = { public_id: variants.medium };
            }
            if (variants.large) {
                media.variants.images.large = { public_id: variants.large };
            }
        } else if (media.type === 'video') {
            // For videos, assume the variants are transcodes
            if (!media.variants.videos) media.variants.videos = {};
            // Map small/medium/large to p360/p720/p1080
            if (variants.small) {
                media.variants.videos.p360 = { public_id: variants.small };
            }
            if (variants.medium) {
                media.variants.videos.p720 = { public_id: variants.medium };
            }
            if (variants.large) {
                media.variants.videos.p1080 = { public_id: variants.large };
            }
        }

        // 5. Update processing
        media.processing = {
            ...media.processing,
            status: 'completed',
            stage: 'completed',
            progress: 100,
        };

        await media.save();

        // 6. Emit WebSocket using MediaNotificationService
        const eventId = media.event_id.toString();
        let smallUrl = '', mediumUrl = '', largeUrl = '';

        if (media.type === 'image' && media.variants.images) {
            smallUrl = media.variants.images.small ? await getCachedSignedUrl(media.variants.images.small.public_id) : '';
            mediumUrl = media.variants.images.medium ? await getCachedSignedUrl(media.variants.images.medium.public_id) : '';
            largeUrl = media.variants.images.large ? await getCachedSignedUrl(media.variants.images.large.public_id) : '';
        } else if (media.type === 'video' && media.variants.videos) {
            smallUrl = media.variants.videos.p360 ? await getCachedSignedUrl(media.variants.videos.p360.public_id) : '';
            mediumUrl = media.variants.videos.p720 ? await getCachedSignedUrl(media.variants.videos.p720.public_id) : '';
            largeUrl = media.variants.videos.p1080 ? await getCachedSignedUrl(media.variants.videos.p1080.public_id) : '';
        }

        mediaNotificationService.broadcastProcessingComplete({
            mediaId: media._id.toString(),
            eventId,
            newUrl: mediumUrl || media.original.public_id,
            variants: {
                thumbnail: smallUrl,
                display: mediumUrl,
                full: largeUrl
            },
            processingTimeMs: 0 // Not available in this context
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Update photo failed:', err);
        res.status(500).json({ error: 'Internal error' });
    }
};
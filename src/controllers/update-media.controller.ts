import { getCachedSignedUrl } from '@utils/signedUrl';
import { Media } from "@models/media.model";
import { Response } from 'express';
import { mediaNotificationService } from '@services/websocket/notifications';

interface AuthenticatedRequest extends Request {
    user?: {
        _id: string;
        role?: string;
    };
}

interface UpdateMediaRequest {
    uploadId: string;
    variants: {
        original?: string;
        small: string;
        medium: string;
        large: string;
    };
}

export const updateMediaController = async (
    req: AuthenticatedRequest,
    res: Response,
) => {
    try {
        const { uploadId, variants } = req.body as unknown as UpdateMediaRequest;

        console.log(uploadId, variants, 'Received updateMediaController request');

        // 1. Validate input
        if (typeof uploadId !== 'string' || !variants || typeof variants !== 'object') {
            return res.status(400).json({ error: 'Missing or invalid uploadId or variants' });
        }

        // 2. Find Media document
        const media = await Media.findOne({ upload_id: uploadId });
        if (!media) {
            console.error('Media not found for uploadId:', uploadId);
            return res.status(404).json({ error: 'Media not found' });
        }

        // 3. Update variants (WebP only)
        media.image_variants = {
            original: media.image_variants?.original || {
                url: media.url,
                width: media.metadata?.width || 0,
                height: media.metadata?.height || 0,
                size_mb: media.size_mb,
                format: media.format,
            },
            small: {
                webp: {
                    url: await getCachedSignedUrl(variants.small),
                    width: 300,
                    height: Math.round(300 * (media.metadata?.aspect_ratio || 1)),
                    size_mb: 0.05, // approximate
                    format: 'webp',
                },
                jpeg: null,
            },
            medium: {
                webp: {
                    url: await getCachedSignedUrl(variants.medium),
                    width: 1080,
                    height: Math.round(1080 * (media.metadata?.aspect_ratio || 1)),
                    size_mb: 0.2,
                    format: 'webp',
                },
                jpeg: null,
            },
            large: {
                webp: {
                    url: await getCachedSignedUrl(variants.large),
                    width: 1920,
                    height: Math.round(1920 * (media.metadata?.aspect_ratio || 1)),
                    size_mb: 0.5,
                    format: 'webp',
                },
                jpeg: null,
            },
        };

        // 4. Update processing
        media.processing = {
            ...media.processing,
            status: 'completed',
            current_stage: 'completed',
            progress_percentage: 100,
            variants_generated: true,
            variants_count: 3,
            completed_at: new Date(),
            last_updated: new Date(),
        };

        await media.save();

        // 5. Emit WebSocket using MediaNotificationService
        const eventId = media.event_id.toString();
        const smallUrl = media.image_variants.small.webp!.url;
        const mediumUrl = media.image_variants.medium.webp!.url;
        const largeUrl = media.image_variants.large.webp!.url;

        mediaNotificationService.broadcastProcessingComplete({
            mediaId: media._id.toString(),
            eventId,
            newUrl: mediumUrl,
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
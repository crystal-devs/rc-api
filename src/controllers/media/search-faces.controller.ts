import { Request, Response } from 'express';
import fs from 'fs';
import { rekognitionService } from '@services/aws/rekognition.service';
import { Media } from '@models/media.model';
import { Event } from '@models/event.model';
import { logger } from '@utils/logger';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { keys } from '@configs/dotenv.config';

// Initialize S3 client
const s3Client = new S3Client({
    region: keys.awsRegion as string,
    credentials: {
        accessKeyId: keys.awsAccessKeyId as string,
        secretAccessKey: keys.awsSecretAccessKey as string,
    },
});

interface AuthenticatedRequest extends Request {
    user?: {
        _id: string;
        role?: string;
    };
    file?: Express.Multer.File;
}

/**
 * Search for photos containing the user's face
 * POST /api/media/search/faces
 */
export const searchFacesController = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response> => {
    try {
        const { eventId } = req.body;
        const selfieFile = req.file;

        if (!eventId) {
            return res.status(400).json({
                status: false,
                message: 'Event ID is required',
            });
        }

        if (!selfieFile) {
            return res.status(400).json({
                status: false,
                message: 'Selfie image is required',
            });
        }

        // DPDP gate: selfie search is biometric processing — only allowed on
        // events whose host opted in to face recognition.
        const event = await Event.findById(eventId).select('face_recognition.enabled').lean();
        if (!event?.face_recognition?.enabled) {
            return res.status(403).json({
                status: false,
                message: 'Face features are not enabled for this event',
            });
        }

        // Read file buffer (handling both memory and disk storage multer configs)
        let imageBuffer: Buffer;
        if (selfieFile.buffer) {
            imageBuffer = selfieFile.buffer;
        } else if (selfieFile.path) {
            imageBuffer = fs.readFileSync(selfieFile.path);
            // Clean up temp file
            fs.unlinkSync(selfieFile.path);
        } else {
            return res.status(500).json({ status: false, message: 'File upload failed' });
        }

        // Call AWS Rekognition
        const mediaIds = await rekognitionService.searchFaces(imageBuffer, eventId);

        if (mediaIds.length === 0) {
            return res.status(200).json({
                status: true,
                message: 'No matching photos found',
                data: []
            });
        }

        // Fetch full media objects from DB
        const mediaList = await Media.find({
            _id: { $in: mediaIds },
            // Optional: Ensure they belong to the event (double check)
            event_id: eventId,
            // Ensure only visible/approved photos are returned
            'approval.status': 'approved'
        }).sort({ created_at: -1 });

        // Transform media with Signed URLs or CloudFront URLs
        const transformedMedia = await Promise.all(mediaList.map(async (media) => {
            const mediaObj = media.toObject();
            const originalKey = media.original.public_id;

            let finalUrl = '';
            let thumbnailUrl = '';

            // 1. Generate Main URL (CloudFront or S3 Signed)
            if (keys.useCloudFront && keys.cloudFrontDomain) {
                finalUrl = `https://${keys.cloudFrontDomain}/${originalKey}`;
                // Assuming variants also follow similar path structure or are stored in 'variants' field
            } else {
                finalUrl = await getSignedUrl(
                    s3Client,
                    new GetObjectCommand({
                        Bucket: keys.s3BucketName as string,
                        Key: originalKey,
                    }),
                    { expiresIn: 3600 } // 1 hour
                );
            }

            // 2. Handle Variants / Thumbnails
            // If we have specific variant keys, we should generate URLs for them too.
            // For now, ensuring the main 'url' and 'thumbnail_url' are populated.

            // If variants exist, we could generate signed URLs for them here.
            // For this implementation, we'll focus on ensuring the primary display URL works.
            // If your frontend expects 'responsive_urls', strict handling would go here.

            // Generate responsive URLs if variants exist (Basic implementation)
            const responsiveUrls: any = {
                original: finalUrl
            };

            // Process variants if they exist (example for 'small' variant)
            if (media.variants && (media.variants as any).small) {
                const smallKey = (media.variants as any).small.key || (media.variants as any).small.public_id;
                if (smallKey) {
                    if (keys.useCloudFront && keys.cloudFrontDomain) {
                        responsiveUrls.thumbnail = `https://${keys.cloudFrontDomain}/${smallKey}`;
                    } else {
                        responsiveUrls.thumbnail = await getSignedUrl(
                            s3Client,
                            new GetObjectCommand({
                                Bucket: keys.s3BucketName as string,
                                Key: smallKey,
                            }),
                            { expiresIn: 3600 }
                        );
                    }
                    thumbnailUrl = responsiveUrls.thumbnail;
                }
            }

            // Fallback for thumbnail if no variant
            if (!thumbnailUrl) {
                thumbnailUrl = finalUrl;
                responsiveUrls.thumbnail = finalUrl;
            }

            return {
                ...mediaObj,
                url: finalUrl,
                thumbnail_url: thumbnailUrl,
                responsive_urls: responsiveUrls
            };
        }));

        return res.status(200).json({
            status: true,
            message: `Found ${transformedMedia.length} matching photos`,
            data: transformedMedia
        });

    } catch (error: any) {
        logger.error('Face search failed:', error);
        return res.status(500).json({
            status: false,
            message: 'Face search failed',
            error: error.message
        });
    }
};

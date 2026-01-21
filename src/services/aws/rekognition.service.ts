import { RekognitionClient, CreateCollectionCommand, IndexFacesCommand, SearchFacesByImageCommand, FaceMatch } from "@aws-sdk/client-rekognition";
import { keys } from "@configs/dotenv.config";
import { logger } from "@utils/logger";

const rekognitionClient = new RekognitionClient({
    region: keys.awsRegion as string,
    credentials: {
        accessKeyId: keys.awsAccessKeyId as string,
        secretAccessKey: keys.awsSecretAccessKey as string,
    },
});

export const rekognitionService = {
    /**
     * Create a collection for an event
     */
    createCollection: async (eventId: string) => {
        const collectionId = `event_${eventId}`;
        try {
            const command = new CreateCollectionCommand({ CollectionId: collectionId });
            await rekognitionClient.send(command);
            logger.info(`Created Rekognition collection: ${collectionId}`);
            return true;
        } catch (error: any) {
            if (error.name === 'ResourceAlreadyExistsException') {
                return true; // Already exists
            }
            logger.error(`Failed to create collection ${collectionId}:`, error);
            throw error;
        }
    },

    /**
     * Index faces in an uploaded image
     */
    indexFaces: async (bucket: string, key: string, mediaId: string, eventId: string) => {
        const collectionId = `event_${eventId}`;

        // Ensure collection exists
        await rekognitionService.createCollection(eventId);

        try {
            const command = new IndexFacesCommand({
                CollectionId: collectionId,
                Image: {
                    S3Object: {
                        Bucket: bucket,
                        Name: key,
                    },
                },
                ExternalImageId: mediaId, // Map AWS face to our Media ID
                DetectionAttributes: ["DEFAULT"],
                MaxFaces: 50, // Limit faces per photo to save costs/noise
                QualityFilter: "AUTO",
            });

            const response = await rekognitionClient.send(command);

            const faceCount = response.FaceRecords?.length || 0;
            logger.info(`Indexed ${faceCount} faces for media ${mediaId} in collection ${collectionId}`);

            return {
                faceCount,
                faceRecords: response.FaceRecords
            };
        } catch (error: any) {
            logger.error(`Failed to index faces for ${mediaId}:`, error);
            // Don't throw, just log. Facial recognition failure shouldn't crash the upload.
            return { faceCount: 0, error: error.message };
        }
    },

    /**
     * Search for faces using an input image buffer (Selfie)
     */
    searchFaces: async (imageBuffer: Buffer, eventId: string) => {
        const collectionId = `event_${eventId}`;
        try {
            const command = new SearchFacesByImageCommand({
                CollectionId: collectionId,
                Image: { Bytes: imageBuffer },
                FaceMatchThreshold: 90, // High confidence threshold
                MaxFaces: 100,
            });

            const response = await rekognitionClient.send(command);

            // Extract unique media IDs
            const matches = response.FaceMatches || [];
            const mediaIds = new Set<string>();

            matches.forEach((match: FaceMatch) => {
                if (match.Face?.ExternalImageId) {
                    mediaIds.add(match.Face.ExternalImageId);
                }
            });

            logger.info(`Found ${mediaIds.size} matching photos for guest in event ${eventId}`);
            return Array.from(mediaIds);

        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                return []; // Collection doesn't exist yet
            }
            logger.error(`Failed to search faces in ${collectionId}:`, error);
            throw error;
        }
    }
};

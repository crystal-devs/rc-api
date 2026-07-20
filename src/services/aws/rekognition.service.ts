import { RekognitionClient, CreateCollectionCommand, IndexFacesCommand, SearchFacesByImageCommand, FaceMatch, SearchFacesCommand, SearchFacesCommandOutput, DeleteFacesCommand, DeleteCollectionCommand } from "@aws-sdk/client-rekognition";
import { rekognitionQueue } from "@queues/rekognition.queue";
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
    },
    /**
     * Search for faces and return the AWS FaceID (Identity)
     * Used for logging in with a face.
     */
    searchFaceId: async (imageBuffer: Buffer, eventId: string) => {
        const collectionId = `event_${eventId}`;
        try {
            const command = new SearchFacesByImageCommand({
                CollectionId: collectionId,
                Image: { Bytes: imageBuffer },
                FaceMatchThreshold: 95, // Very high confidence for identity
                MaxFaces: 1,
            });

            const response = await rekognitionClient.send(command);
            const match = response.FaceMatches?.[0];

            if (match && match.Face?.FaceId) {
                logger.info(`Found existing face identity: ${match.Face.FaceId}`);
                return match.Face.FaceId;
            }
            return null;
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                return null;
            }
            logger.error(`Failed to search face identity in ${collectionId}:`, error);
            throw error;
        }
    },

    /**
     * Index a face directly from buffer (for new guest identity)
     */
    indexFaceBuffer: async (imageBuffer: Buffer, eventId: string) => {
        const collectionId = `event_${eventId}`;

        // Ensure collection exists
        await rekognitionService.createCollection(eventId);

        try {
            const command = new IndexFacesCommand({
                CollectionId: collectionId,
                Image: { Bytes: imageBuffer },
                DetectionAttributes: ["DEFAULT"],
                MaxFaces: 1, // We only want the main face
                QualityFilter: "AUTO",
            });

            const response = await rekognitionClient.send(command);
            const faceRecord = response.FaceRecords?.[0];

            if (faceRecord && faceRecord.Face?.FaceId) {
                logger.info(`Created new face identity: ${faceRecord.Face.FaceId}`);
                return faceRecord.Face.FaceId;
            }
            return null;
        } catch (error: any) {
            logger.error(`Failed to index face from buffer:`, error);
            throw error;
        }
    },

    /**
     * Search for photos containing a specific FaceID
     */
    searchByFaceId: async (faceId: string, eventId: string) => {
        const collectionId = `event_${eventId}`;
        try {
            // We use the AWS SDK's SearchFaces command

            const command = new SearchFacesCommand({
                CollectionId: collectionId,
                FaceId: faceId,
                FaceMatchThreshold: 90,
                MaxFaces: 4096, // Retrieve as many as possible
            });

            const response = await rekognitionClient.send(command) as SearchFacesCommandOutput;

            // Extract unique media IDs
            const mediaIds = new Set<string>();
            response.FaceMatches?.forEach((match: any) => {
                if (match.Face?.ExternalImageId) {
                    mediaIds.add(match.Face.ExternalImageId);
                }
            });

            logger.info(`Found ${mediaIds.size} photos for face ${faceId}`);
            return Array.from(mediaIds);
        } catch (error: any) {
            logger.error(`Failed to search by faceId ${faceId}:`, error);
            // If face doesn't exist (e.g. deleted or transient), return empty
            if (error.name === 'InvalidParameterException' || error.name === 'ResourceNotFoundException') {
                return [];
            }
            throw error;
        }
    },
    /**
     * Delete specific faces from an event's collection.
     * Used when a guest withdraws biometric consent (DPDP).
     */
    deleteFaces: async (faceIds: string[], eventId: string) => {
        const collectionId = `event_${eventId}`;
        if (!faceIds.length) return true;
        try {
            const command = new DeleteFacesCommand({
                CollectionId: collectionId,
                FaceIds: faceIds,
            });
            const response = await rekognitionClient.send(command);
            logger.info(`Deleted ${response.DeletedFaces?.length || 0} face(s) from ${collectionId}`);
            return true;
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                return true; // Collection already gone — nothing to delete
            }
            logger.error(`Failed to delete faces from ${collectionId}:`, error);
            throw error;
        }
    },

    /**
     * Delete an event's entire face collection.
     * Called on event deletion and by the retention sweep (DPDP + cost control).
     */
    deleteCollection: async (eventId: string) => {
        const collectionId = `event_${eventId}`;
        try {
            await rekognitionClient.send(new DeleteCollectionCommand({ CollectionId: collectionId }));
            logger.info(`Deleted Rekognition collection: ${collectionId}`);
            return true;
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                return true; // Already gone
            }
            logger.error(`Failed to delete collection ${collectionId}:`, error);
            throw error;
        }
    },

    /**
     * Queue a face indexing job for background processing
     */
    queueIndexFaces: async (bucket: string, key: string, mediaId: string, eventId: string) => {
        try {
            await rekognitionQueue.add('index-faces', {
                bucket,
                key,
                mediaId,
                eventId
            });
            logger.info(`📝 Queued indexing job for media ${mediaId} in event ${eventId}`);
        } catch (error) {
            logger.error(`❌ Failed to queue indexing job for ${mediaId}:`, error);
            // Fallback to direct indexing if queueing fails (safest approach)
            rekognitionService.indexFaces(bucket, key, mediaId, eventId).catch(e => 
                logger.error(`Direct indexing fallback failed for ${mediaId}:`, e)
            );
        }
    },
};

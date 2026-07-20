// DPDP retention sweep: face collections must not outlive their purpose.
// Deletes an event's Rekognition collection once `retention_days` have passed
// after the event's end_date, clears guest face identifiers, and stamps
// `face_recognition.collection_deleted_at` so the event is not re-swept.
//
// Also covers legacy events whose collections were created before consent
// gating existed (deleteCollection is idempotent / ResourceNotFound-tolerant).

import { Event } from "@models/event.model";
import { GuestSession } from "@models/guest-session.model";
import { rekognitionService } from "@services/aws/rekognition.service";
import { logger } from "@utils/logger";

const DEFAULT_RETENTION_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const cleanupExpiredFaceData = async (): Promise<void> => {
    const now = new Date();

    // Candidates: ended events whose collection hasn't been deleted yet.
    // end_date + retention_days is computed per event below (retention is
    // configurable per event), so over-fetch by end_date only.
    const candidates = await Event.find({
        end_date: { $ne: null, $lt: now },
        'face_recognition.collection_deleted_at': null,
    })
        .select('_id title end_date face_recognition')
        .lean();

    let deleted = 0;

    for (const event of candidates) {
        const retentionDays = event.face_recognition?.retention_days ?? DEFAULT_RETENTION_DAYS;
        const expiresAt = new Date(new Date(event.end_date as Date).getTime() + retentionDays * MS_PER_DAY);
        if (expiresAt > now) continue;

        const eventId = event._id.toString();
        try {
            await rekognitionService.deleteCollection(eventId);

            await GuestSession.updateMany(
                { event_id: event._id, aws_face_id: { $ne: null } },
                { $set: { aws_face_id: null, selfie_url: null, 'face_consent.withdrawn_at': now } }
            );

            await Event.updateOne(
                { _id: event._id },
                {
                    $set: {
                        'face_recognition.collection_deleted_at': now,
                        'face_recognition.enabled': false,
                    },
                }
            );

            deleted++;
            logger.info(`[faceRetention] Deleted face collection for event ${eventId} ("${event.title}") — retention of ${retentionDays}d after end_date elapsed`);
        } catch (error) {
            // Leave collection_deleted_at null so the next sweep retries
            logger.error(`[faceRetention] Failed to clean face data for event ${eventId}:`, error);
        }
    }

    logger.info(`[faceRetention] Sweep complete: ${deleted}/${candidates.length} candidate event(s) cleaned`);
};

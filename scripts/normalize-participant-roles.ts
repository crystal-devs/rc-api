// scripts/normalize-participant-roles.ts
// One-time migration: normalize legacy participant/invitation roles to the
// canonical 3-role system (creator / co_host / guest).
//   moderator -> co_host
//   viewer    -> guest
//   owner/admin (if any) -> creator
//
// MUST be run BEFORE deploying the narrowed role enums in
// src/models/event-participants.model.ts and src/models/event-invitations.model.ts.
//
// Usage:
//   npx ts-node scripts/normalize-participant-roles.ts --dry-run   # report only
//   npx ts-node scripts/normalize-participant-roles.ts             # apply

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'rose-click';
const DRY_RUN = process.argv.includes('--dry-run');

const ROLE_MAP: Record<string, string> = {
    moderator: 'co_host',
    cohost: 'co_host',
    'co-host': 'co_host',
    viewer: 'guest',
    participant: 'guest',
    member: 'guest',
    owner: 'creator',
    admin: 'creator',
};

async function run() {
    if (!MONGO_URI) {
        console.error('MONGO_URI is not set in .env');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI, { dbName: MONGO_DB_NAME });
    const db = mongoose.connection.db;
    console.log(`Connected to ${MONGO_DB_NAME}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

    // 1. event_participants.role
    const participants = db.collection('event_participants');
    const legacyRoles = Object.keys(ROLE_MAP);

    const counts = await participants.aggregate([
        { $match: { role: { $in: legacyRoles } } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
    ]).toArray();
    console.log('Legacy participant roles found:', counts.length ? counts : 'none');

    for (const [from, to] of Object.entries(ROLE_MAP)) {
        const filter = { role: from };
        const n = await participants.countDocuments(filter);
        if (n === 0) continue;
        if (DRY_RUN) {
            console.log(`[dry-run] would update ${n} participant(s): role '${from}' -> '${to}'`);
        } else {
            const res = await participants.updateMany(filter, { $set: { role: to } });
            console.log(`Updated ${res.modifiedCount} participant(s): role '${from}' -> '${to}'`);
        }
    }

    // 2. event_invitations.intended_role
    // Collection name from MODEL_NAMES.EVENT_INVITATION
    const invitationCollections = (await db.listCollections().toArray())
        .map(c => c.name)
        .filter(n => /invitation/i.test(n));

    for (const collName of invitationCollections) {
        const invitations = db.collection(collName);
        for (const [from, to] of Object.entries(ROLE_MAP)) {
            const filter = { intended_role: from };
            const n = await invitations.countDocuments(filter);
            if (n === 0) continue;
            if (DRY_RUN) {
                console.log(`[dry-run] would update ${n} doc(s) in ${collName}: intended_role '${from}' -> '${to}'`);
            } else {
                const res = await invitations.updateMany(filter, { $set: { intended_role: to } });
                console.log(`Updated ${res.modifiedCount} doc(s) in ${collName}: intended_role '${from}' -> '${to}'`);
            }
        }
    }

    // 3. Integrity check: every event creator should have a 'creator' participant record
    const events = db.collection('events');
    const eventsCursor = events.find({}, { projection: { _id: 1, created_by: 1, title: 1 } });
    let missingCreatorRecords = 0;

    for await (const ev of eventsCursor) {
        if (!ev.created_by) continue;
        const creatorRecord = await participants.findOne({
            event_id: ev._id,
            user_id: ev.created_by,
        });

        if (!creatorRecord) {
            missingCreatorRecords++;
            console.warn(`Event ${ev._id} ("${ev.title}"): creator ${ev.created_by} has NO participant record`);
            if (!DRY_RUN) {
                await participants.insertOne({
                    _id: new mongoose.Types.ObjectId(),
                    user_id: ev.created_by,
                    event_id: ev._id,
                    role: 'creator',
                    join_method: 'created_event',
                    status: 'active',
                    joined_at: new Date(),
                    last_activity_at: new Date(),
                });
                console.log(`  -> repaired: inserted creator participant record`);
            }
        } else if (creatorRecord.role !== 'creator') {
            console.warn(`Event ${ev._id} ("${ev.title}"): creator ${ev.created_by} has participant role '${creatorRecord.role}' (expected 'creator')`);
            if (!DRY_RUN) {
                await participants.updateOne(
                    { _id: creatorRecord._id },
                    { $set: { role: 'creator', status: 'active' } }
                );
                console.log(`  -> repaired: set role to 'creator'`);
            }
        }
    }

    console.log(`Done. Events missing creator participant records: ${missingCreatorRecords}`);
    await mongoose.disconnect();
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});

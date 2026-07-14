// scripts/drop-participant-permissions.ts
// One-time cleanup (RBAC Phase 3): remove the deprecated per-participant
// `permissions` blob from every event_participants document. Capabilities are
// now computed at request time from the central policy
// (src/configs/permissions.policy.ts) — role is the only assignment we persist.
//
// This is CLEANUP, not a correctness requirement: with `permissions` removed
// from the Mongoose schema (strict mode), the field is already ignored on reads
// and dropped on writes. This script reclaims the stored bytes and keeps the
// collection honest. Safe to run after deploying the schema change.
//
// Usage:
//   npx ts-node scripts/drop-participant-permissions.ts --dry-run   # report only
//   npx ts-node scripts/drop-participant-permissions.ts             # apply

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'rose-click';
const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
    if (!MONGO_URI) {
        console.error('MONGO_URI is not set in .env');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI, { dbName: MONGO_DB_NAME });
    const db = mongoose.connection.db;
    console.log(`Connected to ${MONGO_DB_NAME}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

    const participants = db.collection('event_participants');

    // Legacy docs may also carry the never-schema'd `permission_overrides` field
    // referenced by old model methods — clear it too while we're here.
    const filter = { $or: [{ permissions: { $exists: true } }, { permission_overrides: { $exists: true } }] };
    const n = await participants.countDocuments(filter);
    console.log(`Participants carrying a legacy permission blob: ${n}`);

    if (n === 0) {
        console.log('Nothing to do.');
    } else if (DRY_RUN) {
        console.log(`[dry-run] would $unset permissions/permission_overrides on ${n} document(s)`);
    } else {
        const res = await participants.updateMany(filter, {
            $unset: { permissions: '', permission_overrides: '' }
        });
        console.log(`Cleared permission blob on ${res.modifiedCount} document(s)`);
    }

    await mongoose.disconnect();
    console.log('Done.');
}

run().catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
});

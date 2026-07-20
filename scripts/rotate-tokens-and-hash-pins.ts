// scripts/rotate-tokens-and-hash-pins.ts
// One-time security migration:
//   1. Rotate all share/invite/guest-session tokens that were generated with
//      Math.random() to crypto-grade tokens (crypto.randomBytes, base64url).
//      Old links/QRs stop working — intended (forced rotation, pre-launch).
//   2. Hash any plaintext share_settings.password with bcrypt and set
//      share_settings.has_password.
//
// Usage:
//   npx ts-node scripts/rotate-tokens-and-hash-pins.ts --dry-run   # report only
//   npx ts-node scripts/rotate-tokens-and-hash-pins.ts             # apply

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'rose-click';
const DRY_RUN = process.argv.includes('--dry-run');

const secureToken = (prefix: string) =>
    `${prefix}_${crypto.randomBytes(16).toString('base64url')}`;

// Mirrors event-invitations.model.ts prefixMap
const INVITATION_PREFIX: Record<string, string> = {
    co_host_invite: 'coh',
    share_link: 'shr',
    email: 'eml',
    phone: 'sms',
    bulk_invite: 'blk',
};

async function run() {
    if (!MONGO_URI) {
        console.error('MONGO_URI is not set in .env');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI, { dbName: MONGO_DB_NAME });
    const db = mongoose.connection.db;
    console.log(`Connected to ${MONGO_DB_NAME}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

    // 1. events.share_token — rotate everything that isn't already crypto-format
    const events = db.collection('events');
    const cryptoFormat = /^evt_[A-Za-z0-9_-]{22}$/;
    const eventDocs = await events
        .find({ share_token: { $exists: true, $ne: null } }, { projection: { _id: 1, share_token: 1, title: 1 } })
        .toArray();

    for (const ev of eventDocs) {
        if (cryptoFormat.test(ev.share_token)) continue;
        const newToken = secureToken('evt');
        console.log(`event ${ev._id} ("${ev.title}"): ${ev.share_token} -> ${newToken}`);
        if (!DRY_RUN) {
            await events.updateOne({ _id: ev._id }, { $set: { share_token: newToken } });
        }
    }

    // 2. events.share_settings.password — hash plaintext PINs (bcrypt hashes start with $2)
    const pinDocs = await events
        .find(
            { 'share_settings.password': { $type: 'string', $not: /^\$2[aby]\$/ } },
            { projection: { _id: 1, title: 1 } }
        )
        .toArray();

    for (const ev of pinDocs) {
        console.log(`event ${ev._id} ("${ev.title}"): hashing plaintext PIN`);
        if (!DRY_RUN) {
            const doc = await events.findOne({ _id: ev._id }, { projection: { 'share_settings.password': 1 } });
            const plaintext = doc?.share_settings?.password;
            if (typeof plaintext === 'string' && plaintext.length > 0) {
                await events.updateOne(
                    { _id: ev._id },
                    {
                        $set: {
                            'share_settings.password': bcrypt.hashSync(plaintext, 10),
                            'share_settings.has_password': true,
                        },
                    }
                );
            }
        }
    }

    // Backfill has_password=false where no PIN is set
    const backfill = await events.countDocuments({
        'share_settings.has_password': { $exists: false },
    });
    if (backfill > 0) {
        console.log(`Backfilling share_settings.has_password=false on ${backfill} event(s) without a PIN`);
        if (!DRY_RUN) {
            await events.updateMany(
                { 'share_settings.has_password': { $exists: false }, 'share_settings.password': { $in: [null, ''] } },
                { $set: { 'share_settings.has_password': false } }
            );
        }
    }

    // 3. event_invitations.token
    const invitations = db.collection('event_invitations');
    const invDocs = await invitations
        .find({}, { projection: { _id: 1, token: 1, invitation_type: 1 } })
        .toArray();

    for (const inv of invDocs) {
        const prefix = INVITATION_PREFIX[inv.invitation_type] || 'inv';
        if (new RegExp(`^${prefix}_[A-Za-z0-9_-]{22}$`).test(inv.token)) continue;
        const newToken = secureToken(prefix);
        console.log(`invitation ${inv._id} (${inv.invitation_type}): ${inv.token} -> ${newToken}`);
        if (!DRY_RUN) {
            await invitations.updateOne({ _id: inv._id }, { $set: { token: newToken } });
        }
    }

    // 4. guest_sessions.session_id
    const sessions = db.collection('guest_sessions');
    const sessionDocs = await sessions.find({}, { projection: { _id: 1, session_id: 1 } }).toArray();

    for (const s of sessionDocs) {
        if (/^gs_[A-Za-z0-9_-]{22}$/.test(s.session_id)) continue;
        const newId = secureToken('gs');
        console.log(`guest_session ${s._id}: ${s.session_id} -> ${newId}`);
        if (!DRY_RUN) {
            await sessions.updateOne({ _id: s._id }, { $set: { session_id: newId } });
        }
    }

    console.log('Done.');
    await mongoose.disconnect();
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});

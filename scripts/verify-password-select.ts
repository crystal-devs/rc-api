import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });
import { Event } from '../src/models/event.model';

async function run() {
    await mongoose.connect(process.env.MONGO_URI!, { dbName: process.env.MONGO_DB_NAME || 'rose-click' });

    const ev1: any = await Event.findOne({ 'share_settings.has_password': true }).lean();
    console.log('default query:', ev1?.share_settings?.password === undefined ? 'EXCLUDED OK' : 'LEAKED BAD');

    const ev2: any = await Event.findOne({ 'share_settings.has_password': true })
        .select('_id title visibility permissions created_by share_settings.is_active share_settings.expires_at share_settings.has_password +share_settings.password').lean();
    const pw = ev2?.share_settings?.password;
    console.log('middleware-style select:', typeof pw === 'string' && pw.startsWith('$2') ? 'HASH INCLUDED OK' : 'MISSING BAD');
    console.log('  is_active present:', ev2?.share_settings?.is_active !== undefined ? 'OK' : 'BAD');

    const ev3: any = await Event.findOne({ 'share_settings.has_password': true }).select('_id title share_settings').lean();
    console.log('parent-path select:', ev3?.share_settings?.password === undefined ? 'EXCLUDED OK' : 'LEAKED BAD');

    await mongoose.disconnect();
}
run().catch(e => { console.error(e.message); process.exit(1); });

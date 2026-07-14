// Temporary smoke test: verify template defaults + face_recognition persist
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });
import { Event } from '../src/models/event.model';
import { getTemplateDefaults } from '../src/services/event/template-defaults';

async function run() {
    await mongoose.connect(process.env.MONGO_URI!, { dbName: process.env.MONGO_DB_NAME || 'rose-click' });

    for (const tpl of ['wedding', 'birthday'] as const) {
        const d = getTemplateDefaults(tpl);
        const ev = new Event({
            title: `__smoke_${tpl}__`,
            template: tpl,
            created_by: new mongoose.Types.ObjectId(),
            visibility: d.visibility,
            permissions: d.permissions,
            face_recognition: { enabled: tpl === 'wedding' }, // host opted in for wedding
        });
        const saved = await ev.save();
        const back: any = await Event.findById(saved._id).lean();
        console.log(`${tpl}:`,
            'visibility=' + back.visibility,
            'upload=' + back.permissions.can_upload,
            'approval=' + back.permissions.require_approval,
            'faces=' + back.face_recognition.enabled,
            'consent_v=' + back.face_recognition.consent_version,
            'retention=' + back.face_recognition.retention_days,
            'token=' + back.share_token
        );
        await Event.deleteOne({ _id: saved._id });
    }
    await mongoose.disconnect();
}
run().catch(e => { console.error(e.message); process.exit(1); });


import mongoose from 'mongoose';
import { Event } from '../src/models/event.model';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });
const MONGODB_URI = process.env.MONGODB_URI?.replace('localhost', '127.0.0.1') || "mongodb://127.0.0.1:27017/clicky";

import fs from 'fs';

async function getToken() {
    try {
        await mongoose.connect(MONGODB_URI);
        const event = await Event.findOne({}).sort({ created_at: -1 });
        if (event) {
            console.log(`TOKEN:${event.share_token}`);
            fs.writeFileSync('scripts/token.txt', event.share_token || '');
        } else {
            console.log("NO_EVENT_FOUND");
        }
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
getToken();

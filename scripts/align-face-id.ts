
import mongoose from 'mongoose';
import { Media } from '../src/models/media.model';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

// Force connection string to ensure we hit the right DB
const MONGODB_URI = "mongodb+srv://crystalinsiders:REDACTED@crystal-cluster.xjaeb.mongodb.net/rose-click";

// Target Event
const EVENT_ID = "68d2bc87196092f05224c2dd";
const USER_FACE_ID = "1bbb78d6-68ba-4d6e-9940-1460196e3675";

async function run() {
    try {
        console.log("Connecting...");
        await mongoose.connect(MONGODB_URI);

        console.log(`Updating Media for Event: ${EVENT_ID}`);

        // 2. Select 200 random photos to tag using the REAL model
        const photos = await Media.find({ event_id: new mongoose.Types.ObjectId(EVENT_ID) }).limit(200);
        console.log(`Found ${photos.length} photos to tag.`);

        if (photos.length === 0) {
            console.log("❌ No photos found! Check EVENT_ID or Collection.");
            process.exit(1);
        }

        const idsToUpdate = photos.map(p => p._id);

        const result = await Media.updateMany(
            { _id: { $in: idsToUpdate } },
            {
                $set: {
                    faces: [{
                        faceId: USER_FACE_ID,
                        confidence: 99.9,
                        boundingBox: { Width: 0.2, Height: 0.2, Left: 0.4, Top: 0.4 }
                    }]
                }
            }
        );

        console.log("\n=============================");
        console.log(`✅ FORCED UPDATE: ${result.modifiedCount} PHOTOS TAGGED WITH USER FACE`);
        console.log("=============================\n");

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
run();

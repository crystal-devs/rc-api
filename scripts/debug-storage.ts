
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MEDIA_COLLECTION = 'medias';
const EVENTS_COLLECTION = 'events';

const userId = '681cca8780c238afd38fbccd'; // The user from the request

async function debugStorage() {
    try {
        console.log('Connecting to MongoDB...');
        const uri = process.env.MONGO_URI || '';
        const dbName = process.env.MONGO_DB_NAME || 'rose-click';
        // Ensure URI ends with slash if appending, or use dbName option
        await mongoose.connect(uri, { dbName });
        console.log(`Connected to ${dbName}.`);

        // 1. Get User Events
        const events = await mongoose.connection.db?.collection(EVENTS_COLLECTION)
            .find({ created_by: new mongoose.Types.ObjectId(userId) })
            .toArray();

        if (!events) {
            console.log('No events found.');
            return;
        }

        const eventIds = events.map(e => e._id);
        console.log(`Found ${events.length} events owned by user.`);
        console.log('Event IDs:', eventIds);

        // 2. Check a few media items
        const sampleMedia = await mongoose.connection.db?.collection(MEDIA_COLLECTION)
            .find({ event_id: { $in: eventIds } })
            .limit(5)
            .toArray();

        console.log('\nSample Media Items (first 5):');
        sampleMedia?.forEach((m, i) => {
            console.log(`[${i}] ID: ${m._id}, Type: ${m.type}, Size (root): ${m.size_mb}, Original.Size: ${m.original?.size_mb}`);
        });

        // 3. Run Aggregation - Current Logic (original.size_mb)
        console.log('\nRunning Aggregation ($original.size_mb)...');
        const aggResultOriginal = await mongoose.connection.db?.collection(MEDIA_COLLECTION).aggregate([
            {
                $match: {
                    event_id: { $in: eventIds },
                    // isDeleted: { $ne: true } // Check raw first without this filter to see if field exists
                }
            },
            {
                $group: {
                    _id: null,
                    totalStorage: { $sum: "$original.size_mb" },
                    count: { $sum: 1 }
                }
            }
        ]).toArray();
        console.log('Result (original.size_mb):', aggResultOriginal);

        // 4. Run Aggregation - Root size_mb
        console.log('\nRunning Aggregation ($size_mb)...');
        const aggResultRoot = await mongoose.connection.db?.collection(MEDIA_COLLECTION).aggregate([
            {
                $match: {
                    event_id: { $in: eventIds }
                }
            },
            {
                $group: {
                    _id: null,
                    totalStorage: { $sum: "$size_mb" },
                    count: { $sum: 1 }
                }
            }
        ]).toArray();
        console.log('Result ($size_mb):', aggResultRoot);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

debugStorage();

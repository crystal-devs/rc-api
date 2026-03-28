import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { Event } from '../src/models/event.model';
import { Media } from '../src/models/media.model';

dotenv.config();

async function run() {
    try {
        const mongoUri = process.env.MONGO_URI;
        const dbName = process.env.MONGO_DB_NAME;
        
        if (!mongoUri || !dbName) {
            console.error('MongoDB connection details missing in environment variables');
            process.exit(1);
        }

        console.log(`Connecting to ${mongoUri}/${dbName}...`);
        await mongoose.connect(mongoUri, { dbName });
        console.log('Connected to MongoDB');

        const events = await Event.find({});
        console.log(`Found ${events.length} events to process.`);

        for (const event of events) {
            const eventId = event._id;

            const mediaItems = await Media.find({ event_id: eventId, isDeleted: false }).lean();
            
            let photos = 0;
            let videos = 0;
            let pending_approval = 0;
            let total_size_mb = 0;

            for (let _media of mediaItems) {
                const media = _media as any;
                const status = media.approval?.status || media.status || 'pending';
                const isApproved = status === 'approved' || status === 'auto_approved';
                const isPending = status === 'pending';
                
                if (media.type === 'image' && isApproved) photos++;
                if (media.type === 'video' && isApproved) videos++;
                if (isPending) pending_approval++;

                // Fallback size extraction
                let sizeToAdd = 0;
                
                if (media.original && typeof media.original.size_mb === 'number') {
                    sizeToAdd = media.original.size_mb;
                } else if (typeof media.size_mb === 'number') {
                    sizeToAdd = media.size_mb;
                } else if (media.metadata && typeof media.metadata.size === 'number') {
                    // if size is in bytes
                    sizeToAdd = media.metadata.size / (1024 * 1024);
                }

                if (sizeToAdd < 0) sizeToAdd = 0; // Fix negative sizes
                
                total_size_mb += sizeToAdd;
            }

            const stats = { photos, videos, pending_approval, total_size_mb };
            console.log(`Event ${event.title} (${eventId}) stats updated to:`, stats);

            await Event.updateOne(
                { _id: eventId },
                {
                    $set: {
                        'stats.photos': stats.photos,
                        'stats.videos': stats.videos,
                        'stats.pending_approval': stats.pending_approval,
                        'stats.total_size_mb': stats.total_size_mb,
                        'updated_at': new Date()
                    }
                }
            );
        }
        
        console.log("Recalculation complete.");
    } catch (error) {
        console.error('Failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

run();

// Debug helper to monitor share token creation
import mongoose from 'mongoose';
import { MODEL_NAMES } from './names';

// Set up a change stream to monitor share token creation
export const monitorShareTokens = async () => {
    try {
        const ShareToken = mongoose.model(MODEL_NAMES.SHARE_TOKEN);
        
        // Watch for changes to the share-tokens collection
        const changeStream = ShareToken.watch();
        
        // Log whenever a document is created
        changeStream.on('change', (change) => {
            if (change.operationType === 'insert') {
                console.log('✅ SHARE TOKEN CREATED:', {
                    id: change.fullDocument._id,
                    token: change.fullDocument.token,
                    eventId: change.fullDocument.event_id,
                    createdAt: change.fullDocument.created_at
                });
            }
        });
        
        console.log('🔍 Monitoring share token creation...');
        return changeStream;
    } catch (err) {
        console.error('Failed to set up share token monitoring:', err);
        return null;
    }
};

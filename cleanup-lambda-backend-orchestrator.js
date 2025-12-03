/**
 * Backend Cleanup Endpoint
 * 
 * Add this to your existing Node.js backend
 * This is the actual cleanup logic - reuses your existing MongoDB connection
 */

import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import express from 'express';

const router = express.Router();
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Authentication middleware for admin endpoints
const adminAuth = (req, res, next) => {
  const apiKey = req.headers.authorization?.split(' ')[1];
  
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

/**
 * POST /admin/cleanup-media
 * 
 * Cleans up deleted media documents and S3 objects
 * Can be triggered by:
 * - EventBridge Lambda (scheduled)
 * - Manual API call from dashboard
 * - Another backend service
 */
router.post('/admin/cleanup-media', adminAuth, async (req, res) => {
  console.log('Starting cleanup job');

  const stats = {
    scanned: 0,
    deleted: 0,
    failed: 0,
    startTime: Date.now(),
    errors: []
  };

  try {
    // Get your existing MongoDB connection
    // Assuming you have a global db connection from your app setup
    const db = req.app.locals.db;
    
    if (!db) {
      return res.status(500).json({ error: 'Database connection not available' });
    }

    const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    console.log(`Searching for media deleted before: ${cutoff.toISOString()}`);

    // Query deleted media using cursor (memory efficient)
    const cursor = db.collection('media').find(
      {
        isDeleted: true,
        deletedAt: { $lt: cutoff },
        deletionStatus: { $ne: 'done' }
      },
      {
        projection: { _id: 1, s3Keys: 1, uploadId: 1, deletionAttempts: 1 },
        batchSize: 100
      }
    );

    let batch = [];
    const BATCH_SIZE = 100;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      stats.scanned++;
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        await processBatch(db, batch, stats);
        batch = [];
      }
    }

    // Process remaining documents
    if (batch.length > 0) {
      await processBatch(db, batch, stats);
    }

    await cursor.close();

    const duration = Date.now() - stats.startTime;
    console.log(`Cleanup complete: scanned=${stats.scanned}, deleted=${stats.deleted}, failed=${stats.failed}, duration=${duration}ms`);

    res.json({
      status: 'ok',
      message: 'Cleanup completed successfully',
      stats: {
        ...stats,
        duration: `${duration}ms`,
        successRate: stats.scanned > 0 ? ((stats.deleted / stats.scanned) * 100).toFixed(2) + '%' : 'N/A'
      }
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Cleanup failed',
      error: error.message,
      stats
    });
  }
});

/**
 * Process a batch of documents
 */
async function processBatch(db, batch, stats) {
  for (const doc of batch) {
    try {
      await processDocument(db, doc, stats);
    } catch (error) {
      console.error(`Error processing document ${doc._id}:`, error.message);
      stats.failed++;
      stats.errors.push({
        docId: doc._id.toString(),
        error: error.message
      });
    }
  }
}

/**
 * Process a single document
 */
async function processDocument(db, doc, stats) {
  const docId = doc._id;
  const s3Keys = doc.s3Keys || [];

  // Validate S3 keys exist
  if (s3Keys.length === 0) {
    console.warn(`No S3 keys for media ${docId}`);
    
    await db.collection('media').updateOne(
      { _id: docId },
      {
        $set: {
          deletionStatus: 'failed',
          deletionError: 'no_s3_keys_found',
          lastDeletionAttemptAt: new Date()
        },
        $inc: { deletionAttempts: 1 }
      }
    );
    
    stats.failed++;
    return;
  }

  // Delete from S3
  try {
    await deleteFromS3(s3Keys, docId);
    
    // Hard delete from MongoDB
    const result = await db.collection('media').deleteOne({ _id: docId });
    
    if (result.deletedCount > 0) {
      console.log(`Deleted media ${docId} - S3 keys: ${s3Keys.length}`);
      stats.deleted++;
    }
  } catch (error) {
    // Mark as failed
    const attempts = doc.deletionAttempts || 0;
    
    await db.collection('media').updateOne(
      { _id: docId },
      {
        $set: {
          deletionStatus: attempts >= 5 ? 'permanent_failed' : 'failed',
          deletionError: error.message,
          lastDeletionAttemptAt: new Date()
        },
        $inc: { deletionAttempts: 1 }
      }
    );

    stats.failed++;
    throw error;
  }
}

/**
 * Delete files from S3 with retry logic
 */
async function deleteFromS3(keys, docId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const s3Objects = keys.map(key => ({ Key: key }));
      
      // Delete in batches (S3 max is 1000 per request)
      for (let i = 0; i < s3Objects.length; i += 1000) {
        const batch = s3Objects.slice(i, i + 1000);
        
        const result = await s3.send(
          new DeleteObjectsCommand({
            Bucket: process.env.BUCKET_NAME,
            Delete: { Objects: batch }
          })
        );

        if (result.Errors?.length > 0) {
          console.warn(`S3 deletion errors for ${docId}:`, result.Errors);
          throw new Error(`S3 partial failure: ${result.Errors.length} errors`);
        }
      }

      return; // Success

    } catch (error) {
      console.error(`S3 deletion attempt ${attempt}/${maxRetries} failed for ${docId}:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, attempt - 1) * 100)
      );
    }
  }
}

export default router;

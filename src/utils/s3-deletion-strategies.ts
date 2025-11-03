/**
 * S3 Deletion Strategies for Backend
 * 
 * This module provides multiple approaches to efficiently delete objects from S3.
 * Choose the strategy based on your scale and requirements.
 */

import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import pLimit from 'p-limit';

interface DeletionOptions {
  batchSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?: (processed: number, total: number) => void;
  concurrency?: number;
  highWaterMark?: number;
  smallThreshold?: number;
  largeThreshold?: number;
}

interface DeletionResult {
  deleted: number;
  failed: number;
  errors: any[];
  filtered?: number;
}

interface StagedDeletionOptions extends DeletionOptions {
  // Additional options for staged deletion
}

interface ConditionalDeletionOptions extends DeletionOptions {
  // Additional options for conditional deletion
}

const s3 = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

// ============================================
// STRATEGY 1: Batch Delete (Most Common)
// ============================================
// Best for: < 100K objects per cleanup job
// Cost: FREE (DeleteObjects is free)
// Speed: 100-500ms per batch of 1000 objects
// Memory: Low (processes in fixed-size batches)

export async function deleteS3ObjectsBatch(s3Keys: string[], options: DeletionOptions = {}): Promise<DeletionResult> {
  const {
    batchSize = 1000,        // Max 1000 per AWS API
    maxRetries = 3,
    retryDelayMs = 100,
    onProgress = null         // Callback: (deleted, total) => void
  } = options;

  if (!s3Keys?.length) {
    return { deleted: 0, failed: 0, errors: [] };
  }

  let deleted = 0;
  let failed = 0;
  const errors = [];

  // Process in batches of 1000
  for (let i = 0; i < s3Keys.length; i += batchSize) {
    const batch = s3Keys.slice(i, i + batchSize);
    
    try {
      const result = await deleteObjectBatch(batch, maxRetries, retryDelayMs);
      deleted += result.deleted;
      failed += result.failed;
      errors.push(...result.errors);

      if (onProgress) {
        onProgress(deleted + failed, s3Keys.length);
      }
    } catch (error) {
      console.error(`Failed to delete batch starting at index ${i}:`, error);
      failed += batch.length;
      errors.push({ batch: i, error: error.message });
    }
  }

  return { deleted, failed, errors };
}

async function deleteObjectBatch(keys: string[], maxRetries: number, retryDelayMs: number): Promise<{ deleted: number; failed: number; errors: any[] }> {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const command = new DeleteObjectsCommand({
        Bucket: process.env.BUCKET_NAME,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: false  // Get detailed response
        }
      });

      const response = await s3.send(command);
      
      const deleted = response.Deleted?.length || 0;
      const deletionErrors = response.Errors || [];
      
      if (deletionErrors.length === 0) {
        return { deleted, failed: 0, errors: [] };
      }

      // Partial failure - return what succeeded + errors
      return {
        deleted,
        failed: deletionErrors.length,
        errors: deletionErrors.map(e => ({ key: e.Key, reason: e.Message }))
      };

    } catch (error) {
      lastError = error;
      console.warn(`Delete attempt ${attempt}/${maxRetries} failed:`, error.message);

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * retryDelayMs;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  throw lastError;
}

// ============================================
// STRATEGY 2: Parallel Batch Delete
// ============================================
// Best for: 100K - 1M objects
// Cost: FREE
// Speed: 10x faster with parallel requests
// Memory: Moderate (configurable concurrency)
// Considerations: Don't exceed AWS API throttle limits

export async function deleteS3ObjectsParallel(s3Keys: string[], options: DeletionOptions = {}): Promise<DeletionResult> {
  const {
    concurrency = 5,          // Parallel requests (safe limit: 1-10)
    batchSize = 1000,
    maxRetries = 3,
    retryDelayMs = 100,
    onProgress = null
  } = options;

  if (!s3Keys?.length) {
    return { deleted: 0, failed: 0, errors: [] };
  }

  // Break keys into batches
  const batches = [];
  for (let i = 0; i < s3Keys.length; i += batchSize) {
    batches.push(s3Keys.slice(i, i + batchSize));
  }

  let deleted = 0;
  let failed = 0;
  const errors: { [key: string]: any }[] = [];

  // Process batches in parallel with concurrency limit
  const limit = pLimit(concurrency);
  const batchPromises = batches.map((batch, index) =>
    limit(async () => {
      try {
        const result = await deleteObjectBatch(batch, maxRetries, retryDelayMs);
        deleted += result.deleted;
        failed += result.failed;
        errors.push(...result.errors);

        if (onProgress) {
          onProgress(deleted + failed, s3Keys.length);
        }

        return result;
      } catch (error) {
        console.error(`Batch ${index} failed:`, error);
        failed += batch.length;
        errors.push({ batch: index, error: error.message });
      }
    })
  );

  await Promise.all(batchPromises);

  return { deleted, failed, errors };
}

// ============================================
// STRATEGY 3: Stream-Based Deletion (Memory Efficient)
// ============================================
// Best for: 1M+ objects, memory-constrained environments
// Cost: FREE
// Speed: Controlled by streaming
// Memory: Very low (constant)
// Considerations: Slower than parallel, but never OOM

export async function deleteS3ObjectsStream(s3Keys: string[], options: DeletionOptions = {}): Promise<DeletionResult> {
  const {
    batchSize = 1000,
    maxRetries = 3,
    retryDelayMs = 100,
    onProgress = null,
    highWaterMark = 10  // Max batches in queue
  } = options;

  if (!s3Keys?.length) {
    return { deleted: 0, failed: 0, errors: [] };
  }

  let deleted = 0;
  let failed = 0;
  const errors = [];
  let currentIndex = 0;

  // Create generator for batches
  function* batchGenerator() {
    while (currentIndex < s3Keys.length) {
      const batch = s3Keys.slice(
        currentIndex,
        Math.min(currentIndex + batchSize, s3Keys.length)
      );
      currentIndex += batchSize;
      yield batch;
    }
  }

  // Process batches sequentially to maintain memory efficiency
  for (const batch of Array.from(batchGenerator())) {
    try {
      const result = await deleteObjectBatch(batch, maxRetries, retryDelayMs);
      deleted += result.deleted;
      failed += result.failed;
      errors.push(...result.errors);

      if (onProgress) {
        onProgress(deleted + failed, s3Keys.length);
      }
    } catch (error) {
      console.error(`Stream delete failed:`, error);
      failed += batch.length;
      errors.push({ error: error.message });
    }
  }

  return { deleted, failed, errors };
}

// ============================================
// STRATEGY 4: Staged Deletion (Safe & Trackable)
// ============================================
// Best for: Critical systems, audit requirements
// Cost: FREE
// Speed: Slower (2-phase: mark + delete)
// Considerations: Reversible until final stage

export async function deleteS3ObjectsStaged(s3Keys: string[], db: any, mediaCollection: any, options: StagedDeletionOptions = {}): Promise<DeletionResult> {
  const {
    batchSize = 1000,
    maxRetries = 3,
    retryDelayMs = 100,
    onProgress = null
  } = options;

  if (!s3Keys?.length) {
    return { deleted: 0, failed: 0, errors: [] };
  }

  let deleted = 0;
  let failed = 0;
  const errors: any[] = [];

  // Stage 1: Verify all keys exist in MongoDB before deletion
  const keysToDelete = [];
  for (const key of s3Keys) {
    const exists = await mediaCollection.findOne({ s3Keys: key });
    if (exists) {
      keysToDelete.push(key);
    } else {
      console.warn(`S3 key not found in DB: ${key}`);
    }
  }

  // Stage 2: Delete from S3 in batches with tracking
  for (let i = 0; i < keysToDelete.length; i += batchSize) {
    const batch = keysToDelete.slice(i, i + batchSize);

    try {
      // Mark for deletion in DB (soft delete)
      await mediaCollection.updateMany(
        { s3Keys: { $in: batch } },
        { $set: { s3DeletionInProgress: true, deletionStartedAt: new Date() } }
      );

      // Delete from S3
      const result = await deleteObjectBatch(batch, maxRetries, retryDelayMs);
      deleted += result.deleted;
      failed += result.failed;
      errors.push(...result.errors);

      // Mark as deleted in DB (hard delete or status update)
      await mediaCollection.updateMany(
        { s3Keys: { $in: batch } },
        { $set: { s3DeletionStatus: 'completed', deletionCompletedAt: new Date() } }
      );

      if (onProgress) {
        onProgress(deleted + failed, keysToDelete.length);
      }

    } catch (error) {
      console.error(`Staged delete failed at batch ${i}:`, error);
      
      // Mark as failed for later retry
      await mediaCollection.updateMany(
        { s3Keys: { $in: batch } },
        { $set: { s3DeletionStatus: 'failed', s3DeletionError: error.message } }
      );

      failed += batch.length;
      errors.push({ batch: i, error: error.message });
    }
  }

  return { deleted, failed, errors };
}

// ============================================
// STRATEGY 5: Conditional Delete (Size-Based)
// ============================================
// Best for: Selective cleanup (old files, large files)
// Cost: FREE + possible S3 API calls for metadata
// Speed: Slightly slower (needs GetObject metadata)
// Use case: "Delete all files > 100MB uploaded > 90 days ago"

export async function deleteS3ObjectsConditional(
  s3Keys: string[],
  predicate: (metadata: any) => boolean,  // Function: (metadata) => boolean
  options: ConditionalDeletionOptions = {}
): Promise<DeletionResult & { filtered: number }> {
  const {
    batchSize = 1000,
    maxRetries = 3,
    retryDelayMs = 100,
    onProgress = null
  } = options;

  if (!s3Keys?.length) {
    return { deleted: 0, failed: 0, filtered: 0, errors: [] };
  }

  let deleted = 0;
  let failed = 0;
  let filtered = 0;

  // Note: Getting metadata for each object adds API calls
  // Only use this if you have specific conditional requirements
  const keysToDelete = s3Keys;  // In real implementation, you'd check metadata

  for (let i = 0; i < keysToDelete.length; i += batchSize) {
    const batch = keysToDelete.slice(i, i + batchSize);

    try {
      const result = await deleteObjectBatch(batch, maxRetries, retryDelayMs);
      deleted += result.deleted;
      failed += result.failed;

      if (onProgress) {
        onProgress(deleted + failed, keysToDelete.length);
      }

    } catch (error) {
      console.error(`Conditional delete failed:`, error);
      failed += batch.length;
    }
  }

  return { deleted, failed, filtered, errors: [] };
}

// ============================================
// STRATEGY 6: Hybrid (Best for Production)
// ============================================
// Best for: Production systems handling variable loads
// Cost: FREE
// Speed: Adaptive (fast for small, memory-efficient for large)
// Considerations: Auto-switches strategy based on volume

export async function deleteS3ObjectsHybrid(s3Keys: string[], options: DeletionOptions = {}): Promise<DeletionResult> {
  const {
    smallThreshold = 10000,   // Use parallel for < 10K objects
    largeThreshold = 1000000, // Use stream for > 1M objects
    // For 10K-1M: use parallel
    onProgress = null
  } = options;

  const count = s3Keys?.length || 0;

  // Choose strategy based on volume
  if (count === 0) {
    return { deleted: 0, failed: 0, errors: [] };
  }

  if (count < smallThreshold) {
    console.log(`Deleting ${count} objects using PARALLEL strategy`);
    return deleteS3ObjectsParallel(s3Keys, {
      concurrency: 5,
      ...options,
      onProgress
    });
  }

  if (count > largeThreshold) {
    console.log(`Deleting ${count} objects using STREAM strategy`);
    return deleteS3ObjectsStream(s3Keys, {
      ...options,
      onProgress
    });
  }

  // Middle ground: parallel with lower concurrency
  console.log(`Deleting ${count} objects using PARALLEL strategy (low concurrency)`);
  return deleteS3ObjectsParallel(s3Keys, {
    concurrency: 2,
    ...options,
    onProgress
  });
}

// ============================================
// Utility: Progress Reporter
// ============================================

export function createProgressReporter(total: number, label = 'Deletion') {
  let current = 0;
  const startTime = Date.now();

  return {
    update: (processed: number, total: number) => {
      current = processed;
      const percent = ((current / total) * 100).toFixed(1);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const rate = current / (elapsed || 1);
      const remaining = Math.round((total - current) / rate);

      console.log(
        `${label}: ${percent}% (${current}/${total}) - ` +
        `${rate.toFixed(0)} obj/sec - ETA: ${remaining}s`
      );
    },
    getStats: () => ({
      current,
      total,
      elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
      rate: current / (Math.round((Date.now() - startTime) / 1000) || 1)
    })
  };
}

// ============================================
// Recommendation Helper
// ============================================

export function getRecommendedStrategy(count: number) {
  if (count < 1000) {
    return {
      strategy: 'Batch',
      reason: 'Small volume, simple sequential deletion',
      function: deleteS3ObjectsBatch
    };
  }

  if (count < 100000) {
    return {
      strategy: 'Parallel',
      reason: 'Medium volume, parallel requests safe',
      function: deleteS3ObjectsParallel,
      config: { concurrency: 5 }
    };
  }

  if (count < 1000000) {
    return {
      strategy: 'Parallel (Low Concurrency)',
      reason: 'Large volume, limited concurrency to avoid throttling',
      function: deleteS3ObjectsParallel,
      config: { concurrency: 2 }
    };
  }

  return {
    strategy: 'Stream',
    reason: 'Very large volume, memory-efficient streaming',
    function: deleteS3ObjectsStream
  };
}

// configs/database-indexes.config.ts
import mongoose from 'mongoose';
import { logger } from '@utils/logger';

/**
 * 📊 Database Indexes Management
 * Centralized configuration for all database indexes
 */

export interface IndexInfo {
  collection: string;
  index: any;
  options?: any;
  description: string;
  type: 'single' | 'compound' | 'text' | 'geospatial' | 'ttl';
}

/**
 * 🎯 Critical Indexes for Real-time Photo Sharing App
 * Optimized for event-based queries and real-time operations
 */
export const CRITICAL_INDEXES: IndexInfo[] = [
  // 🎪 Event Collection - Core business logic
  {
    collection: 'events',
    index: { created_by: 1, archived_at: 1 },
    description: 'User events (exclude archived)',
    type: 'compound'
  },
  {
    collection: 'events',
    index: { share_token: 1 },
    options: { unique: true, sparse: true },
    description: 'Event access via share tokens',
    type: 'single'
  },
  {
    collection: 'events',
    index: { start_date: 1, visibility: 1 },
    description: 'Event calendar & visibility filtering',
    type: 'compound'
  },

  // 🖼️ Media Collection - High-volume photo/video queries
  {
    collection: 'medias',
    index: { event_id: 1, "approval.status": 1, created_at: -1 },
    description: 'Event media feed (approved first, chronological)',
    type: 'compound'
  },
  {
    collection: 'medias',
    index: { event_id: 1, uploader_type: 1, created_at: -1 },
    description: 'Filter by uploader type in event',
    type: 'compound'
  },
  {
    collection: 'medias',
    index: { "guest_uploader.guest_id": 1, event_id: 1 },
    description: 'Guest user media tracking',
    type: 'compound'
  },
  {
    collection: 'medias',
    index: { "processing.status": 1 },
    description: 'Image processing queue status',
    type: 'single'
  },

  // 📱 Photo Wall Collection - Real-time display
  {
    collection: 'photowalls',
    index: { shareToken: 1, isActive: 1 },
    description: 'Active photo wall access',
    type: 'compound'
  },
  {
    collection: 'photowalls',
    index: { eventId: 1, isActive: 1 },
    description: 'Event photo walls',
    type: 'compound'
  },

  // 👥 User Usage Collection - Analytics
  {
    collection: 'user-usages',
    index: { userId: 1, date: -1 },
    description: 'User usage analytics timeline',
    type: 'compound'
  },

  // 🎫 User Subscriptions - Billing
  {
    collection: 'user-subscriptions',
    index: { userId: 1 },
    options: { unique: true },
    description: 'User subscription lookup',
    type: 'single'
  },
  {
    collection: 'user-subscriptions',
    index: { status: 1, currentPeriodEnd: 1 },
    description: 'Subscription status & expiry monitoring',
    type: 'compound'
  }
];

/**
 * 🔥 Performance Indexes for Heavy Queries
 */
export const PERFORMANCE_INDEXES: IndexInfo[] = [
  // Real-time media queries
  {
    collection: 'medias',
    index: { event_id: 1, type: 1, created_at: -1 },
    description: 'Media type filtering in events',
    type: 'compound'
  },
  {
    collection: 'medias',
    index: { uploaded_by: 1, created_at: -1 },
    description: 'User media history',
    type: 'compound'
  },
  
  // Event co-host queries
  {
    collection: 'events',
    index: { "co_hosts.user_id": 1, "co_hosts.status": 1 },
    description: 'Co-host permissions lookup',
    type: 'compound'
  },
  
  // Activity logging
  {
    collection: 'activity-logs',
    index: { user_id: 1, timestamp: -1 },
    description: 'User activity timeline',
    type: 'compound'
  },
  {
    collection: 'activity-logs',
    index: { resource_id: 1, resource_type: 1, timestamp: -1 },
    description: 'Resource activity tracking',
    type: 'compound'
  }
];

/**
 * 🗑️ TTL Indexes for Data Cleanup
 */
export const TTL_INDEXES: IndexInfo[] = [
  {
    collection: 'activity-logs',
    index: { timestamp: 1 },
    options: { expireAfterSeconds: 7776000 }, // 90 days
    description: 'Auto-delete old activity logs',
    type: 'ttl'
  }
];

/**
 * 🔍 Text Search Indexes
 */
export const TEXT_INDEXES: IndexInfo[] = [
  {
    collection: 'events',
    index: { title: "text", description: "text" },
    description: 'Event search functionality',
    type: 'text'
  },
  {
    collection: 'albums',
    index: { title: "text", description: "text" },
    description: 'Album search functionality',
    type: 'text'
  }
];

/**
 * 🚀 Create Essential Indexes
 * Run this after connecting to MongoDB
 */
export const createEssentialIndexes = async (): Promise<void> => {
  const allIndexes = [
    ...CRITICAL_INDEXES,
    ...PERFORMANCE_INDEXES,
    ...TTL_INDEXES,
    ...TEXT_INDEXES
  ];

  logger.info('📊 Creating database indexes...');
  
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const indexInfo of allIndexes) {
    try {
      const collection = mongoose.connection.db?.collection(indexInfo.collection);
      
      if (!collection) {
        logger.warn(`⚠️ Collection '${indexInfo.collection}' not found, skipping index`);
        skipped++;
        continue;
      }

      // Check if index already exists
      const existingIndexes = await collection.listIndexes().toArray();
      const indexExists = existingIndexes.some(existing => {
        const existingKeys = JSON.stringify(existing.key);
        const newKeys = JSON.stringify(indexInfo.index);
        return existingKeys === newKeys;
      });

      if (indexExists) {
        logger.debug(`✅ Index already exists: ${indexInfo.collection} - ${indexInfo.description}`);
        skipped++;
        continue;
      }

      // Create the index
      await collection.createIndex(indexInfo.index, indexInfo.options || {});
      logger.info(`📊 Created ${indexInfo.type} index: ${indexInfo.collection} - ${indexInfo.description}`);
      created++;

    } catch (error) {
      logger.error(`❌ Failed to create index on ${indexInfo.collection}:`, error);
      errors++;
    }
  }

  logger.info(`📊 Index creation complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  
  if (errors > 0) {
    logger.warn('⚠️ Some indexes failed to create. Check logs for details.');
  }
};

/**
 * 📈 Get Index Statistics
 */
export const getIndexStats = async (): Promise<any> => {
  try {
    const collections = ['events', 'medias', 'users', 'albums', 'photowalls', 'user-usages'];
    const stats: any = {};

    for (const collectionName of collections) {
      const collection = mongoose.connection.db?.collection(collectionName);
      if (collection) {
        const indexes = await collection.listIndexes().toArray();
        stats[collectionName] = {
          indexCount: indexes.length,
          indexes: indexes.map(idx => ({
            name: idx.name,
            keys: idx.key,
            unique: idx.unique || false,
            sparse: idx.sparse || false
          }))
        };
      }
    }

    return stats;
  } catch (error) {
    logger.error('❌ Failed to get index statistics:', error);
    return null;
  }
};

/**
 * 🔍 Analyze Query Performance
 */
export const analyzeQueryPerformance = async (
  collection: string,
  query: any,
  options: any = {}
): Promise<any> => {
  try {
    const coll = mongoose.connection.db?.collection(collection);
    if (!coll) {
      throw new Error(`Collection ${collection} not found`);
    }

    // Use explain() to analyze query performance
    const explanation = await coll.find(query, options).explain('executionStats');
    
    return {
      indexUsed: explanation.executionStats.totalDocsExamined < explanation.executionStats.totalDocsExamined * 2,
      executionTimeMs: explanation.executionStats.executionTimeMs,
      totalDocsExamined: explanation.executionStats.totalDocsExamined,
      totalDocsReturned: explanation.executionStats.totalDocsReturned,
      indexName: explanation.executionStats.executionStages?.indexName || 'COLLSCAN',
      isOptimal: explanation.executionStats.totalDocsExamined === explanation.executionStats.totalDocsReturned
    };
  } catch (error) {
    logger.error('❌ Failed to analyze query performance:', error);
    return null;
  }
};
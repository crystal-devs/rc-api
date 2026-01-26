# Redis Media Caching - Integration Guide

## 📋 What Was Implemented

### ✅ Core Services Created

1. **`signed-url-cache.service.ts`** - Redis-backed signed URL caching
   - Replaces in-memory Map with Redis
   - Shared across all server instances
   - Batch URL generation support
   - 50-minute TTL (for 1-hour S3 URLs)

2. **`response-cache.service.ts`** - API response caching
   - Caches complete API responses
   - Smart cache key generation
   - Pattern-based invalidation
   - 10-minute TTL

3. **`photo-cache.service.ts`** - Enhanced photo metadata caching
   - Already existed, now fully integrated
   - Stores photo metadata in Redis hashes
   - 15-30 minute TTL

4. **`cache-invalidation.service.ts`** - Centralized cache management
   - Single point for all cache invalidation
   - Batch invalidation support
   - Cache statistics

5. **`cloudfront-url.util.ts`** - CloudFront support (disabled by default)
   - Feature-flagged CloudFront URL generation
   - Automatic fallback to S3
   - Ready for future CDN migration

6. **`media-query-enhanced.service.ts`** - Enhanced media query with caching
   - 3-tier caching: Response → Photo Metadata → Database
   - Batch URL generation
   - Automatic cache population

### ✅ Updated Files

1. **`signedUrl.ts`** - Now uses Redis instead of in-memory cache
2. **`file.util.ts`** - Batch URL generation for media transformation

## 🚀 How to Use

### Option 1: Use Enhanced Service (Recommended)

Replace your import in `media/index.ts`:

```typescript
// OLD
import { getMediaByEventService } from './media-query.service';

// NEW
import { getMediaByEventServiceCached as getMediaByEventService } from './media-query-enhanced.service';
```

### Option 2: Update Existing Service

Add these imports to your existing `media-query.service.ts`:

```typescript
import { responseCacheService } from '@services/cache/response-cache.service';
import { photoCacheService } from '@services/cache/photo-cache.service';
```

Then add caching logic (see `media-query-enhanced.service.ts` for reference).

### Add Cache Invalidation

In your media management service, add cache invalidation:

```typescript
import { cacheInvalidation } from '@services/cache';

// After updating media status
await cacheInvalidation.invalidateMedia(mediaId, eventId);

// After bulk operations
await cacheInvalidation.invalidateMediaBatch(mediaIds, eventId);

// After deleting media
await cacheInvalidation.invalidateMedia(mediaId, eventId, s3Key);
```

## 📊 Expected Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| DB Queries/Request | 1-3 | 0.1-0.3 | **80-90% reduction** |
| Response Time (cached) | 200-500ms | 20-50ms | **75-90% faster** |
| Response Time (uncached) | 200-500ms | 150-300ms | **25-40% faster** |
| Cache Hit Rate | 0% | 70-85% | **New capability** |

## 🔧 Configuration

### Environment Variables

Add to your `.env` file:

```bash
# CloudFront (Optional - disabled by default)
USE_CLOUDFRONT=false

# When ready to enable CloudFront:
# USE_CLOUDFRONT=true
# CLOUDFRONT_DOMAIN=your-distribution.cloudfront.net
# CLOUDFRONT_KEY_PAIR_ID=your-key-pair-id
# CLOUDFRONT_PRIVATE_KEY=your-base64-encoded-private-key
# CLOUDFRONT_URL_EXPIRATION=86400
```

### Redis Configuration

Ensure Redis is configured (should already exist):

```bash
REDIS_URL=redis://localhost:6379
```

## 🧪 Testing

### 1. Verify Redis Connection

```typescript
import { getRedisClient } from '@configs/redis.config';

const redis = getRedisClient();
if (redis && redis.isReady) {
    console.log('✅ Redis connected');
}
```

### 2. Test Cache Hit/Miss

```bash
# First request (cache miss)
curl http://localhost:3000/api/media/event/{eventId}
# Check logs for "Cache MISS"

# Second request (cache hit)
curl http://localhost:3000/api/media/event/{eventId}
# Check logs for "Cache HIT"
```

### 3. Monitor Cache Stats

Add an admin endpoint:

```typescript
import { cacheInvalidation } from '@services/cache';

router.get('/admin/cache/stats', async (req, res) => {
    const stats = await cacheInvalidation.getCacheStats();
    res.json(stats);
});
```

## 🔄 Cache Invalidation Triggers

Add these calls to your existing code:

### Media Status Update
```typescript
// In updateMediaStatusService
await cacheInvalidation.invalidateMedia(mediaId, eventId);
```

### Media Delete
```typescript
// In deleteMediaService
await cacheInvalidation.invalidateMedia(mediaId, eventId, s3Key);
```

### Bulk Operations
```typescript
// In bulkUpdateMediaStatusService
await cacheInvalidation.invalidateMediaBatch(mediaIds, eventId);
```

### New Upload
```typescript
// After successful upload
await cacheInvalidation.invalidateEvent(eventId);
```

## 🐛 Troubleshooting

### Cache Not Working?

1. **Check Redis Connection**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

2. **Check Logs**
   - Look for "Cache HIT" or "Cache MISS" messages
   - Check for Redis connection errors

3. **Clear Cache**
   ```typescript
   await cacheInvalidation.clearAllCaches();
   ```

### Performance Not Improved?

1. **Check Cache Hit Rate**
   - Should be 70-85% after warming up
   - Low hit rate indicates invalidation issues

2. **Monitor Redis Memory**
   ```bash
   redis-cli info memory
   ```

3. **Adjust TTLs**
   - Increase for more cache hits
   - Decrease for fresher data

## 🔮 Future: CloudFront Migration

When ready to use CloudFront:

1. **Create CloudFront Distribution**
   - Origin: Your S3 bucket
   - Enable signed URLs
   - Generate key pair

2. **Update Environment Variables**
   ```bash
   USE_CLOUDFRONT=true
   CLOUDFRONT_DOMAIN=xxx.cloudfront.net
   CLOUDFRONT_KEY_PAIR_ID=xxx
   CLOUDFRONT_PRIVATE_KEY=xxx
   ```

3. **Restart Server**
   - URLs will automatically use CloudFront
   - No code changes needed!

## 📈 Monitoring

### Key Metrics to Track

1. **Cache Hit Rate**: `(cache hits / total requests) * 100`
2. **Response Time**: Before vs after caching
3. **Database Query Count**: Should drop 80-90%
4. **Redis Memory Usage**: Monitor growth

### Recommended Tools

- Redis Commander (GUI for Redis)
- Redis Insight (Official Redis GUI)
- Application Performance Monitoring (APM) tools

## 🎯 Next Steps

1. ✅ Integrate enhanced service or update existing service
2. ✅ Add cache invalidation to media operations
3. ✅ Test cache hit/miss scenarios
4. ✅ Monitor performance improvements
5. ⏳ Plan CloudFront migration (when ready)

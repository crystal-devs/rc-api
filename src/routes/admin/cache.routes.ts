// routes/admin/cache.routes.ts
// Admin routes for cache management

import { Router } from 'express';
import {
    getCacheStatsController,
    flushCacheController,
    warmEventCacheController,
    getCacheHealthController,
    invalidateEventCacheController,
    getCacheConfigController,
    runCacheCleanupController,
    requireAdmin,
} from '@controllers/admin/cache.controller';

const router = Router();

// Apply admin middleware to all routes
router.use(requireAdmin as any);

/**
 * @route GET /admin/cache/stats
 * @desc Get comprehensive cache statistics
 * @access Admin
 */
router.get('/stats', getCacheStatsController as any);

/**
 * @route GET /admin/cache/health
 * @desc Get cache system health status
 * @access Admin
 */
router.get('/health', getCacheHealthController as any);

/**
 * @route GET /admin/cache/config
 * @desc Get cache configuration and settings
 * @access Admin
 */
router.get('/config', getCacheConfigController as any);

/**
 * @route POST /admin/cache/flush/:cacheType
 * @desc Flush specific cache type (events, photos, analytics, all)
 * @access Admin
 * @body { "confirm": true }
 */
router.post('/flush/:cacheType', flushCacheController as any);

/**
 * @route POST /admin/cache/warm/:eventId
 * @desc Warm cache for specific event
 * @access Admin
 * @body { "userIds": ["userId1", "userId2"] }
 */
router.post('/warm/:eventId', warmEventCacheController as any);

/**
 * @route DELETE /admin/cache/event/:eventId
 * @desc Invalidate all caches for specific event
 * @access Admin
 */
router.delete('/event/:eventId', invalidateEventCacheController as any);

/**
 * @route POST /admin/cache/cleanup
 * @desc Run comprehensive background cleanup for photo caches
 * @access Admin
 * @body { "validEventIds": ["event1", "event2"] } (optional)
 */
router.post('/cleanup', runCacheCleanupController as any);

export default router;

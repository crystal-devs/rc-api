// services/cache/cached-fetch.service.ts
// Stampede-protected cache-aside helper (single-flight + jittered TTL + stale-while-revalidate).
//
// Problem this solves:
//   The naive cache-aside pattern (`get` -> on miss, query DB -> `set`) lets a spike of
//   concurrent requests all miss at the same instant and hammer the database together
//   (the "cache stampede" / "thundering herd" / "dogpile" problem). Fixed TTLs make it worse
//   because every key for an entity expires on the same tick (synchronized expiry).
//
// How it is fixed here (all three are industry-standard, stacked):
//   1. Jittered TTL          - randomize each TTL by +/-JITTER so keys don't expire in lockstep.
//   2. Single-flight lock    - on a true miss, exactly ONE request acquires a Redis SET-NX lock,
//                              queries the DB and populates the cache. Everyone else short-polls
//                              for the freshly-set value instead of hitting the DB.
//   3. Stale-while-revalidate- values carry a logical `staleAt`; the physical Redis TTL is longer.
//                              A stale-but-present value is served instantly while ONE background
//                              worker (guarded by the same lock) refreshes it. Readers never block
//                              on a cold recompute.
//
// Topology note: we are on single-instance Redis (see redis.config.ts). A plain `SET NX PX`
// lock is a correct, atomic mutex there. Every operation below touches a single key (never a
// lock key and a data key in the same command), so nothing depends on lock and data sharing a
// hash slot -- this stays correct as-is if Redis is later sharded into a Cluster.

import { getRedisClient } from '@configs/redis.config';
import { logger } from '@utils/logger';
import { responseCacheService } from './response-cache.service';
import crypto from 'crypto';

const LOCK_PREFIX = 'response_lock:';

// Lua: release the lock only if we still own it (compare-and-delete). Prevents a slow worker
// from deleting a lock that has since expired and been re-acquired by someone else.
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface CachedFetchOptions<T> {
    /** Fresh lifetime in seconds. May be a function of the produced value (e.g. shorter TTL
     *  for empty/negative results). */
    ttl: number | ((data: T) => number);
    /** Extra seconds the value stays servable (stale) while a background refresh runs.
     *  Defaults to 50% of the resolved fresh TTL. */
    staleTtl?: number | ((data: T) => number);
    /** Max time one producer run may hold the lock before it self-expires. Default 10s. */
    lockTimeoutMs?: number;
    /** How many times a waiter polls for the winner's value before falling back. Default 40. */
    maxPollAttempts?: number;
    /** Delay between waiter polls, ms. Default 50 (=> up to ~2s total wait by default). */
    pollIntervalMs?: number;
}

interface CacheEnvelope<T> {
    data: T;
    staleAt: number; // epoch ms; value is "fresh" while Date.now() < staleAt
}

const TTL_JITTER = 0.1; // +/-10%

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Apply +/-TTL_JITTER randomization so a batch of keys written together don't all expire at once. */
const jitter = (seconds: number): number => {
    const delta = seconds * TTL_JITTER;
    return Math.max(1, Math.round(seconds + (Math.random() * 2 - 1) * delta));
};

const resolve = <T>(v: number | ((d: T) => number), data: T): number =>
    typeof v === 'function' ? (v as (d: T) => number)(data) : v;

/**
 * Parse a stored value ONLY if it is one of our envelopes. Returns null for anything else —
 * corrupt JSON, or a value written in the pre-cachedFetch format (a bare payload with no
 * `staleAt`). This is what keeps a deploy safe: old `responseCacheService.set` entries living
 * under the identical key are treated as a miss and recomputed, instead of being mistaken for
 * an envelope and having their inner shape returned.
 */
function parseEnvelope<T>(raw: string): CacheEnvelope<T> | null {
    try {
        const env = JSON.parse(raw);
        if (env && typeof env === 'object' && typeof env.staleAt === 'number' && 'data' in env) {
            return env as CacheEnvelope<T>;
        }
    } catch {
        // fall through
    }
    return null;
}

function getRedis() {
    const redis = getRedisClient();
    if (!redis || !redis.isReady) return null;
    return redis;
}

/**
 * Cache-aside read with stampede protection.
 *
 * @param endpoint  Same endpoint string used with responseCacheService (e.g. `media/event/<id>`).
 *                  The data key is built identically, so existing invalidateByPattern() still works.
 * @param params    Cache-key params (page, limit, filters, ...).
 * @param producer  The expensive source of truth (the DB query). Runs at most once per miss/refresh.
 * @param opts      TTL / stale / lock tuning.
 */
export async function cachedFetch<T>(
    endpoint: string,
    params: Record<string, any>,
    producer: () => Promise<T>,
    opts: CachedFetchOptions<T>
): Promise<T> {
    const redis = getRedis();

    // Cache unavailable -> degrade gracefully to a direct DB read (no stampede protection,
    // but availability wins over protecting a DB that has to serve the request anyway).
    if (!redis) {
        logger.warn(`[cachedFetch] Redis unavailable, serving ${endpoint} directly from producer`);
        return producer();
    }

    const dataKey = responseCacheService.buildKey(endpoint, params);
    const lockKey = LOCK_PREFIX + dataKey;

    // 1) Try the cache.
    try {
        const raw = await redis.get(dataKey);
        if (raw) {
            const env = parseEnvelope<T>(raw as string);
            if (env) {
                if (Date.now() < env.staleAt) {
                    logger.debug(`[cachedFetch] fresh HIT ${endpoint}`);
                    return env.data;
                }
                // Stale hit: serve immediately, refresh in the background (single-flight).
                logger.debug(`[cachedFetch] stale HIT ${endpoint} -> background refresh`);
                void backgroundRefresh(endpoint, params, producer, opts, dataKey, lockKey);
                return env.data;
            }
            // Not our envelope (old-format / corrupt) -> fall through and recompute, which
            // overwrites the key with a proper envelope.
        }
    } catch (err) {
        logger.error(`[cachedFetch] read error for ${endpoint}, falling through:`, err);
        // fall through to the blocking compute path
    }

    // 2) True miss -> single-flight blocking compute.
    return computeWithLock(endpoint, params, producer, opts, dataKey, lockKey);
}

/** Store the produced value wrapped with a logical staleAt and a jittered physical TTL. */
async function store<T>(
    redis: NonNullable<ReturnType<typeof getRedis>>,
    dataKey: string,
    data: T,
    opts: CachedFetchOptions<T>
): Promise<void> {
    const freshTtl = jitter(Math.max(1, resolve(opts.ttl, data)));
    const staleTtl =
        opts.staleTtl !== undefined
            ? Math.max(0, resolve(opts.staleTtl, data))
            : Math.round(freshTtl * 0.5);

    const envelope: CacheEnvelope<T> = {
        data,
        staleAt: Date.now() + freshTtl * 1000,
    };
    // Physical TTL outlives freshness so the value remains servable during revalidation.
    const physicalTtl = freshTtl + staleTtl;
    await redis.setEx(dataKey, physicalTtl, JSON.stringify(envelope));
}

async function acquireLock(
    redis: NonNullable<ReturnType<typeof getRedis>>,
    lockKey: string,
    lockTimeoutMs: number
): Promise<string | null> {
    const token = crypto.randomUUID();
    const ok = await redis.set(lockKey, token, { NX: true, PX: lockTimeoutMs });
    return ok === 'OK' ? token : null;
}

async function releaseLock(
    redis: NonNullable<ReturnType<typeof getRedis>>,
    lockKey: string,
    token: string
): Promise<void> {
    try {
        await redis.eval(RELEASE_LOCK_LUA, { keys: [lockKey], arguments: [token] });
    } catch (err) {
        logger.error('[cachedFetch] lock release error:', err);
    }
}

/**
 * Blocking single-flight: win the lock and compute, or wait for the winner's value.
 *
 * Each iteration reads the cache BEFORE trying the lock. That ordering matters:
 *  - a waiter returns the winner's value the instant it is stored (no redundant DB query), and
 *  - it only acquires the lock (and runs the producer) when the value is genuinely absent, i.e.
 *    the previous holder died before storing and its lock has since self-expired.
 * So the producer runs at most once per key at a time even across the wait path.
 */
async function computeWithLock<T>(
    endpoint: string,
    _params: Record<string, any>,
    producer: () => Promise<T>,
    opts: CachedFetchOptions<T>,
    dataKey: string,
    lockKey: string
): Promise<T> {
    const redis = getRedis();
    if (!redis) return producer();

    const lockTimeoutMs = opts.lockTimeoutMs ?? 10_000;
    // Poll window must comfortably exceed producer latency (counts + find + signed-URL batch),
    // otherwise waiters give up and stampede the DB. Default ~2s (40 x 50ms).
    const maxAttempts = opts.maxPollAttempts ?? 40;
    const interval = opts.pollIntervalMs ?? 50;

    for (let i = 0; i < maxAttempts; i++) {
        // Prefer a value someone else already stored.
        try {
            const raw = await redis.get(dataKey);
            if (raw) {
                const env = parseEnvelope<T>(raw as string);
                if (env) {
                    if (i > 0) logger.debug(`[cachedFetch] MISS ${endpoint} -> got winner's value after ${i} polls`);
                    return env.data;
                }
            }
        } catch {
            // ignore and try the lock / retry
        }

        // No value yet -> try to become the single flight.
        const token = await acquireLock(redis, lockKey, lockTimeoutMs);
        if (token) {
            logger.debug(`[cachedFetch] MISS ${endpoint} -> won lock, querying source`);
            try {
                const data = await producer();
                await store(redis, dataKey, data, opts).catch((err) =>
                    logger.error(`[cachedFetch] store error for ${endpoint}:`, err)
                );
                return data;
            } finally {
                await releaseLock(redis, lockKey, token);
            }
        }

        // Someone else holds the lock -> wait, then re-check the cache.
        await sleep(interval);
    }

    // Winner is slower than the whole poll window (or a persistent failure). Serve from the source
    // directly rather than stalling the request. The lock self-expires (PX), so the system recovers.
    logger.warn(`[cachedFetch] MISS ${endpoint} -> waiter timed out after ${maxAttempts} polls, falling back to producer`);
    return producer();
}

/** Fire-and-forget refresh of a stale value; only one worker actually runs it (lock-guarded). */
async function backgroundRefresh<T>(
    endpoint: string,
    _params: Record<string, any>,
    producer: () => Promise<T>,
    opts: CachedFetchOptions<T>,
    dataKey: string,
    lockKey: string
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const lockTimeoutMs = opts.lockTimeoutMs ?? 10_000;
    const token = await acquireLock(redis, lockKey, lockTimeoutMs);
    if (!token) return; // another worker is already refreshing

    try {
        const data = await producer();
        await store(redis, dataKey, data, opts);
        logger.debug(`[cachedFetch] background refresh done ${endpoint}`);
    } catch (err) {
        logger.error(`[cachedFetch] background refresh failed ${endpoint}:`, err);
    } finally {
        await releaseLock(redis, lockKey, token);
    }
}

# Cache Stampede Protection

How rc-api defends the database from traffic spikes that miss the cache, and what still
needs to be done at the CDN layer.

## The problem

The cache layer (Redis + CloudFront) uses a **cache-aside** pattern: read the cache, and on a
miss, query MongoDB and populate the cache. The naive version of this has a well-known failure
mode under load, known as **cache stampede** / **thundering herd** / **dogpile**:

- A popular key is cold or its TTL has just expired.
- A spike of concurrent requests all get a cache **MISS** at the same instant.
- Every one of them runs the same expensive MongoDB query **simultaneously**, and the DB — the
  thing the cache exists to protect — takes the full hit.

It was made worse here by **synchronized expiry**: when an event's data was first cached, the
response, photo-list and metadata keys were all written at the same moment with fixed TTLs, so
they also all **expired at the same moment** — turning every expiry into a coordinated stampede.

A live event with many guests refreshing the gallery/wall at once is exactly when this fires.

## The fix (application layer)

Implemented in [`src/services/cache/cached-fetch.service.ts`](../src/services/cache/cached-fetch.service.ts)
as a single reusable helper, `cachedFetch()`, which stacks the three industry-standard defenses:

| Technique | What it does | Solves |
|---|---|---|
| **Jittered TTL** | Each TTL is randomized ±10% | Synchronized expiry — keys no longer expire in lockstep |
| **Single-flight lock** | On a true miss, one request wins a Redis `SET NX PX` lock and queries the DB; concurrent callers read-before-acquire and return the winner's value the instant it lands instead of hitting the DB | N concurrent DB hits → **1** |
| **Lock heartbeat + short TTL** | The lock has a short TTL (4s) but the holder renews it while producing. A live-but-slow query keeps the lock (no duplicate fetch); a **crashed** holder's lock frees within the TTL, and exactly one waiter (its poll window outlasts TTL + one produce) takes over and refills the cache | A crashed leader costs **1** extra DB query, not a herd |
| **Stale-while-revalidate** | Values carry a logical `staleAt` shorter than the physical Redis TTL; a stale-but-present value is served instantly while **one** background worker (lock-guarded) refreshes it | Readers never block on a cold recompute; the DB sees a trickle of single refreshes, not a wall |

Plus two properties that were already correct and are preserved:

- **Negative caching** — empty/"no media" results are cached (with a shorter TTL) so a spike for a
  quiet event can't repeatedly hit the DB (guards against *cache penetration*).
- **Graceful degradation** — if Redis is down, `cachedFetch` bypasses all locking and serves
  directly from the producer. Availability wins; the DB has to serve the request regardless.

### Usage

```ts
import { cachedFetch } from '@services/cache/cached-fetch.service';

return await cachedFetch<ServiceResponse<T>>(
  endpoint,        // e.g. `media/event/<id>` — SAME string used with responseCacheService
  cacheParams,     // { page, limit, status, ... } — the cache-key params
  () => fetchFromDb(...),   // the expensive producer; runs at most once per miss/refresh
  {
    // number, or a function of the produced value (used here for shorter negative-result TTL)
    ttl: (resp) => (resp.data?.length ? 600 : 300),
    // optional: extra seconds served while revalidating (default = 50% of fresh TTL)
    // staleTtl: 300,
    // optional: lockTimeoutMs (default 4_000, auto-renewed while producing),
    //           maxPollAttempts (default 80), pollIntervalMs (default 100) => ~8s wait window
  }
);
```

The data key is built with `responseCacheService.buildKey()` — the **same** scheme as before — so
existing pattern-based invalidation (`responseCacheService.invalidateEvent`) keeps working
untouched. Lock keys use a separate `response_lock:` prefix so they are never caught by data
invalidation.

### Wired so far

- `getMediaByEventServiceCached` in
  [`media-query-enhanced.service.ts`](../src/services/media/media-query-enhanced.service.ts) — the
  hottest guest/host read path. The DB query was extracted into `fetchMediaByEventFromDb()` (the
  producer); behavior on a cache hit is unchanged.

### Still to wire (same helper, follow-up)

- Event detail reads (`event-cache.service`)
- Analytics reads (`analytics-cache.service`)
- Guest media list endpoints

`signedUrlCache` is intentionally left as-is (batched pipeline reads, low stampede risk).

## Topology note (single instance vs Redis Cluster)

We run **single-instance Redis** (`createClient({ url })` in
[`redis.config.ts`](../src/configs/redis.config.ts)), where a plain `SET NX PX` lock is a correct,
atomic mutex. The helper is written to stay correct if Redis is later sharded into a **Cluster**:
every Redis operation touches a **single key** (it never touches a lock key and a data key in the
same command), so nothing depends on lock and data sharing a hash slot. No Redlock is needed at
current scale.

## Known related issue (separate fix)

Invalidation across the cache services uses `redis.keys(...)`, which is an **O(N) blocking
command** that scans the entire keyspace — it degrades exactly under the load this change hardens
against. It should be migrated to `SCAN` (or index sets) in a follow-up. Not bundled here.

---

## CDN layer — CloudFront (for whoever owns the AWS infra)

### Current status (verified 2026-07-11)

CloudFront **is enabled and live** — `USE_CLOUDFRONT=true`, domain `d3t4yv5dvx0a0c.cloudfront.net`,
serving from the Mumbai (MAA51) edge with a valid trusted key group. `isCloudFrontEnabled()` returns
true, so `file.util.ts` hands out **CloudFront signed URLs** for media.

**Scope:** CloudFront fronts the media **files** (image/video bytes from the private S3 bucket
`rc-media-bucket`, accessed via an Origin Access Control). It does **not** front the media-list API
JSON — that is served directly by the API and is protected by the Redis stampede layer above.

Origin config confirmed correct: single S3 origin in `ap-south-1`, OAC-secured (bucket is private,
only CloudFront can read it).

### DEFERRED decision — Origin Shield (not enabled)

**Origin Shield is currently OFF** ("Origin Shield region: -" on the origin). It is a **paid** AWS
feature and has been intentionally deferred for now.

What it would do: add a **regional caching tier** in front of S3 that **collapses concurrent edge
misses into a single origin request** — e.g. when many guests open the same gallery / the live wall
at once and hit different edge locations, S3 sees one fetch instead of many. It's the CDN-layer
equivalent of the Redis single-flight lock, one layer further out, and it's a good fit for this app's
spiky "everyone views the same photos at once" pattern.

**When ready to enable:** Origins → select the origin → Edit → Origin Shield: **Yes**, region **Asia
Pacific (Mumbai) `ap-south-1`** (best practice = same region as the origin bucket) → Save.

**Precondition — confirm images actually cache first.** Origin Shield only helps if the media files
are cacheable at the edge. The app currently signs S3 GETs with `Cache-Control: private, max-age=...`
([cloudfront-url.util.ts](../src/utils/cloudfront-url.util.ts)); the `private` directive can prevent
edge caching. Before (or alongside) enabling Origin Shield, verify the edge cache-hit ratio in the
distribution's Monitoring tab and check that header — a CDN that never caches gains nothing from
Origin Shield.

### If the media-list API JSON is ever put behind CloudFront (separate, larger task)

Not the case today (only media files are on the CDN). If it were ever done:

- **Cache on meaningful keys only** (`page`, `limit`, `status`, `quality`), not all query params.
- **Make the responses cacheable** with an explicit short `Cache-Control: max-age` (30–60s).
- **Caveat — per-user signed URLs:** the list responses embed per-request S3/CloudFront signed URLs
  that differ every time, making the JSON body effectively uncacheable at the CDN. This would need
  resolving first (e.g. stable CloudFront URLs via signed cookies) before CDN caching of the API
  JSON is worthwhile.

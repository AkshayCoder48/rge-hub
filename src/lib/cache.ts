/**
 * Server-side in-memory cache for OnyxBase responses.
 *
 * OnyxBase has high latency (2-8s per call) and eventual consistency issues.
 * This cache provides near-instant reads by caching collection exports
 * with a short TTL (15 seconds). Writes invalidate the relevant cache entries.
 *
 * Cache shape: Map<collection, { data, expiresAt }>
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds

/**
 * Get a cached value if it exists and hasn't expired.
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Set a value in the cache with the standard TTL.
 */
export function setCached<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate a specific cache key.
 */
export function invalidate(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all cache keys matching a prefix.
 */
export function invalidatePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate all resource-related caches.
 * Call this after any resource create/update/delete.
 */
export function invalidateResources(): void {
  invalidatePrefix('resources:');
  invalidatePrefix('community:');
  invalidate('all_public');
}

/**
 * Invalidate profile-related caches.
 * Call this after any profile update.
 */
export function invalidateProfiles(): void {
  invalidatePrefix('profile:');
}

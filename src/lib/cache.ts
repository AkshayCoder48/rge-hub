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
 * Cache a resource-list payload ONLY when it is non-empty (PRD §46).
 *
 * OnyxBase is eventually consistent and can briefly return empty lists
 * right after a write. Caching that empty result is what made uploads
 * "disappear" (and "Recently added" render empty) after a refresh.
 * Empty responses are therefore never cached — the next request retries
 * the backing store instead of serving a stale empty page.
 */
export function setCachedNonEmpty<T>(key: string, data: T, isEmpty: boolean): boolean {
  if (isEmpty) return false;
  setCached(key, data);
  return true;
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

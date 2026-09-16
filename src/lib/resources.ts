/**
 * Data layer for profiles and resources.
 * All operations go through OnyxBase KV storage.
 *
 * Collections:
 * - profiles:        user profile records keyed by userId
 * - editing_images:  image resource records keyed by resource ID
 * - editing_clips:   clip resource records keyed by resource ID
 * - community_xmls:  public XML resource records keyed by resource ID
 * - admin_xmls:      admin XML resource records keyed by resource ID (privileged)
 */

import { kvSet, kvSetMulti, kvGet, kvDelete, kvExport, kvList, kvDeleteIdempotent, kvDeleteDeterministic, stripExportPrefix } from './onyxbase';
import { ONYXBASE_COLLECTIONS, ONYXBASE_V5_ENABLED } from './onyxbase';
import { getCached, setCached, setCachedNonEmpty, invalidate } from './cache';

// ============ Types ============

export interface Profile {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio: string;
  email?: string;
  apiKey: string; // user's OnyxBase key
  createdAt: string;
  updatedAt: string;
}

export type ResourceType = 'image' | 'clip' | 'xml';

/** User-facing singular labels. Internal type ids (incl. 'xml') never change. */
export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  image: 'Image',
  clip: 'Clip',
  xml: 'File',
};

/**
 * Real file extension for display + preview routing (PRD §14–16):
 *   1. explicit fileName extension (authoritative — the user's real file)
 *   2. mimeType subtype (image/png → png, video/mp4 → mp4, text/xml → xml)
 *   3. downloadUrl extension
 *   4. type fallback (image/clip/file)
 * Lower-cased, no dot. NEVER the internal type id — that was the "every
 * file says XML" bug (type 'xml' is the generic-file bucket id).
 */
export function resourceExtension(r: Pick<Resource, 'type' | 'fileName' | 'mimeType' | 'downloadUrl'>): string {
  const fromName = r.fileName?.includes('.') ? r.fileName.split('.').pop()!.trim() : '';
  if (fromName && /^[A-Za-z0-9]{1,8}$/.test(fromName)) return fromName.toLowerCase();
  const mime = (r.mimeType || '').toLowerCase();
  if (mime.includes('/')) {
    const sub = mime.split('/').pop()!.split('+')[0].trim();
    if (sub && /^[a-z0-9]{1,8}$/.test(sub)) {
      if (sub === 'jpeg') return 'jpg';
      if (sub === 'mpeg' && mime.startsWith('video/')) return 'mpg';
      if (sub === 'quicktime') return 'mov';
      if (sub === 'plain' && mime.startsWith('text/')) return 'txt';
      if (/^(png|gif|webp|avif|bmp|svg|jpg|mp4|webm|mkv|mov|avi|mp3|wav|ogg|pdf|zip|rar|7z|tar|gz|xml|json|csv|txt|apk|iso)$/.test(sub)) return sub;
    }
  }
  const fromUrl = /\.([A-Za-z0-9]{1,8})(?:$|[?#])/.exec(r.downloadUrl || '')?.[1] ?? '';
  if (fromUrl) return fromUrl.toLowerCase();
  return r.type === 'image' ? 'image' : r.type === 'clip' ? 'clip' : 'file';
}
export type XmlSource = 'community' | 'admin';

export type ResourceStatus = 'ready' | 'processing' | 'pending';

export interface Resource {
  id: string;
  type: ResourceType;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string;
  fileId: string;          // OnyxBase file ID
  thumbnailFileId?: string; // optional thumbnail
  downloadUrl?: string;     // public download URL
  thumbnailUrl?: string;
  // Upload metadata (PRD §17) — captured at upload time, optional for legacy records
  fileName?: string;
  mimeType?: string;
  size?: number;
  status?: ResourceStatus;
  clientId?: string; // idempotency key supplied by the uploader (PRD §25)
  // Permanence (byte store + mirrors)
  bytesStored?: boolean; // original bytes durably stored → served via /api/img/[id]
  bytesShards?: number;
  storageUrl?: string; // OnyxBase direct URL (fallback)
  mirrorUrl?: string; // best-effort external mirror (fallback)
  mirrorHost?: string;
  // Server-stamped ownership flag — the ONLY source for "Admin" badges.
  // Never derive admin display from ownerName (user-controlled).
  isOwnerAdmin?: boolean;
  // Server-stamped author role at upload time ('root' | 'admin' |
  // 'moderator' | 'user'). Legacy records omit it — display falls back to
  // isOwnerAdmin (true renders the [Admin] badge).
  authorRole?: string;
  tags: string[];
  category?: string;
  duration?: number; // for clips (seconds)
  published: boolean;
  featured: boolean;
  xmlSource?: XmlSource; // for XMLs only
  createdAt: string;
  updatedAt: string;
}

// ============ Profiles ============

export async function getProfile(userId: string): Promise<Profile | null> {
  return kvGet<Profile>(`profile:${userId}`, ONYXBASE_COLLECTIONS.PROFILES);
}

/**
 * Cached profile fetch (30s TTL, in-memory) for list resolution
 * (followers/following rows, staff directories) — collapses N sequential
 * 10s point-reads into at most a handful (PRD §14).
 */
const PROFILE_CACHE_TTL_MS = 30_000;
const profileCache = new Map<string, { p: Profile | null; at: number }>();

export async function getProfileCached(userId: string): Promise<Profile | null> {
  const hit = profileCache.get(userId);
  if (hit && Date.now() - hit.at < PROFILE_CACHE_TTL_MS) return hit.p;
  const p = await getProfile(userId);
  if (profileCache.size > 400) profileCache.clear();
  profileCache.set(userId, { p, at: Date.now() });
  return p;
}

/**
 * Get a profile by username using a username index.
 * The index maps `username:{username}` → `userId` in the profiles collection.
 * Falls back to export-and-search if the index is missing (backward compat).
 */
export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const normalized = username.toLowerCase().trim();

  // Try the username index first (fast O(1) lookup)
  const userId = await kvGet<string>(`username:${normalized}`, ONYXBASE_COLLECTIONS.PROFILES);
  if (userId) {
    const profile = await getProfile(userId);
    if (profile) return profile;
  }

  // Fallback: export and search (for backward compat with old profiles)
  const all = await kvExport<Record<string, Profile>>(ONYXBASE_COLLECTIONS.PROFILES);
  for (const key of Object.keys(all)) {
    const p = all[key];
    if (p && p.username && p.username.toLowerCase() === normalized) {
      // Rebuild the index for this profile
      await kvSet(`username:${normalized}`, p.userId, ONYXBASE_COLLECTIONS.PROFILES);
      return p;
    }
  }
  return null;
}

/**
 * Check if a username is already taken.
 */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const existing = await getProfileByUsername(username);
  return existing !== null;
}

/**
 * Check if an email is already registered.
 */
export async function isEmailRegistered(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  // Fast path: email index (O(1)). Falls back to full export for profiles
  // written before the index existed.
  try {
    const hit = await kvGet<string>(`email:${normalized}`, ONYXBASE_COLLECTIONS.PROFILES);
    if (hit) return true;
  } catch {}
  const all = await kvExport<Record<string, Profile>>(ONYXBASE_COLLECTIONS.PROFILES);
  for (const key of Object.keys(all)) {
    const p = all[key];
    if (p && p.email && p.email.toLowerCase() === normalized) {
      return true;
    }
  }
  return false;
}

/**
 * Get a profile by email.
 */
export async function getProfileByEmail(email: string): Promise<Profile | null> {
  const normalized = email.toLowerCase().trim();
  // FAST PATH: the `email:` index maintained by upsertProfile — a POINT-READ,
  // which converges cross-instance via the engine's miss-probe (a LIST scan
  // can be served by a stale instance and miss a just-written profile — the
  // password-reset "No account found" flake).
  try {
    const userId = await kvGet<string>(`email:${normalized}`, ONYXBASE_COLLECTIONS.PROFILES);
    if (userId && typeof userId === 'string') {
      const p = await getProfile(userId);
      if (p && p.email && p.email.toLowerCase() === normalized) return p;
    }
  } catch {}
  // Fallback: full collection scan (legacy records without an index entry).
  const all = await kvExport<Record<string, Profile>>(ONYXBASE_COLLECTIONS.PROFILES);
  for (const key of Object.keys(all)) {
    const p = all[key];
    if (p && p.email && p.email.toLowerCase() === normalized) {
      return p;
    }
  }
  return null;
}

/**
 * Upsert a profile and maintain the username index.
 * If the username changed, removes the old index entry.
 */
export async function upsertProfile(profile: Profile): Promise<boolean> {
  const normalized = profile.username.toLowerCase().trim();

  // Check if there's an existing profile (for username/email change detection)
  const existing = await getProfile(profile.userId);
  if (existing && existing.username.toLowerCase() !== normalized) {
    // Username changed — remove old index
    try {
      await kvDelete(`username:${existing.username.toLowerCase()}`, ONYXBASE_COLLECTIONS.PROFILES);
    } catch {}
  }
  const normalizedEmail = profile.email ? profile.email.toLowerCase().trim() : '';
  if (existing && existing.email && existing.email.toLowerCase().trim() !== normalizedEmail) {
    // Email changed — remove old index
    try {
      await kvDelete(`email:${existing.email.toLowerCase().trim()}`, ONYXBASE_COLLECTIONS.PROFILES);
    } catch {}
  }

  // Set the main profile record + username/email indexes in ONE backend pin
  // (two kvSets would serialize on the 35s global pin pacing + double the
  // full-manifest uploads — the 110s-login self-flood).
  const entries: Array<{ key: string; value: any; collection?: string }> = [
    { key: `profile:${profile.userId}`, value: profile, collection: ONYXBASE_COLLECTIONS.PROFILES },
    { key: `username:${normalized}`, value: profile.userId, collection: ONYXBASE_COLLECTIONS.PROFILES },
  ];
  if (normalizedEmail.includes('@')) {
    entries.push({ key: `email:${normalizedEmail}`, value: profile.userId, collection: ONYXBASE_COLLECTIONS.PROFILES });
  }
  const ok = await kvSetMulti(entries);
  // Invalidate caches touched by this profile write (PRD §12 — only the
  // affected entries, never a full reload).
  invalidate('profiles:all');
  profileCache.delete(profile.userId);
  return ok;
}

export async function getAllProfiles(): Promise<Profile[]> {
  const cached = getCached<Profile[]>('profiles:all');
  if (cached) return cached;
  const all = await kvExport<Record<string, Profile>>(ONYXBASE_COLLECTIONS.PROFILES);
  const profiles = Object.values(all).filter(p => p && p.userId) as Profile[];
  setCached('profiles:all', profiles);
  return profiles;
}

// ============ Resources ============

function collectionForType(type: ResourceType, xmlSource?: XmlSource) {
  if (type === 'image') return ONYXBASE_COLLECTIONS.IMAGES;
  if (type === 'clip') return ONYXBASE_COLLECTIONS.CLIPS;
  if (type === 'xml') {
    return xmlSource === 'admin' ? ONYXBASE_COLLECTIONS.ADMIN_XMLS : ONYXBASE_COLLECTIONS.COMMUNITY_XMLS;
  }
  return 'default';
}

// ============ Deletes (V5-native) ============
//
// V5 is AUTHORITATIVE SQLite: a kvDelete is a durable row soft-delete that
// (a) commits transactionally, (b) mirrors a DELETE op to the Telegram
// snapshot, and (c) ships on the ~1-2s kv-delta channel so every engine
// instance converges on the same `deleted_at` row state. The V4 machinery —
// tombstone keys (`tomb:{id}` written into the hijacked `categories`
// collection), 3-5x spread copies, quorum read-backs, blind deletes across
// every collection — existed only to fight V4 replica divergence and is
// gone. A deleted id cannot resurrect, so listings no longer tomb-check.

/**
 * Legacy V4 debris cleanup: `tomb:*` keys in the old hijacked `categories`
 * collection are pure garbage now that nothing reads them. Bounded sweep
 * (≤100 keys/run), rate-limited to once per process per 10 min. Never
 * throws — fire-and-forget from the delete route.
 */
const TOMB_PURGE_MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastTombPurgeAt = 0;
export async function purgeLegacyTombstones(): Promise<number> {
  const now = Date.now();
  if (now - lastTombPurgeAt < TOMB_PURGE_MIN_INTERVAL_MS) return 0;
  lastTombPurgeAt = now;
  try {
    const keys = (await kvList(ONYXBASE_COLLECTIONS.CATEGORIES)).filter((k) => k.startsWith('tomb:'));
    if (keys.length === 0) return 0;
    let purged = 0;
    for (const k of keys.slice(0, 100)) {
      if (await kvDeleteIdempotent(k, ONYXBASE_COLLECTIONS.CATEGORIES)) purged++;
    }
    if (keys.length > 100) lastTombPurgeAt = 0; // debris remains — allow the next delete to resume the sweep
    return purged;
  } catch {
    return 0;
  }
}

export async function createResource(resource: Resource): Promise<boolean> {
  const collection = collectionForType(resource.type, resource.xmlSource);
  return kvSet(resource.id, resource, collection);
}

/**
 * Two-phase persistent create (PRD §9, §14, §49):
 * write the record, then verify it is readable before reporting success.
 * Only { ok: true, verified: true } may be surfaced as "Upload complete".
 *
 * V5 FAST PATH: the V5 data layer is AUTHORITATIVE SQLite — a committed kvSet
 * (HTTP 200) IS the durable write. The old read-back was a V4-era replica
 * check; against V5 it routed to a DIFFERENT serverless engine instance that
 * had not yet converged (full snapshots ride a 15-30s cadence), so a freshly
 * written record 404'd on read-back → verified:false → HTTP 202 → the client
 * polled an operation for 20-40s → "Processing" after 100% and "0 uploaded".
 * With V5: 200 = verified. The read-back only runs in V4 mode.
 * (Cross-instance listing convergence is now handled by the engine's KV
 * delta channel, which lands within ~1-2s of the write.)
 */
export async function createResourceVerified(
  resource: Resource,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ ok: boolean; verified: boolean; attempts: number; ms: number }> {
  const collection = collectionForType(resource.type, resource.xmlSource);
  const t0 = Date.now();
  const maxAttempts = opts.retries ?? 3;
  // PACING MODEL: the V4 backend pins every write to Telegram and paces
  // pins (~12-15s window), so retries must sleep PAST the window (13s). The
  // V5 data layer is authoritative SQLite — writes land in ~10ms and a
  // failed write is a transient blip, so a short backoff is correct there.
  const retryDelayMs = opts.baseDelayMs ?? (ONYXBASE_V5_ENABLED ? 1500 : 13000);
  // DEADLINE GATE: the route dies at 60s (Vercel). Never START a retry
  // past 20s elapsed — worst case stays ~45s + route overhead, and the
  // client's registration retry (fresh 60s budget, same clientId) owns
  // anything slower.
  const RETRY_DEADLINE_MS = 20000;
  let attempts = 0;
  let wrote = false;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0 && Date.now() - t0 > RETRY_DEADLINE_MS) break;
    attempts += 1;
    // One authoritative write (V5 SQLite commit; V4 single durable SET).
    wrote = await kvSet(resource.id, resource, collection);
    if (wrote) {
      if (ONYXBASE_V5_ENABLED) {
        // V5: the commit response IS the proof — an authoritative SQLite
        // batch committed on the engine. No read-back (it would hit an
        // unconverged instance and wrongly downgrade to the 202 path).
        return { ok: true, verified: true, attempts, ms: Date.now() - t0 };
      }
      // V4-only read-back: single point read.
      const back = await kvGet<Resource>(resource.id, collection);
      if (back && back.id === resource.id) {
        return { ok: true, verified: true, attempts, ms: Date.now() - t0 };
      }
      // Written durably but not yet readable (replica lag) — do NOT
      // rewrite (waste + re-arms pacing). The client's verify poll
      // confirms it via the 202 path.
      return { ok: true, verified: false, attempts, ms: Date.now() - t0 };
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  return { ok: wrote, verified: false, attempts, ms: Date.now() - t0 };
}

/**
 * V5-native delete: ONE authoritative row delete on the exact collection.
 * The engine soft-deletes the row (deleted_at), mirrors a DELETE op to the
 * Telegram snapshot, and ships the kv-delta so every instance hides the id
 * within ~1-2s. Idempotent: deleting an already-deleted id is a no-op that
 * still reports success — ghosts can never error. No tombstone keys, no
 * spread copies, no quorum read-back; those were V4-era workarounds.
 */
export async function deleteResourceVerified(
  id: string,
  type: ResourceType,
  xmlSource?: XmlSource
): Promise<{ deleted: boolean; confirmed: boolean }> {
  const collection = collectionForType(type, xmlSource);
  // Deterministic delete: the engine tombstones the row (resurrection-proof
  // upsert) and ships its kv-delta in-request; if the delta cannot ship
  // (Telegram flood) the hub retries once — possibly on a healthier engine
  // instance — so a deleted id cannot ghost.
  const deleted = await kvDeleteDeterministic(id, collection);
  return { deleted, confirmed: deleted };
}

/**
 * Idempotent deletes across every resource collection — used when
 * locate-by-type misses (stale/wrong/absent type param; V5 reads are
 * authoritative, so a genuine miss means the row is already gone). One
 * delete per collection; each is a no-op when absent. Never throws.
 */
export async function blindDeleteResource(id: string): Promise<void> {
  try {
    await Promise.all([
      kvDeleteIdempotent(id, ONYXBASE_COLLECTIONS.IMAGES),
      kvDeleteIdempotent(id, ONYXBASE_COLLECTIONS.CLIPS),
      kvDeleteIdempotent(id, ONYXBASE_COLLECTIONS.COMMUNITY_XMLS),
      kvDeleteIdempotent(id, ONYXBASE_COLLECTIONS.ADMIN_XMLS),
    ]);
  } catch {
    // best-effort
  }
}

/**
 * Lightweight read-back verification for a single record (PRD §49).
 * Used by the verify endpoint and by registration retries.
 * Single quorum wave — no sleep-cascade (replicas diverge; retries must
 * be parallel, not sequential).
 */
export async function verifyResource(
  id: string,
  type: ResourceType,
  xmlSource?: XmlSource
): Promise<{ verified: boolean; resource: Resource | null; attempts: number }> {
  const collection = collectionForType(type, xmlSource);
  const value = await kvGet<Resource>(id, collection);
  return { verified: value !== null && !!value.id, resource: value, attempts: 1 };
}

/**
 * Locate a resource by id across all public collections (no type needed).
 * Used by public resource pages (/r/[id]) and the sitemap.
 * NEVER includes admin XMLs unless includeAdmin is true (server-side only).
 * Parallel quorum reads — one wave, not sequential.
 */
export async function getResourceAny(
  id: string,
  opts: { includeAdmin?: boolean } = {}
): Promise<Resource | null> {
  const jobs: Promise<Resource | null>[] = [
    getResource(id, 'image'),
    getResource(id, 'clip'),
    getResource(id, 'xml', 'community'),
  ];
  if (opts.includeAdmin) {
    jobs.push(getResource(id, 'xml', 'admin'));
  }
  const results = await Promise.all(jobs.map((j) => j.catch(() => null)));
  return results.find((r) => r && r.id) || null;
}

export async function getResource(id: string, type: ResourceType, xmlSource?: XmlSource): Promise<Resource | null> {
  const collection = collectionForType(type, xmlSource);
  return kvGet<Resource>(id, collection);
}

export async function updateResource(resource: Resource): Promise<boolean> {
  resource.updatedAt = new Date().toISOString();
  const collection = collectionForType(resource.type, resource.xmlSource);
  return kvSet(resource.id, resource, collection);
}

export async function deleteResource(id: string, type: ResourceType, xmlSource?: XmlSource): Promise<boolean> {
  const collection = collectionForType(type, xmlSource);
  return kvDelete(id, collection);
}

export async function listResources(type: ResourceType, xmlSource?: XmlSource): Promise<Resource[]> {
  const collection = collectionForType(type, xmlSource);

  // V5-native membership: ONE authoritative LIST (SQLite scan; deleted rows
  // are already excluded engine-side via deleted_at — no tombstone checks,
  // no LIST unions, no quorum fan-out).
  const ids = await kvList(collection);
  if (ids.length === 0) return [];

  // Records: one point-read per id, in parallel chunks (kvGet never throws).
  const CHUNK = 40;
  const found: Resource[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await Promise.all(
      chunk.map(async (id) => {
        const rec = await kvGet<Resource>(id, collection);
        return rec && rec.id ? rec : null;
      })
    );
    rows.forEach((r) => {
      if (r) found.push(r);
    });
  }
  return found;
}

/**
 * FAST listing (PRD §14, §20–24 of the perf spec): ONE collection export,
 * filtered locally. V5 makes this a live-rows-only SQLite scan (deleted
 * rows are excluded engine-side via deleted_at) — no tombstone export, no
 * per-id tomb checks.
 *
 * Server-cached for 20s (non-empty results only, same policy as /all).
 * Writes invalidate via invalidateResources(). Falls back to the point-read
 * path when the export call fails.
 */
export async function listResourcesFast(type: ResourceType, xmlSource?: XmlSource): Promise<Resource[]> {
  const collection = collectionForType(type, xmlSource);
  const cacheKey = `resources:listfast:${collection}`;
  const cached = getCached<Resource[]>(cacheKey);
  if (cached) return cached;

  const exported = await kvExport(collection).catch(() => null);
  if (!exported) {
    // Export failed — the point-read path still works.
    return listResources(type, xmlSource);
  }

  const out: Resource[] = [];
  for (const rawKey of Object.keys(exported)) {
    const key = stripExportPrefix(rawKey, collection);
    const rec = exported[rawKey] as Resource | null;
    if (rec && rec.id && rec.id === key) out.push(rec);
  }
  // Sort newest-first once here so every consumer gets a stable order.
  out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  setCachedNonEmpty(cacheKey, out, out.length === 0);
  return out;
}

/** Invalidate fast-listing caches (call after any create/update/delete). */
export function invalidateListings(): void {
  invalidate('resources:listfast:' + ONYXBASE_COLLECTIONS.IMAGES);
  invalidate('resources:listfast:' + ONYXBASE_COLLECTIONS.CLIPS);
  invalidate('resources:listfast:' + ONYXBASE_COLLECTIONS.COMMUNITY_XMLS);
  invalidate('resources:listfast:' + ONYXBASE_COLLECTIONS.ADMIN_XMLS);
  invalidate('profiles:all');
}

/**
 * List all public resources across all types.
 * Optionally filter by published status.
 */
export async function listAllPublicResources(): Promise<Resource[]> {
  const [images, clips, communityXmls] = await Promise.all([
    listResourcesFast('image'),
    listResourcesFast('clip'),
    listResourcesFast('xml', 'community'),
  ]);

  return [
    ...images.filter(r => r.published),
    ...clips.filter(r => r.published),
    ...communityXmls.filter(r => r.published),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * List resources by owner.
 */
export async function listResourcesByOwner(ownerId: string): Promise<Resource[]> {
  const [images, clips, communityXmls] = await Promise.all([
    listResourcesFast('image'),
    listResourcesFast('clip'),
    listResourcesFast('xml', 'community'),
  ]);

  return [
    ...images.filter(r => r.ownerId === ownerId),
    ...clips.filter(r => r.ownerId === ownerId),
    ...communityXmls.filter(r => r.ownerId === ownerId),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Search resources by title, tags, or creator.
 */
export async function searchResources(query: string): Promise<Resource[]> {
  const q = query.toLowerCase();
  const all = await listAllPublicResources();
  return all.filter(r => {
    return (
      r.title?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      r.ownerName?.toLowerCase().includes(q) ||
      r.tags?.some(t => t.toLowerCase().includes(q))
    );
  });
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Generate a resource ID.
 *
 * When the client supplies a stable `clientId` (idempotency key, PRD §25),
 * the resource id is derived from it so that registration retries return
 * the SAME record instead of creating duplicates (PRD §26).
 */
export function generateResourceId(type: ResourceType, clientId?: string): string {
  const prefix = type === 'image' ? 'img' : type === 'clip' ? 'clip' : 'xml';
  if (clientId && CLIENT_ID_RE.test(clientId)) {
    const clean = clientId.replace(/[^A-Za-z0-9_-]/g, '').substring(0, 48);
    if (clean.startsWith(`${prefix}_`)) return clean;
    return `${prefix}_${clean}`;
  }
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
}

// ============ Follows (social graph — canonical relationship records) ============
//
// SINGLE SOURCE OF TRUTH: one record per relationship,
//   rel:{followerId}:{targetId} -> { t: <followed-at ms> }
// Following lists, follower lists, counts, and button state ALL derive from
// these records — there are no separate counters to drift. (The old dual
// `following:`/`followers:` lists desynced because the reverse write ran
// post-response and could die there — the "followers stuck at 0" bug.)
// Legacy `following:{uid}` lists (pre-rel era) are unioned on READ so old
// follows survive; unfollow scrubs them. Legacy `followers:*` keys are
// ignored (unreliable display data from the buggy era).

const followsCollection = () => ONYXBASE_COLLECTIONS.FOLLOWS;
const relKey = (followerId: string, targetId: string) => `rel:${followerId}:${targetId}`;
const legacyFollowingKey = (userId: string) => `following:${userId}`;

function cleanIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

// follower -> set of targets (canonical rels + legacy lists unioned, deduped)
async function loadFollowGraphRaw(): Promise<Map<string, Set<string>>> {
  const graph = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    let set = graph.get(a);
    if (!set) {
      set = new Set();
      graph.set(a, set);
    }
    set.add(b);
  };
  const all = await kvExport(followsCollection()).catch(() => ({}) as Record<string, unknown>);
  for (const rawKey of Object.keys(all)) {
    const key = stripExportPrefix(rawKey, followsCollection());
    if (key.startsWith('rel:')) {
      const parts = key.split(':');
      if (parts.length === 3) add(parts[1], parts[2]);
    } else if (key.startsWith('following:')) {
      const a = key.slice('following:'.length);
      for (const b of cleanIds(all[rawKey])) add(a, b);
    }
  }
  return graph;
}

// ── Follow-graph cache (PRD §13) ─────────────────────────────────────────
// The graph is derived from ONE export — previously re-exported on EVERY
// counts/list/isFollowing call (12s+ each). Cached for 30s; mutations
// apply their confirmed edge IN PLACE so responses stay truthful the
// moment a write lands (read-your-write) without re-exporting.
const FOLLOW_GRAPH_TTL_MS = 30_000;
let followGraphCache: { graph: Map<string, Set<string>>; at: number } | null = null;

async function loadFollowGraph(): Promise<Map<string, Set<string>>> {
  if (followGraphCache && Date.now() - followGraphCache.at < FOLLOW_GRAPH_TTL_MS) {
    return followGraphCache.graph;
  }
  const graph = await loadFollowGraphRaw();
  followGraphCache = { graph, at: Date.now() };
  return graph;
}

/** Apply a confirmed follow edge to the cached graph (idempotent). */
function graphApplyFollow(graph: Map<string, Set<string>>, followerId: string, targetId: string) {
  let set = graph.get(followerId);
  if (!set) {
    set = new Set();
    graph.set(followerId, set);
  }
  set.add(targetId);
}

/** Apply a confirmed unfollow to the cached graph (idempotent). */
function graphApplyUnfollow(graph: Map<string, Set<string>>, followerId: string, targetId: string) {
  graph.get(followerId)?.delete(targetId);
}

async function getLegacyFollowingIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  const v = await kvGet(legacyFollowingKey(userId), followsCollection()).catch(() => null);
  return cleanIds(v);
}

export async function getFollowingIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  return [...((await loadFollowGraph()).get(userId) ?? [])];
}

export async function getFollowerIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  const graph = await loadFollowGraph();
  const out: string[] = [];
  for (const [follower, targets] of graph) {
    if (targets.has(userId)) out.push(follower);
  }
  return out;
}

export async function getFollowCounts(userId: string): Promise<{ followingCount: number; followersCount: number }> {
  if (!userId) return { followingCount: 0, followersCount: 0 };
  const graph = await loadFollowGraph();
  const followingCount = graph.get(userId)?.size ?? 0;
  let followersCount = 0;
  for (const targets of graph.values()) {
    if (targets.has(userId)) followersCount += 1;
  }
  return { followingCount, followersCount };
}

export async function isFollowing(followerId: string, targetId: string): Promise<boolean> {
  if (!followerId || !targetId || followerId === targetId) return false;
  // Cached-graph fast path (no backend call): covers the common case and
  // the post-mutation read-your-write check.
  if (followGraphCache && Date.now() - followGraphCache.at < FOLLOW_GRAPH_TTL_MS) {
    if (followGraphCache.graph.get(followerId)?.has(targetId)) return true;
  }
  // O(1) fast path: canonical record.
  const rel = await kvGet(relKey(followerId, targetId), followsCollection()).catch(() => null);
  if (rel) return true;
  // Legacy fallback (pre-rel follows).
  return (await getLegacyFollowingIds(followerId)).includes(targetId);
}

// Pacing-escape write: follow pins can straddle the backend's ~12-15s
// pacing window — retry once past it (same shape as createResourceVerified).
async function kvSetFollowRecord(key: string, value: unknown): Promise<boolean> {
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) {
    if (i > 0 && Date.now() - t0 > 20000) break;
    const ok = await kvSet(key, value, followsCollection()).catch(() => false);
    if (ok) return true;
    if (i === 0) await new Promise((r) => setTimeout(r, 13000));
  }
  return false;
}

export interface FollowMutationResult {
  ok: boolean;
  error?: string;
  retryable?: boolean;
  already?: boolean;
  following?: string[];
  followingCount?: number;
  followersCount?: number;
}

export async function followUser(userId: string, targetId: string): Promise<FollowMutationResult> {
  if (!userId || !targetId) return { ok: false, error: 'Missing user id' };
  if (userId === targetId) return { ok: false, error: 'You cannot follow yourself' };
  const graph = await loadFollowGraph();
  if (graph.get(userId)?.has(targetId)) {
    // Already following — derive counts from the cached graph (no export).
    return countsFromGraph(graph, userId, targetId, true);
  }
  // ONE canonical write — no dual-write, no post-response flush to lose.
  const ok = await kvSetFollowRecord(relKey(userId, targetId), { t: Date.now() });
  if (!ok) return { ok: false, error: 'Follow could not be saved yet — please retry.', retryable: true };
  // Read-your-write: apply the confirmed edge to the cached graph and
  // derive counts from it (the backend export view can lag the write by
  // seconds — the response must be truthful the moment the write lands).
  graphApplyFollow(graph, userId, targetId);
  return countsFromGraph(graph, userId, targetId, false);
}

export async function unfollowUser(userId: string, targetId: string): Promise<FollowMutationResult> {
  if (!userId || !targetId) return { ok: false, error: 'Missing user id' };
  const graph = await loadFollowGraph();
  const has = graph.get(userId)?.has(targetId) === true;
  if (!has) {
    // Possibly a stale cache — check the canonical record before declaring
    // "already unfollowed" (cache miss on another instance's write).
    const rel = await kvGet(relKey(userId, targetId), followsCollection()).catch(() => null);
    if (!rel) {
      const legacy = await getLegacyFollowingIds(userId);
      if (!legacy.includes(targetId)) {
        return countsFromGraph(graph, userId, targetId, true);
      }
      // Legacy-only follow — scrub below.
      await kvSetFollowRecord(
        legacyFollowingKey(userId),
        legacy.filter((id) => id !== targetId)
      ).catch(() => false);
      graphApplyUnfollow(graph, userId, targetId);
      return countsFromGraph(graph, userId, targetId, false);
    }
  }
  await kvDeleteIdempotent(relKey(userId, targetId), followsCollection()).catch(() => false);
  // Same read-your-write guarantee (delete propagation lags).
  graphApplyUnfollow(graph, userId, targetId);
  return countsFromGraph(graph, userId, targetId, false);
}

// Shared response builder: fresh counts for both sides from one graph.
function countsFromGraph(
  graph: Map<string, Set<string>>,
  userId: string,
  targetId: string,
  already: boolean
): FollowMutationResult {
  const following = [...(graph.get(userId) ?? [])];
  let followersCount = 0;
  for (const targets of graph.values()) {
    if (targets.has(targetId)) followersCount += 1;
  }
  return { ok: true, already, following, followingCount: following.length, followersCount };
}

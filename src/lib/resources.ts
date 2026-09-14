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

import { kvSet, kvSetMulti, kvGet, kvDelete, kvExport, kvList, kvGetQuorum, kvSetSpread, kvDeleteSpread, kvDeleteIdempotent, stripExportPrefix } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';
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

// ============ Tombstones (deterministic deletes over a flaky backend) ============
//
// The backend flaps (same key: 200 then 404 seconds apart) and LISTs lag or
// miss keys (proven by direct probe). Deletes are therefore made
// DETERMINISTIC with immutable per-id tombstone keys `tomb:{id}` (plain
// SETs, no read-modify-write). Every listing quorum-checks each id's tomb
// via point-reads (never via tomb-LISTs — those flap too) — a deleted id
// stays hidden even if its record lingers somewhere. No ghosts, no stale
// counts, no delete errors.

// NOTE: tombs + index live in the pre-registered `categories` collection
// (otherwise unused). Ad-hoc collections (rge_*) proved non-durable:
// keys vanished within ~25 min, while pre-registered collections persist.
const TOMBSTONE_COLLECTION = ONYXBASE_COLLECTIONS.CATEGORIES;

function tombKeyFor(id: string): string {
  return `tomb:${id}`;
}

/**
 * Hide an id from every listing instantly (deleted or ghost).
 * Spread-write + quorum-confirm (2 tries): an unconfirmed tomb is worthless
 * against flapping reads, so verify at least one copy is readable.
 */
export async function tombstoneAdd(id: string): Promise<void> {
  try {
    for (let i = 0; i < 2; i++) {
      await kvSetSpread(tombKeyFor(id), { id, at: Date.now() }, TOMBSTONE_COLLECTION, 3);
      const back = await kvGetQuorum(tombKeyFor(id), TOMBSTONE_COLLECTION, 6);
      if (back) return;
    }
  } catch {
    // non-fatal
  }
}

// NOTE (2026-09-13): an append-only membership index lived here. Removed —
// the backend evaporates untouched KV within minutes (proven: keys in 3/3
// collections 404 six minutes after write), so server-side indexes/tombs
// are session-scoped mitigations at best. Membership = backend LIST union
// (+10-min client overlay for instant UX). Durability needs a real store.

export async function createResource(resource: Resource): Promise<boolean> {
  const collection = collectionForType(resource.type, resource.xmlSource);
  return kvSet(resource.id, resource, collection);
}

/**
 * Two-phase persistent create (PRD §9, §14, §49):
 * write the record, then verify it is readable before reporting success.
 * Only { ok: true, verified: true } may be surfaced as "Upload complete".
 */
export async function createResourceVerified(
  resource: Resource,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ ok: boolean; verified: boolean; attempts: number; ms: number }> {
  const collection = collectionForType(resource.type, resource.xmlSource);
  const t0 = Date.now();
  const maxAttempts = opts.retries ?? 3;
  // PACING-ESCAPE delays: the backend pins every write to Telegram and
  // paces pins (~12-15s window). Phase-1 (last chunk / thumbnail) lands
  // seconds before phase-2, so a failed write means "window armed" —
  // retrying in 500ms/1s burns EVERY attempt inside the SAME window
  // (proven live: chunked uploads always failed registration). Retries
  // sleep PAST the window instead (backend honor-cap is 12s, so 13s
  // always escapes even without reading the server's retryAfter).
  const retryDelayMs = opts.baseDelayMs ?? 13000;
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
    // Spread write (copies across replicas) + quorum read-back (any replica).
    wrote = await kvSetSpread(resource.id, resource, collection, 3);
    if (wrote) {
      // Single-round read-back: first-hit-wins usually answers <1s; the
      // 6-read double round was for the backend's spray era (long gone).
      const back = await kvGetQuorum<Resource>(resource.id, collection, 3);
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
 * Deterministic delete over divergent replicas: tombstone (spread 3× —
 * instant + durable hide) → record deletes (5× parallel, idempotent).
 * Read-back confirmation is meaningless when replicas disagree; the
 * tombstone is what guarantees the id never resurfaces. Never throws —
 * ghosts count as deleted.
 */
export async function deleteResourceVerified(
  id: string,
  type: ResourceType,
  xmlSource?: XmlSource
): Promise<{ deleted: boolean; confirmed: boolean }> {
  const collection = collectionForType(type, xmlSource);
  await tombstoneAdd(id);
  const deleted = await kvDeleteSpread(id, collection, 5);
  // Piggyback: prune day-old tombs so the DB doesn't accumulate them.
  void pruneOldTombs(24 * 60 * 60 * 1000);
  return { deleted, confirmed: deleted };
}

/**
 * Best-effort REAL deletes for an id across every resource collection.
 * Used when locate-by-type misses (record may still exist — backend flaps),
 * so "already gone" never skips the actual DELETE calls. Idempotent.
 */
export async function blindDeleteResource(id: string): Promise<void> {
  try {
    await Promise.all([
      kvDeleteSpread(id, ONYXBASE_COLLECTIONS.IMAGES, 3),
      kvDeleteSpread(id, ONYXBASE_COLLECTIONS.CLIPS, 3),
      kvDeleteSpread(id, ONYXBASE_COLLECTIONS.COMMUNITY_XMLS, 3),
      kvDeleteSpread(id, ONYXBASE_COLLECTIONS.ADMIN_XMLS, 3),
    ]);
  } catch {
    // best-effort
  }
}

/**
 * Prune tombstones older than `olderThanMs`. Tombs only need to outlive
 * backend convergence (minutes–hours); day-old tombs are dead weight.
 * ONLY touches `tomb:*` keys in the tomb collection. Returns pruned count.
 */
export async function pruneOldTombs(olderThanMs: number): Promise<number> {
  try {
    const [a, b] = await Promise.all([
      kvList(TOMBSTONE_COLLECTION),
      kvList(TOMBSTONE_COLLECTION),
    ]);
    const keys = [...new Set([...a, ...b])].filter((k) => k.startsWith('tomb:'));
    if (keys.length === 0) return 0;
    const now = Date.now();
    let pruned = 0;
    await Promise.all(
      keys.map(async (k) => {
        try {
          const v = await kvGet<{ at?: number }>(k, TOMBSTONE_COLLECTION);
          if (v && typeof v.at === 'number' && now - v.at > olderThanMs) {
            await kvDeleteSpread(k, TOMBSTONE_COLLECTION, 3);
            pruned++;
          }
        } catch {
          // skip — next sweep retries
        }
      })
    );
    return pruned;
  } catch {
    return 0;
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
  const value = await kvGetQuorum<Resource>(id, collection, 5);
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
  return kvGetQuorum<Resource>(id, collection, 3);
}

export async function updateResource(resource: Resource): Promise<boolean> {
  resource.updatedAt = new Date().toISOString();
  const collection = collectionForType(resource.type, resource.xmlSource);
  return kvSetSpread(resource.id, resource, collection, 3);
}

export async function deleteResource(id: string, type: ResourceType, xmlSource?: XmlSource): Promise<boolean> {
  const collection = collectionForType(type, xmlSource);
  return kvDelete(id, collection);
}

export async function listResources(type: ResourceType, xmlSource?: XmlSource): Promise<Resource[]> {
  const collection = collectionForType(type, xmlSource);

  // WAVE 1 — membership: union of 2 parallel backend LISTs (a single
  // LIST can miss keys). Fresh uploads appear here within seconds; the
  // client's 10-min overlay covers the gap instantly. No sleeps anywhere.
  const [listA, listB] = await Promise.all([
    kvList(collection),
    kvList(collection),
  ]);
  const ids = [...new Set([...listA, ...listB])];
  if (ids.length === 0) return [];

  // WAVE 2 — per id, in parallel chunks: quorum record read + quorum
  // tombstone check. A tombstoned id is hidden even if its record lingers
  // on some replica (tomb checks are quorum point-reads, never LISTs —
  // tomb-LISTs proved just as divergent as everything else).
  const CHUNK = 20;
  const found: Resource[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await Promise.all(
      chunk.map(async (id) => {
        const [rec, tomb] = await Promise.all([
          kvGetQuorum<Resource>(id, collection, 6),
          // Tomb check: full 2-round quorum. Single-round checks proved
          // flaky (parallel reads aren't independent), and a missed tomb =
          // a resurrected ghost. Clean misses cost ~5s (backend 404s are
          // slow) — the price of correct deletes on this backend.
          kvGetQuorum(tombKeyFor(id), TOMBSTONE_COLLECTION, 6),
        ]);
        if (tomb) return null;
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
 * FAST listing (PRD §14, §20–24 of the perf spec): ONE collection export
 * + ONE (cached) tombstone export, filtered locally — replaces the
 * 2 LISTs + 12N point-reads fan-out that made listing pages take minutes.
 *
 * Server-cached for 20s (non-empty results only, same policy as /all).
 * Writes invalidate via invalidateResources(). Falls back to the proven
 * quorum path when the export call fails.
 */
export async function listResourcesFast(type: ResourceType, xmlSource?: XmlSource): Promise<Resource[]> {
  const collection = collectionForType(type, xmlSource);
  const cacheKey = `resources:listfast:${collection}`;
  const cached = getCached<Resource[]>(cacheKey);
  if (cached) return cached;

  const [exported, tombs] = await Promise.all([
    kvExport(collection).catch(() => null),
    kvExport(TOMBSTONE_COLLECTION).catch(() => ({}) as Record<string, unknown>),
  ]);
  if (!exported) {
    // Export failed (backend flap) — the old path still works.
    return listResources(type, xmlSource);
  }

  const tombSet = new Set(
    Object.keys(tombs)
      .map((k) => stripExportPrefix(k, TOMBSTONE_COLLECTION))
      .filter((k) => k.startsWith('tomb:'))
  );

  const out: Resource[] = [];
  for (const rawKey of Object.keys(exported)) {
    const key = stripExportPrefix(rawKey, collection);
    if (tombSet.has(`tomb:${key}`)) continue; // deleted — stays hidden
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

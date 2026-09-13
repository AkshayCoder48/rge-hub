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

import { kvSet, kvGet, kvDelete, kvExport, kvList, kvGetQuorum, kvSetSpread, kvDeleteSpread } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';

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

  // Check if there's an existing profile (for username change detection)
  const existing = await getProfile(profile.userId);
  if (existing && existing.username.toLowerCase() !== normalized) {
    // Username changed — remove old index
    try {
      await kvDelete(`username:${existing.username.toLowerCase()}`, ONYXBASE_COLLECTIONS.PROFILES);
    } catch {}
  }

  // Set the main profile record
  const ok = await kvSet(`profile:${profile.userId}`, profile, ONYXBASE_COLLECTIONS.PROFILES);

  // Maintain username index
  if (ok) {
    await kvSet(`username:${normalized}`, profile.userId, ONYXBASE_COLLECTIONS.PROFILES);
  }

  return ok;
}

export async function getAllProfiles(): Promise<Profile[]> {
  const all = await kvExport<Record<string, Profile>>(ONYXBASE_COLLECTIONS.PROFILES);
  return Object.values(all).filter(p => p && p.userId) as Profile[];
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
  const baseDelay = opts.baseDelayMs ?? 500;
  let attempts = 0;
  let wrote = false;
  for (let i = 0; i < maxAttempts; i++) {
    attempts += 1;
    // Spread write (copies across replicas) + quorum read-back (any replica).
    wrote = await kvSetSpread(resource.id, resource, collection, 3);
    if (wrote) {
      const back = await kvGetQuorum<Resource>(resource.id, collection, 6);
      if (back && back.id === resource.id) {
        return { ok: true, verified: true, attempts, ms: Date.now() - t0 };
      }
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
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
  return { deleted, confirmed: deleted };
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
 * List all public resources across all types.
 * Optionally filter by published status.
 */
export async function listAllPublicResources(): Promise<Resource[]> {
  const [images, clips, communityXmls] = await Promise.all([
    listResources('image'),
    listResources('clip'),
    listResources('xml', 'community'),
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
    listResources('image'),
    listResources('clip'),
    listResources('xml', 'community'),
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

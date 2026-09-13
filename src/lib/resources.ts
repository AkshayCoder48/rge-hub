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

import { kvSet, kvGet, kvDelete, kvExport, kvList, kvSetVerified, kvGetWithRetry } from './onyxbase';
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
  return kvSetVerified(resource.id, resource, collection, {
    retries: opts.retries ?? 6,
    baseDelayMs: opts.baseDelayMs ?? 600,
  });
}

/**
 * Lightweight read-back verification for a single record (PRD §49).
 * Used by the verify endpoint and by registration retries.
 */
export async function verifyResource(
  id: string,
  type: ResourceType,
  xmlSource?: XmlSource
): Promise<{ verified: boolean; resource: Resource | null; attempts: number }> {
  const collection = collectionForType(type, xmlSource);
  const { value, attempts } = await kvGetWithRetry<Resource>(id, collection, {
    retries: 4,
    baseDelayMs: 600,
  });
  return { verified: value !== null, resource: value, attempts };
}

/**
 * Locate a resource by id across all public collections (no type needed).
 * Used by public resource pages (/r/[id]) and the sitemap.
 * NEVER includes admin XMLs unless includeAdmin is true (server-side only).
 */
export async function getResourceAny(
  id: string,
  opts: { includeAdmin?: boolean } = {}
): Promise<Resource | null> {
  const img = await getResource(id, 'image').catch(() => null);
  if (img) return img;
  const clip = await getResource(id, 'clip').catch(() => null);
  if (clip) return clip;
  const cx = await getResource(id, 'xml', 'community').catch(() => null);
  if (cx) return cx;
  if (opts.includeAdmin) {
    const ax = await getResource(id, 'xml', 'admin').catch(() => null);
    if (ax) return ax;
  }
  return null;
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

  // OnyxBase has eventual consistency issues — try list+get first, then export
  // Try kvList + kvGet (individual key reads are more consistent)
  const keys = await kvList(collection);
  if (keys.length > 0) {
    const results = await Promise.all(
      keys.map(key => kvGet<Resource>(key, collection))
    );
    const filtered = results.filter((r): r is Resource => r !== null && r !== undefined && r.id);
    if (filtered.length > 0) return filtered;
  }

  // Fallback to kvExport
  const all = await kvExport<Record<string, Resource>>(collection);
  return Object.values(all).filter(Boolean) as Resource[];
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

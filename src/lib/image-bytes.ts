/**
 * Permanent lossless image byte store.
 *
 * PROBLEM: file objects on the backing storage can rot/expire over time
 * (images "corrupt" weeks later), while KV records stay durable. External
 * keyless image hosts are unreliable from cloud IPs (blocked / dead).
 *
 * SOLUTION: store the ORIGINAL image bytes (100% lossless — zero quality
 * loss, bit-for-bit) sharded across durable KV records, and serve them from
 * OUR domain via /api/img/[resourceId] with immutable edge caching.
 *
 * - Shard size 2MB base64 keeps every KV value small and reliable.
 * - A manifest record holds { shards, size, sha256, mimeType } and is
 *   write-verified; shards are content-verified on read (length + sha256).
 * - Keys are namespaced `rb:{fileKey}:{index}` / `rb:{fileKey}:manifest`
 *   inside the dedicated `resource_bytes` collection — the cleanup rules
 *   for temporary uploads NEVER touch this collection.
 */

import crypto from 'crypto';
import { kvSet, kvSetVerified, kvGetQuorum, kvDeleteIdempotent, ONYXBASE_COLLECTIONS } from './onyxbase';

const BYTES_COLLECTION =
  (ONYXBASE_COLLECTIONS as Record<string, string>).RESOURCE_BYTES || 'resource_bytes';

/** Raw-image cap for the byte store (larger images still work via file URLs). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Base64 shard size — keeps each KV value small and reliable. */
const SHARD_CHARS = 2 * 1024 * 1024;

export interface BytesManifest {
  v: 1;
  shards: number;
  size: number;
  sha256: string;
  mimeType: string;
  storedAt: string;
}

function manifestKey(fileKey: string): string {
  return `rb:${fileKey}:manifest`;
}

function shardKey(fileKey: string, index: number): string {
  return `rb:${fileKey}:${index}`;
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// SINGLE attempt (was 3): every shard write pins the ONE shared index
// message — parallel shards × retries raced it into Telegram 429s and a
// minutes-long throttle storm (proven live). The route owns the retry now.
async function setWithRetry(key: string, value: string, attempts = 1): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const ok = await kvSet(key, value, BYTES_COLLECTION);
      if (ok) return true;
    } catch {}
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  return false;
}

/**
 * Store original image bytes permanently. Returns manifest info on success.
 * Any failure returns { ok: false } — the caller falls back to file URLs
 * (the upload itself must never fail because the byte store hiccuped).
 */
export async function storeImageBytes(
  fileKey: string,
  bytes: Buffer,
  mimeType: string
): Promise<{ ok: true; shards: number; size: number; sha256: string } | { ok: false; error: string }> {
  try {
    if (!bytes || bytes.length === 0) return { ok: false, error: 'empty bytes' };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'over byte-store cap' };

    const b64 = bytes.toString('base64');
    const totalShards = Math.max(1, Math.ceil(b64.length / SHARD_CHARS));
    const sha256 = sha256Hex(bytes);
    const t0 = Date.now();

    // SERIAL shards, hard deadline: every shard pins the one shared index
    // message, so parallel shards raced it into Telegram 429s (proven: a
    // single image upload armed a minutes-long throttle storm). The byte
    // store is best-effort — if shards can't land inside the budget the
    // upload still succeeds via file URL + mirror.
    const BYTE_STORE_DEADLINE_MS = 15000;
    for (let i = 0; i < totalShards; i++) {
      if (Date.now() - t0 > BYTE_STORE_DEADLINE_MS) {
        return { ok: false, error: 'byte-store budget exceeded' };
      }
      const slice = b64.slice(i * SHARD_CHARS, (i + 1) * SHARD_CHARS);
      const ok = await setWithRetry(shardKey(fileKey, i), slice);
      if (!ok) {
        return { ok: false, error: 'shard write failed' };
      }
    }
    if (Date.now() - t0 > BYTE_STORE_DEADLINE_MS) {
      return { ok: false, error: 'byte-store budget exceeded' };
    }

    const manifest: BytesManifest = {
      v: 1,
      shards: totalShards,
      size: bytes.length,
      sha256,
      mimeType,
      storedAt: new Date().toISOString(),
    };
    const verified = await kvSetVerified(manifestKey(fileKey), manifest, BYTES_COLLECTION);
    if (!verified.ok || !verified.verified) {
      return { ok: false, error: 'manifest not confirmed' };
    }
    return { ok: true, shards: totalShards, size: bytes.length, sha256 };
  } catch (err) {
    console.error('[image-bytes] store failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'store failed' };
  }
}

/**
 * Load and verify original image bytes. Returns null when unavailable or
 * when integrity verification fails (caller falls back to mirror/file URL).
 */
export async function loadImageBytes(
  fileKey: string
): Promise<{ bytes: Buffer; mimeType: string; size: number } | null> {
  try {
    // Quorum reads — backend replicas diverge, single GETs are coin flips.
    const manifest = await kvGetQuorum<BytesManifest>(manifestKey(fileKey), BYTES_COLLECTION, 3);
    if (!manifest || manifest.v !== 1 || !manifest.shards || manifest.shards > 64) {
      return null;
    }
    // Parallel quorum shard reads for speed + reliability.
    const parts = await Promise.all(
      Array.from({ length: manifest.shards }, (_, i) =>
        kvGetQuorum<string>(shardKey(fileKey, i), BYTES_COLLECTION, 2)
      )
    );
    if (parts.some((p) => typeof p !== 'string' || p.length === 0)) {
      console.warn('[image-bytes] missing shard for', fileKey);
      return null;
    }
    const bytes = Buffer.from((parts as string[]).join(''), 'base64');
    if (bytes.length !== manifest.size) {
      console.warn('[image-bytes] size mismatch for', fileKey);
      return null;
    }
    if (sha256Hex(bytes) !== manifest.sha256) {
      console.warn('[image-bytes] sha mismatch for', fileKey);
      return null;
    }
    return { bytes, mimeType: manifest.mimeType || 'application/octet-stream', size: bytes.length };
  } catch (err) {
    console.warn('[image-bytes] load failed:', err);
    return null;
  }
}

/**
 * Permanently delete a fileKey's byte-store records (manifest + all shards).
 * Called when a resource is deleted so the lossless bytes don't leak in KV +
 * the Telegram snapshot forever. Idempotent — deleting absent keys is a
 * no-op. Manifest-first for the shard count; without a manifest it probes a
 * bounded window of shard slots (legacy partial stores) and always removes
 * the manifest key itself.
 */
export async function deleteImageBytes(fileKey: string): Promise<number> {
  try {
    const manifest = await kvGetQuorum<BytesManifest>(manifestKey(fileKey), BYTES_COLLECTION, 3);
    const shardCount =
      manifest && manifest.v === 1 && manifest.shards && manifest.shards <= 64
        ? manifest.shards
        : 16; // bounded legacy probe (10MB cap / 2MB shards ≈ max 7 real shards)
    let deleted = 0;
    const jobs: Array<Promise<boolean>> = [
      kvDeleteIdempotent(manifestKey(fileKey), BYTES_COLLECTION),
    ];
    for (let i = 0; i < shardCount; i++) {
      jobs.push(kvDeleteIdempotent(shardKey(fileKey, i), BYTES_COLLECTION));
    }
    const results = await Promise.all(jobs);
    results.forEach((ok) => {
      if (ok) deleted++;
    });
    return deleted;
  } catch (err) {
    console.warn('[image-bytes] delete failed:', err);
    return 0;
  }
}

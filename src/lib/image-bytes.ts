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
import { kvSet, kvGet, kvSetVerified, ONYXBASE_COLLECTIONS } from './onyxbase';

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

async function setWithRetry(key: string, value: string, attempts = 3): Promise<boolean> {
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

    // Shard writes are independent — run them in parallel for speed.
    const CONCURRENCY = 4;
    for (let start = 0; start < totalShards; start += CONCURRENCY) {
      const batch: Promise<boolean>[] = [];
      for (let i = start; i < Math.min(start + CONCURRENCY, totalShards); i++) {
        const slice = b64.slice(i * SHARD_CHARS, (i + 1) * SHARD_CHARS);
        batch.push(setWithRetry(shardKey(fileKey, i), slice));
      }
      const results = await Promise.all(batch);
      if (results.some((r) => !r)) {
        return { ok: false, error: 'shard write failed' };
      }
    }

    const manifest: BytesManifest = {
      v: 1,
      shards: totalShards,
      size: bytes.length,
      sha256,
      mimeType,
      storedAt: new Date().toISOString(),
    };
    const verified = await kvSetVerified(manifestKey(fileKey), manifest, BYTES_COLLECTION, {
      retries: 5,
      baseDelayMs: 600,
    });
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
    const manifest = await kvGet<BytesManifest>(manifestKey(fileKey), BYTES_COLLECTION);
    if (!manifest || manifest.v !== 1 || !manifest.shards || manifest.shards > 64) {
      return null;
    }
    // Parallel shard reads for speed.
    const parts = await Promise.all(
      Array.from({ length: manifest.shards }, (_, i) =>
        kvGet<string>(shardKey(fileKey, i), BYTES_COLLECTION)
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

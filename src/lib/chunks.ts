/**
 * Chunked upload store — defeats the ~4.5MB Vercel serverless request limit.
 *
 * Large files are sliced client-side into ≤2.5MB pieces, each POSTed to
 * /api/uploads/chunk (small enough for serverless), persisted in the
 * dedicated `upload_chunks` KV collection, then assembled server-side by
 * the consumer (analyze / speedramp / resource upload-complete) in ONE
 * request — so reassembly never depends on serverless instance affinity.
 *
 * BACKEND REALITY (proven by probe): OnyxBase sprays parallel requests
 * across per-instance memory — 4 parallel SETs return all-200 yet a fresh
 * reader GETs all-404. Mitigations in this file:
 * - The client uploads chunks SEQUENTIALLY (see chunked-client.ts), so all
 *   keys land on one warm backend instance.
 * - The manifest is spread-written (parallel copies → many instances).
 * - Assembly verifies the ACTUAL chunk keys via parallel quorum reads
 *   (sprayed reads find whichever instance holds each key) — never the
 *   racy manifest `received` counter (parallel writers clobber it).
 *
 * SAFETY (PRD §43-44): chunk keys live in their own collection with the
 * `chunk:{uploadId}:{index}` shape plus a manifest. Cleanup deletes ONLY
 * keys for the exact uploadId being assembled — never anything else.
 */

import { kvSet, kvDelete, kvGetQuorum, kvSetSpread } from './onyxbase';

const CHUNKS_COLLECTION = 'upload_chunks';

/** Max chunks per upload (40 × 2.5MB ≈ 100MB ceiling). */
export const MAX_CHUNKS = 40;
/** Max base64 payload per chunk (~2.5MB raw → ~3.4MB base64 + JSON < 4.5MB). */
export const MAX_CHUNK_CHARS = 4 * 1024 * 1024;

const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidUploadId(id: unknown): id is string {
  return typeof id === 'string' && UPLOAD_ID_RE.test(id);
}

function chunkKey(uploadId: string, index: number): string {
  return `chunk:${uploadId}:${index}`;
}

function manifestKey(uploadId: string): string {
  return `chunk:${uploadId}:manifest`;
}

export interface ChunkManifest {
  v: 1;
  total: number;
  fileName: string;
  mimeType: string;
  size: number;
  received: number[];
  createdAt: string;
}

export async function saveChunk(
  uploadId: string,
  index: number,
  total: number,
  fileName: string,
  mimeType: string,
  size: number,
  chunkB64: string
): Promise<{ ok: boolean; received: number; error?: string }> {
  if (!isValidUploadId(uploadId)) return { ok: false, received: 0, error: 'Bad upload id' };
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total) {
    return { ok: false, received: 0, error: 'Bad chunk index' };
  }
  if (total > MAX_CHUNKS) {
    return { ok: false, received: 0, error: `Too many chunks (max ${MAX_CHUNKS})` };
  }
  if (typeof chunkB64 !== 'string' || chunkB64.length === 0 || chunkB64.length > MAX_CHUNK_CHARS) {
    return { ok: false, received: 0, error: 'Bad chunk payload' };
  }

  const wrote = await kvSet(chunkKey(uploadId, index), chunkB64, CHUNKS_COLLECTION);
  if (!wrote) return { ok: false, received: 0, error: 'Chunk store failed' };

  // Best-effort manifest hint (racy by nature — assembly never trusts it).
  // Spread-written so at least one copy is findable from any instance.
  try {
    const manifest = await kvGetQuorum<ChunkManifest>(manifestKey(uploadId), CHUNKS_COLLECTION, 2);
    const next: ChunkManifest =
      manifest && manifest.total === total
        ? manifest
        : { v: 1, total, fileName, mimeType, size, received: [], createdAt: new Date().toISOString() };
    if (!next.received.includes(index)) {
      next.received.push(index);
      next.received.sort((a, b) => a - b);
    }
    await kvSetSpread(manifestKey(uploadId), next, CHUNKS_COLLECTION, 3);
    return { ok: true, received: next.received.length };
  } catch {
    return { ok: true, received: index + 1 };
  }
}

/**
 * Assemble all chunks into one Buffer. Completeness is verified against
 * the ACTUAL chunk keys via quorum reads — never the racy manifest counter.
 * Best-effort cleanup of this upload's chunk keys afterwards (non-fatal).
 */
export async function assembleChunks(
  uploadId: string
): Promise<
  | { ok: true; bytes: Buffer; fileName: string; mimeType: string; size: number }
  | { ok: false; error: string }
> {
  if (!isValidUploadId(uploadId)) return { ok: false, error: 'Bad upload id' };
  // Manifest (tiny) via quorum — only `total`/names are used from it.
  const manifest = await kvGetQuorum<ChunkManifest>(manifestKey(uploadId), CHUNKS_COLLECTION, 3);
  if (!manifest || manifest.v !== 1 || !manifest.total) {
    return { ok: false, error: 'Upload session not found. Please re-upload.' };
  }

  // Verify EVERY chunk key exists (parallel quorum reads sprayed across
  // backend instances — first-hit-wins keeps the common case to 1 round).
  const parts = await Promise.all(
    Array.from({ length: manifest.total }, (_, i) =>
      kvGetQuorum<string>(chunkKey(uploadId, i), CHUNKS_COLLECTION, 2)
    )
  );
  const missing: number[] = [];
  parts.forEach((p, i) => {
    if (typeof p !== 'string' || p.length === 0) missing.push(i);
  });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing chunks [${missing.join(', ')}] of ${manifest.total}. Please re-upload.`,
    };
  }
  const bytes = Buffer.concat(
    (parts as string[]).map((p) => Buffer.from(p, 'base64'))
  );

  // Best-effort cleanup of ONLY this upload's keys.
  cleanupChunks(uploadId, manifest.total).catch(() => {});

  return { ok: true, bytes, fileName: manifest.fileName, mimeType: manifest.mimeType, size: bytes.length };
}

export async function cleanupChunks(uploadId: string, total: number): Promise<void> {
  if (!isValidUploadId(uploadId)) return;
  const jobs: Promise<unknown>[] = [];
  for (let i = 0; i < Math.min(total, MAX_CHUNKS); i++) {
    jobs.push(kvDelete(chunkKey(uploadId, i), CHUNKS_COLLECTION).catch(() => false));
  }
  jobs.push(kvDelete(manifestKey(uploadId), CHUNKS_COLLECTION).catch(() => false));
  await Promise.all(jobs);
}

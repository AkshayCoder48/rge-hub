/**
 * Chunked upload store — defeats the ~4.5MB Vercel serverless request limit.
 *
 * Large files are sliced client-side into ≤2.5MB pieces, each POSTed to
 * /api/uploads/chunk (small enough for serverless), persisted in the
 * dedicated `upload_chunks` KV collection, then assembled server-side by
 * the consumer (analyze / speedramp / resource upload-complete) in ONE
 * request — so reassembly never depends on serverless instance affinity.
 *
 * SAFETY (PRD §43-44): chunk keys live in their own collection with the
 * `chunk:{uploadId}:{index}` shape plus a manifest. Cleanup deletes ONLY
 * keys for the exact uploadId being assembled — never anything else.
 */

import { kvSet, kvGet, kvDelete } from './onyxbase';

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

  // Update manifest (create if missing).
  let manifest = await kvGet<ChunkManifest>(manifestKey(uploadId), CHUNKS_COLLECTION).catch(() => null);
  if (!manifest || manifest.total !== total) {
    manifest = { v: 1, total, fileName, mimeType, size, received: [], createdAt: new Date().toISOString() };
  }
  if (!manifest.received.includes(index)) {
    manifest.received.push(index);
    manifest.received.sort((a, b) => a - b);
  }
  await kvSet(manifestKey(uploadId), manifest, CHUNKS_COLLECTION).catch(() => false);
  return { ok: true, received: manifest.received.length };
}

/**
 * Assemble all chunks into one Buffer. Verifies completeness first.
 * Best-effort cleanup of this upload's chunk keys afterwards (non-fatal).
 */
export async function assembleChunks(
  uploadId: string
): Promise<
  | { ok: true; bytes: Buffer; fileName: string; mimeType: string; size: number }
  | { ok: false; error: string }
> {
  if (!isValidUploadId(uploadId)) return { ok: false, error: 'Bad upload id' };
  const manifest = await kvGet<ChunkManifest>(manifestKey(uploadId), CHUNKS_COLLECTION).catch(
    () => null
  );
  if (!manifest || manifest.v !== 1) {
    return { ok: false, error: 'Upload session not found. Please re-upload.' };
  }
  if (manifest.received.length < manifest.total) {
    return {
      ok: false,
      error: `Incomplete upload (${manifest.received.length}/${manifest.total} chunks). Please retry.`,
    };
  }

  const parts = await Promise.all(
    Array.from({ length: manifest.total }, (_, i) =>
      kvGet<string>(chunkKey(uploadId, i), CHUNKS_COLLECTION).catch(() => null)
    )
  );
  if (parts.some((p) => typeof p !== 'string' || p.length === 0)) {
    return { ok: false, error: 'A chunk is missing. Please re-upload.' };
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

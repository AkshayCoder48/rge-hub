/**
 * Server-side proxy to OnyxBase V5 PARTS storage (permanent, resumable,
 * Telegram-backed large files — docs/v5-contract.md §11b).
 *
 * The browser NEVER talks to OnyxBase directly: /api/storage/* routes on the
 * hub authenticate the session, then forward to the V5 engine with the
 * master key. Chunking is INVISIBLE to the user — one logical file, one
 * permanent URL (`https://<onyxbase>/f/<blobId>`), HTTP Range serving.
 *
 * Flow (per file):
 *   1. init     {filename, size, mimeType, checksum?} → {uploadId, chunkSize, totalChunks}
 *   2. status   GET → {receivedChunks, missingChunks}  → resume skips the received
 *   3. parts    PUT raw body (exactly chunkSize bytes; last = remainder) — idempotent
 *   4. complete {parts:[refs]} → verify-every-ref + durable manifest → ready + URL
 *
 * Dedup: init with the same full-file checksum → complete returns
 * alreadyProcessed:true with the EXISTING ready blob (no duplicate bytes).
 */

import { ONYXBASE_V5_ENABLED, ONYXBASE_API_KEY, ONYXBASE_V5_URL } from './onyxbase';

export interface V5StorageInit {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  status: string;
}

export interface V5StorageStatus {
  uploadId: string;
  status: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  missingChunks: number[];
  /** Durable refs for received parts — the resume client re-sends them at complete. */
  parts: Array<{ index: number; fileId: string; messageId?: number }>;
  /** Present when the session already finalized — the permanent URL. */
  publicUrl?: string;
  checksum: string | null;
}

/** Session geometry from init — forwarded with part PUTs and finalize so the
 *  engine can work statelessly on any instance (no cross-instance wait). */
export interface StorageSessionContext {
  size: number;
  chunkSize: number;
  totalChunks: number;
  checksum?: string | null;
  filename?: string | null;
  mimeType?: string | null;
}

export interface V5StoragePart {
  index: number;
  fileId: string;
  messageId?: number | null;
  bytes: number;
  checksum?: string;
  alreadyStored?: boolean;
}

export interface V5StorageComplete {
  blobId: string;
  status: 'ready';
  /** Absolute permanent URL (https://<onyxbase>/f/<blobId>) — Range-aware. */
  url: string;
  size: number;
  checksum: string | null;
  totalChunks: number;
  alreadyProcessed?: boolean;
  dedupOf?: string;
}

export class V5StorageError extends Error {
  code: string;
  status: number;
  retryAfterSecs?: number;
  missingChunks?: number[];
  constructor(code: string, message: string, status: number, extra?: { retryAfterSecs?: number; missingChunks?: number[] }) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSecs = extra?.retryAfterSecs;
    this.missingChunks = extra?.missingChunks;
  }
}

/** True when the hub can proxy V5 parts storage. */
export function v5StorageAvailable(): boolean {
  return ONYXBASE_V5_ENABLED;
}

async function v5Call(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT'; headers?: Record<string, string>; body?: BodyInit; timeoutMs?: number } = {}
): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${ONYXBASE_V5_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${ONYXBASE_API_KEY}`,
        ...(init.headers || {}),
      },
      body: init.body,
      signal: controller.signal,
      // Same-origin cookies never apply; the master key is the credential.
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { ok: false, code: 'NETWORK_ERROR', error: err instanceof Error ? err.message : 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}

/** Unwrap {ok:true,data} | raw payload → data, or throw V5StorageError. */
function unwrap(r: { status: number; body: any }, fallbackCode: string): any {
  if (r.status === 0) {
    throw new V5StorageError('NETWORK_ERROR', r.body?.error || 'Could not reach the storage engine.', 502);
  }
  if (r.status === 429) {
    const retry = Number(r.body?.retryAfter ?? r.body?.retry_after ?? 5) || 5;
    throw new V5StorageError('RATE_LIMITED', 'Storage is busy — retry in a moment.', 429, { retryAfterSecs: retry });
  }
  if (r.status >= 400) {
    throw new V5StorageError(
      r.body?.code || fallbackCode,
      r.body?.error || `Storage request failed (HTTP ${r.status}).`,
      r.status,
      { missingChunks: Array.isArray(r.body?.details?.missingChunks) ? r.body.details.missingChunks : undefined }
    );
  }
  const body = r.body;
  if (body && typeof body === 'object' && body.ok !== false) {
    return body.data && typeof body.data === 'object' ? body.data : body;
  }
  throw new V5StorageError(fallbackCode, 'Unexpected storage response.', 502);
}

// ─── 1. init ────────────────────────────────────────────────────────────────

export async function storageInit(meta: {
  filename: string;
  size: number;
  mimeType: string;
  checksum?: string;
}): Promise<V5StorageInit> {
  if (!v5StorageAvailable()) {
    throw new V5StorageError('V5_STORAGE_DISABLED', 'Permanent resumable storage is not configured.', 503);
  }
  const r = await v5Call('/api/v5/blobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunked: true,
      filename: meta.filename,
      mimeType: meta.mimeType,
      size: meta.size,
      checksum: meta.checksum,
      isPublic: true,
    }),
  });
  const data = unwrap(r, 'UPLOAD_STORAGE_ERROR');
  if (!data.blobId || typeof data.chunkSize !== 'number' || typeof data.totalChunks !== 'number') {
    throw new V5StorageError('UPLOAD_STORAGE_ERROR', 'Storage session could not be created.', 502);
  }
  return { uploadId: data.blobId, chunkSize: data.chunkSize, totalChunks: data.totalChunks, status: data.status || 'created' };
}

// ─── 2. status (resume) ─────────────────────────────────────────────────────

export async function storageStatus(uploadId: string): Promise<V5StorageStatus> {
  const r = await v5Call(`/api/v5/blobs/${encodeURIComponent(uploadId)}`, { method: 'GET' });
  const data = unwrap(r, 'NOT_FOUND');
  return {
    uploadId: data.blobId || uploadId,
    status: data.status,
    size: data.size,
    chunkSize: data.chunkSize,
    totalChunks: data.totalChunks,
    receivedChunks: Array.isArray(data.receivedChunks) ? data.receivedChunks : [],
    missingChunks: Array.isArray(data.missingChunks) ? data.missingChunks : [],
    parts: Array.isArray(data.parts)
      ? data.parts.filter((p: any) => p && typeof p.index === 'number' && typeof p.fileId === 'string')
      : [],
    publicUrl: typeof data.publicUrl === 'string' ? data.publicUrl : undefined,
    checksum: data.checksum ?? null,
  };
}

// ─── 3. part upload (raw bytes; idempotent per index) ──────────────────────

export async function storagePutPart(
  uploadId: string,
  index: number,
  body: ArrayBuffer,
  mimeType: string,
  ctx?: StorageSessionContext | null
): Promise<V5StoragePart> {
  // Stateless-session query params: the engine reconstructs the session on
  // any instance instead of waiting for snapshot convergence (seconds).
  const q = ctx
    ? `?size=${Math.floor(ctx.size)}&cs=${Math.floor(ctx.chunkSize)}&tc=${ctx.totalChunks}` +
      (ctx.checksum ? `&sum=${encodeURIComponent(ctx.checksum)}` : '') +
      (ctx.filename ? `&fn=${encodeURIComponent(ctx.filename.slice(0, 120))}` : '') +
      (ctx.mimeType ? `&mime=${encodeURIComponent(ctx.mimeType.slice(0, 60))}` : '')
    : '';
  const r = await v5Call(
    `/api/v5/blobs/${encodeURIComponent(uploadId)}/parts/${index}${q}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': mimeType || 'application/octet-stream' },
      body: new Uint8Array(body),
      timeoutMs: 120_000,
    }
  );
  const data = unwrap(r, 'UPLOAD_STORAGE_ERROR');
  return {
    index: data.index ?? index,
    fileId: data.fileId,
    messageId: data.messageId ?? null,
    bytes: data.bytes ?? body.byteLength,
    checksum: data.checksum,
    alreadyStored: data.alreadyStored === true,
  };
}

// ─── 4. complete (verify + durable manifest + permanent URL) ───────────────

export async function storageComplete(
  uploadId: string,
  parts: Array<{ index: number; fileId: string; messageId?: number | null }>,
  ctx?: StorageSessionContext | null
): Promise<V5StorageComplete> {
  const r = await v5Call(`/api/v5/blobs/${encodeURIComponent(uploadId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'finalize',
      parts,
      // Stateless finalize context — same reason as part PUTs.
      context: ctx
        ? {
            size: Math.floor(ctx.size),
            chunkSize: Math.floor(ctx.chunkSize),
            totalChunks: ctx.totalChunks,
            checksum: ctx.checksum ?? null,
            filename: ctx.filename ?? null,
            mimeType: ctx.mimeType ?? null,
          }
        : undefined,
    }),
    timeoutMs: 180_000,
  });
  const data = unwrap(r, 'UPLOAD_STORAGE_ERROR');
  if (data.status !== 'ready' || !data.blobId) {
    throw new V5StorageError('UPLOAD_STORAGE_ERROR', 'Storage could not finalize the file.', 502);
  }
  // `url` is /f/<id> on the engine — absolutize to the public engine origin.
  const url = data.url && String(data.url).startsWith('http')
    ? String(data.url)
    : `${ONYXBASE_V5_URL}/f/${data.blobId}`;
  return {
    blobId: data.blobId,
    status: 'ready',
    url,
    size: data.size,
    checksum: data.checksum ?? null,
    totalChunks: data.totalChunks,
    alreadyProcessed: data.alreadyProcessed === true,
    dedupOf: data.dedupOf,
  };
}

// ─── cancel (cleanup staged parts) ─────────────────────────────────────────

export async function storageCancel(uploadId: string): Promise<void> {
  try {
    await v5Call(`/api/v5/blobs/${encodeURIComponent(uploadId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
  } catch {
    /* best-effort cleanup */
  }
}

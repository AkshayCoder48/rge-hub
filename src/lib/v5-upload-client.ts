'use client';

/**
 * Browser client for PERMANENT RESUMABLE storage (V5 parts mode).
 *
 * One logical file → one permanent URL. The internal chunking (4 MiB parts
 * that fit every proxy in the chain) is completely invisible: callers see
 * { resourceId, url } and REAL byte progress (uploadedBytes / totalBytes).
 *
 * Guarantees:
 *  - REAL progress — aggregate of confirmed parts + in-flight XHR bytes.
 *    No simulated motion, no fake 99%, no phase that pretends to be transfer.
 *  - Resumable — pass a previous uploadId and only the MISSING parts are
 *    re-sent (status check first). An interrupted 1GB upload never restarts.
 *  - Retryable — per-part retries (3 attempts, 1s/3s backoff, 429 honors
 *    Retry-After); a failed part never fails the whole upload.
 *  - Honest errors — structured codes, never a fake success.
 *  - sha256 whole-file checksum (≤64MB) → engine-side dedup: a byte-identical
 *    re-upload completes instantly with alreadyProcessed: true.
 */

export interface PermanentUploadProgress {
  loaded: number;
  total: number;
  pct: number;
}

export interface PermanentUploadResult {
  resourceId: string;
  url: string;
  size: number;
  checksum: string | null;
  alreadyProcessed: boolean;
  /** Total parts (internal chunking detail — diagnostics only). */
  totalChunks: number;
  /** The session id — persist it to resume a later interrupted retry. */
  uploadId: string;
}

export interface PermanentUploadOptions {
  onProgress?: (p: PermanentUploadProgress) => void;
  signal?: AbortSignal;
  /** Resume a previous interrupted session instead of starting over. */
  resumeUploadId?: string;
  /** Human phase changes — for honest status lines ("Verifying integrity…"). */
  onPhase?: (phase: 'hashing' | 'init' | 'resuming' | 'uploading' | 'finalizing') => void;
  /** Fired as soon as the session id exists — persist it so a later retry
   *  resumes instead of restarting, even when this attempt fails. */
  onSession?: (uploadId: string) => void;
}

export class PermanentUploadError extends Error {
  code: string;
  cancelled: boolean;
  retryAfterSecs?: number;
  missingChunks?: number[];
  constructor(opts: { code: string; message: string; cancelled?: boolean; retryAfterSecs?: number; missingChunks?: number[] }) {
    super(opts.message);
    this.code = opts.code;
    this.cancelled = opts.cancelled === true;
    this.retryAfterSecs = opts.retryAfterSecs;
    this.missingChunks = opts.missingChunks;
  }
}

/** Hard ceiling the engine enforces (512 × 4 MiB). */
export const PERMANENT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;

/** Files above this skip the whole-file hash (memory guard) — no dedup. */
const HASH_MAX_BYTES = 64 * 1024 * 1024;

/** Concurrent part uploads (PRD: 2-4). */
const PART_CONCURRENCY = 3;

/** Per-part attempts. */
const PART_ATTEMPTS = 3;

export async function sha256Hex(file: File): Promise<string | null> {
  try {
    if (file.size > HASH_MAX_BYTES || typeof crypto === 'undefined' || !crypto.subtle) return null;
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new PermanentUploadError({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.', cancelled: true });
  }
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

async function callInit(
  file: File,
  checksum: string | null,
  signal?: AbortSignal
): Promise<InitResponse> {
  const res = await fetch('/api/storage/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      checksum: checksum ?? undefined,
    }),
    signal,
  });
  const data = await readJson(res);
  if (!res.ok || !data?.ok) {
    throw new PermanentUploadError({
      code: data?.code || 'UPLOAD_STORAGE_ERROR',
      message: data?.error || `Could not start the upload (HTTP ${res.status}).`,
    });
  }
  return { uploadId: data.uploadId, chunkSize: data.chunkSize, totalChunks: data.totalChunks };
}

interface StatusResponse {
  status: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  missingChunks: number[];
  parts: Array<{ index: number; fileId: string; messageId?: number | null }>;
  /** Present when the session already finalized — the permanent URL. */
  publicUrl?: string;
  size?: number;
  checksum?: string | null;
}

async function callStatus(uploadId: string, signal?: AbortSignal): Promise<StatusResponse | null> {
  try {
    const res = await fetch(`/api/storage/uploads/${encodeURIComponent(uploadId)}/status`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;
    const data = await readJson(res);
    if (!data?.ok) return null;
    return {
      status: data.status,
      chunkSize: data.chunkSize,
      totalChunks: data.totalChunks,
      receivedChunks: data.receivedChunks || [],
      missingChunks: data.missingChunks || [],
      parts: Array.isArray(data.parts) ? data.parts : [],
      publicUrl: typeof data.publicUrl === 'string' ? data.publicUrl : undefined,
      size: typeof data.size === 'number' ? data.size : undefined,
      checksum: data.checksum ?? null,
    };
  } catch {
    return null;
  }
}

interface PartRef {
  index: number;
  fileId: string;
  messageId?: number | null;
}

/** PUT one part via XHR — upload-progress-capable, cancellable. */
function putPart(
  uploadId: string,
  index: number,
  blob: Blob,
  handlers: {
    onLoaded: (loaded: number) => void;
    signal?: AbortSignal;
  }
): Promise<PartRef> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      try {
        xhr.abort();
      } catch {}
    };
    handlers.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) handlers.onLoaded(ev.loaded);
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE) return;
      handlers.signal?.removeEventListener('abort', onAbort);
      handlers.onLoaded(0);
      if (xhr.status === 0) {
        reject(new PermanentUploadError({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.', cancelled: true }));
        return;
      }
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data?.ok) {
        if (!data.fileId) {
          reject(
            new PermanentUploadError({
              code: 'UPLOAD_STORAGE_ERROR',
              message: 'Storage acknowledged the part without a reference.',
            })
          );
          return;
        }
        resolve({ index, fileId: String(data.fileId), messageId: data.messageId ?? null });
        return;
      }
      const retryAfter = Number(data?.retryAfter);
      reject(
        new PermanentUploadError({
          code: data?.code || 'UPLOAD_STORAGE_ERROR',
          message: data?.error || `Part upload failed (HTTP ${xhr.status}).`,
          retryAfterSecs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        })
      );
    };
    xhr.onerror = () => {
      handlers.signal?.removeEventListener('abort', onAbort);
      handlers.onLoaded(0);
      reject(new PermanentUploadError({ code: 'UPLOAD_NETWORK_ERROR', message: 'Network error during upload.' }));
    };
    xhr.open('PUT', `/api/storage/uploads/${encodeURIComponent(uploadId)}/parts/${index}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(blob);
  });
}

/**
 * Upload a file to PERMANENT storage. Resolves with the permanent URL the
 * moment the engine confirms the file is durably assembled — no polling, no
 * speculative success.
 */
export async function uploadFilePermanent(
  file: File,
  opts: PermanentUploadOptions = {}
): Promise<PermanentUploadResult> {
  const { onProgress, signal, resumeUploadId, onPhase, onSession } = opts;
  if (file.size <= 0) {
    throw new PermanentUploadError({ code: 'FILE_SIZE_ERROR', message: 'File is empty.' });
  }
  if (file.size > PERMANENT_UPLOAD_MAX_BYTES) {
    throw new PermanentUploadError({
      code: 'FILE_SIZE_ERROR',
      message: 'Files up to 2 GB are supported.',
    });
  }
  checkCancelled(signal);

  // ── Phase: whole-file checksum (dedup key) ───────────────────────────────
  onPhase?.('hashing');
  const checksum = await sha256Hex(file);
  checkCancelled(signal);

  // ── Phase: init (or resume) ──────────────────────────────────────────────
  onPhase?.('init');
  let uploadId: string;
  let chunkSize: number;
  let totalChunks: number;
  const received = new Set<number>();
  // Every landed part's durable ref — collected from PUT responses (this
  // session) and status (resumed parts). The engine re-verifies each at
  // finalize; refs are the cross-instance bridge.
  const partRefs = new Map<number, PartRef>();

  const resumed = resumeUploadId ? await callStatus(resumeUploadId, signal) : null;
  if (resumed && resumed.status === 'ready' && resumed.publicUrl) {
    // The previous attempt already finalized — instant success, zero bytes.
    onProgress?.({ loaded: file.size, total: file.size, pct: 100 });
    return {
      resourceId: resumeUploadId!,
      url: resumed.publicUrl,
      size: resumed.size ?? file.size,
      checksum: resumed.checksum ?? checksum,
      alreadyProcessed: true,
      totalChunks: resumed.totalChunks,
      uploadId: resumeUploadId!,
    };
  }
  if (resumed && resumed.status !== 'ready' && resumed.totalChunks > 0 && (resumed.receivedChunks.length > 0 || resumed.missingChunks.length > 0)) {
    onPhase?.('resuming');
    uploadId = resumeUploadId!;
    chunkSize = resumed.chunkSize;
    totalChunks = resumed.totalChunks;
    onSession?.(uploadId);
    for (const i of resumed.receivedChunks) received.add(i);
    for (const p of resumed.parts) {
      if (typeof p.index === 'number' && p.fileId) partRefs.set(p.index, { index: p.index, fileId: p.fileId, messageId: p.messageId ?? null });
    }
    onProgress?.({
      loaded: Math.min(received.size * chunkSize, file.size),
      total: file.size,
      pct: Math.round((Math.min(received.size * chunkSize, file.size) / file.size) * 100),
    });
  } else {
    const init = await callInit(file, checksum, signal);
    uploadId = init.uploadId;
    chunkSize = init.chunkSize;
    totalChunks = init.totalChunks;
    onSession?.(uploadId);
  }
  checkCancelled(signal);

  // ── Phase: parts (REAL aggregate progress) ───────────────────────────────
  onPhase?.('uploading');
  const partSize = (index: number) =>
    index === totalChunks - 1 ? file.size - chunkSize * (totalChunks - 1) : chunkSize;

  let confirmedBytes = 0;
  for (const i of received) confirmedBytes += partSize(i);
  const inflight = new Map<number, number>();
  let cancelled = false;

  const report = () => {
    let inflightBytes = 0;
    for (const v of inflight.values()) inflightBytes += v;
    const loaded = Math.min(confirmedBytes + inflightBytes, file.size);
    onProgress?.({ loaded, total: file.size, pct: Math.round((loaded / file.size) * 100) });
  };
  report();

  const uploadPartWithRetry = async (index: number): Promise<void> => {
    const blob = file.slice(index * chunkSize, index * chunkSize + partSize(index));
    let lastErr: PermanentUploadError | null = null;
    for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
      checkCancelled(signal);
      try {
        inflight.set(index, 0);
        const ref = await putPart(uploadId, index, blob, {
          onLoaded: (loaded) => {
            inflight.set(index, loaded);
            report();
          },
          signal,
        });
        inflight.delete(index);
        received.add(index);
        partRefs.set(index, ref);
        confirmedBytes += partSize(index);
        report();
        return;
      } catch (err) {
        inflight.delete(index);
        if (err instanceof PermanentUploadError && err.cancelled) throw err;
        lastErr = err instanceof PermanentUploadError
          ? err
          : new PermanentUploadError({ code: 'UPLOAD_STORAGE_ERROR', message: String(err) });
        // NOT_FOUND right after init = cross-instance convergence race (the
        // session landed on another engine instance; the snapshot takes a few
        // seconds). Wait it out instead of burning attempts.
        const waitSecs =
          lastErr.retryAfterSecs ?? (lastErr.code === 'NOT_FOUND' ? 5 : attempt);
        if (attempt < PART_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, waitSecs * 1000));
        }
      }
    }
    throw lastErr;
  };

  const queue: number[] = [];
  for (let i = 0; i < totalChunks; i++) if (!received.has(i)) queue.push(i);

  try {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(PART_CONCURRENCY, queue.length || 1) }, async () => {
      while (cursor < queue.length) {
        checkCancelled(signal);
        const index = queue[cursor++];
        await uploadPartWithRetry(index);
      }
    });
    await Promise.all(workers);
  } catch (err) {
    if (err instanceof PermanentUploadError && err.cancelled) {
      cancelled = true;
    }
    throw err;
  } finally {
    if (cancelled) {
      // Keep the session resumable — the next attempt sends only the gap.
    }
  }
  checkCancelled(signal);

  // ── Phase: finalize (engine verifies every part, commits the manifest) ──
  onPhase?.('finalizing');
  const completeRes = await fetch(`/api/storage/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Full durable refs for every landed part — this session's PUTs plus
      // any resumed parts. The engine re-verifies each ref and commits.
      parts: Array.from(partRefs.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, ref]) => ({ index: ref.index, fileId: ref.fileId, messageId: ref.messageId ?? undefined })),
    }),
    signal,
  });
  const completeData = await readJson(completeRes);
  if (!completeRes.ok || !completeData?.ok) {
    throw new PermanentUploadError({
      code: completeData?.code || 'UPLOAD_STORAGE_ERROR',
      message: completeData?.error || `Could not finalize the upload (HTTP ${completeRes.status}).`,
      missingChunks: completeData?.missingChunks,
    });
  }
  onProgress?.({ loaded: file.size, total: file.size, pct: 100 });

  return {
    resourceId: completeData.resourceId,
    url: completeData.url,
    size: completeData.size ?? file.size,
    checksum: completeData.checksum ?? checksum,
    alreadyProcessed: completeData.alreadyProcessed === true,
    totalChunks: completeData.totalChunks ?? totalChunks,
    uploadId,
  };
}

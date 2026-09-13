'use client';

/**
 * Client-side large-file toolkit (defeats the ~4.5MB Vercel request cap).
 *
 * - Files ≤ DIRECT_UPLOAD_LIMIT go through the normal single-request path.
 * - Larger files are sliced into 2.5MB pieces, POSTed to /api/uploads/chunk
 *   (SEQUENTIALLY — the backend sprays parallel writes across per-instance
 *   memory where later reads can't find them; restore concurrency only
 *   after OnyxBase gets shared storage), then the consumer is called
 *   with { uploadId }.
 * - probeVideoLocal() reads duration/dimensions instantly in-browser with
 *   zero upload — so studio ingest never hard-fails on big files.
 */

/** Single-request ceiling with safety margin under the ~4.5MB platform cap. */
export const DIRECT_UPLOAD_LIMIT = Math.floor(3.5 * 1024 * 1024);

/** Raw slice size (2.5MB → ~3.4MB base64 JSON, safely under the cap). */
export const CHUNK_SIZE = Math.floor(2.5 * 1024 * 1024);

// Sequential (1) until OnyxBase has shared storage — parallel chunk POSTs
// get sprayed across per-instance memory and assembly can't find them.
const CHUNK_CONCURRENCY = 1;

export function makeUploadId(): string {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `u${Date.now().toString(36)}${rand}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file slice'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Probe duration + dimensions locally in the browser (no upload, instant).
 * Resolves { duration, width, height }; rejects when the browser cannot
 * decode the file (caller falls back to server analysis).
 */
export function probeVideoLocal(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Local probe timed out'));
    }, 15000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      cleanup();
      if (!duration && !width) {
        reject(new Error('Could not read video metadata'));
      } else {
        resolve({ duration, width, height });
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Unsupported video for local probe'));
    };
    video.src = url;
  });
}

export interface ChunkedProgress {
  sentBytes: number;
  totalBytes: number;
  pct: number;
  chunk: number;
  totalChunks: number;
}

/**
 * Upload a file in small chunks. Resolves { uploadId } once every chunk
 * is stored server-side; the caller then invokes the consumer endpoint
 * (analyze / speedramp / upload-complete) with that id.
 */
export async function uploadInChunks(
  file: File,
  opts: { onProgress?: (p: ChunkedProgress) => void; signal?: AbortSignal } = {}
): Promise<{ uploadId: string }> {
  const uploadId = makeUploadId();
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  let sentBytes = 0;
  let doneChunks = 0;

  const report = () => {
    opts.onProgress?.({
      sentBytes,
      totalBytes: file.size,
      pct: file.size > 0 ? Math.min(99, Math.round((sentBytes / file.size) * 100)) : 0,
      chunk: doneChunks,
      totalChunks: total,
    });
  };

  const sendChunk = async (index: number): Promise<void> => {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const start = index * CHUNK_SIZE;
    const slice = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
    const chunkB64 = await blobToBase64(slice);
    const res = await fetch('/api/uploads/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        uploadId,
        index,
        total,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        chunk: chunkB64,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Chunk ${index + 1}/${total} failed (HTTP ${res.status})`);
    }
    sentBytes += slice.size;
    doneChunks += 1;
    report();
  };

  // Bounded-concurrency worker pool over chunk indices.
  const indices = Array.from({ length: total }, (_, i) => i);
  const workers = Array.from(
    { length: Math.min(CHUNK_CONCURRENCY, total) },
    async () => {
      while (indices.length > 0) {
        if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const next = indices.shift();
        if (next === undefined) return;
        // Per-chunk retry (3 attempts) for transient failures.
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await sendChunk(next);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (opts.signal?.aborted) throw err;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
        if (lastErr) throw lastErr;
      }
    }
  );
  await Promise.all(workers);

  opts.onProgress?.({
    sentBytes: file.size,
    totalBytes: file.size,
    pct: 100,
    chunk: total,
    totalChunks: total,
  });
  return { uploadId };
}

/**
 * Unified resource-file pipeline (server-side).
 *
 * PRD "instant image persistence": the image path is MIRROR-FIRST. The
 * external image hosts ARE the permanent store for images (imghosting.in
 * primary, catbox/telegraph fallbacks — ~3-10s total); the moment one
 * returns a URL the upload is DONE. There is no second durable-copy leg
 * on the critical path — no OnyxBase blob round-trip, no KV byte store.
 * Only when EVERY mirror fails do we fall back to V5 blob storage
 * (instant, authoritative SQLite + Telegram backup) so an image never
 * fails outright.
 *
 * Clips/xmls (legacy callers + thumbnail legs): OnyxBase blob first,
 * mirror second. NOTE: normal clip/xml uploads from the browser now use
 * the resumable V5 parts client (/api/storage/*) and never touch this
 * path; this remains for covers, server-side callers, and V5-off rollbacks.
 */

import { uploadFileResult, getFileUrl, ONYXBASE_V5_ENABLED, type UploadTimings } from './onyxbase';
import { mirrorAsset } from './mirror';

export interface PipelineResult {
  ok: boolean;
  fileId?: string;
  /** Best remote URL (mirror preferred, else OnyxBase direct). */
  url?: string;
  /** OnyxBase direct URL (always set on success). */
  storageUrl?: string;
  mirrorUrl?: string;
  mirrorHost?: string;
  /** True when original bytes were durably stored (legacy image path only). */
  bytesStored?: boolean;
  bytesShards?: number;
  fileName?: string;
  mimeType?: string;
  size?: number;
  timings?: UploadTimings;
  code?: 'UPLOAD_STORAGE_ERROR' | 'UPLOAD_THROTTLED';
  error?: string;
  retryAfter?: number;
}

/** Storage-side fallback for images when every external mirror failed. */
async function mirrorFallbackBlob(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  label?: string
): Promise<PipelineResult> {
  // V5 blob (instant SQLite commit + async Telegram backup).
  if (ONYXBASE_V5_ENABLED) {
    const { v5UploadBlob } = await import('./onyxbase');
    const v5 = await v5UploadBlob(
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      fileName,
      mimeType
    );
    if (v5.ok) {
      return {
        ok: true,
        fileId: v5.file.fileId,
        url: v5.file.url,
        storageUrl: v5.file.url,
        mirrorHost: 'onyxbase-v5',
        fileName,
        mimeType,
        size: bytes.length,
        timings: v5.timings,
      };
    }
    console.warn('[file-pipeline] V5 blob fallback failed:', v5.error);
  }
  // V4 OnyxBase object store (last resort).
  const uploaded = await uploadFileResult(
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    fileName,
    mimeType,
    label
  );
  if (!uploaded.ok) {
    return {
      ok: false,
      code: uploaded.code,
      error: uploaded.error,
      retryAfter: uploaded.retryAfterSecs,
      timings: uploaded.timings,
    };
  }
  const storageUrl = uploaded.file.url || getFileUrl(uploaded.file.fileId);
  return {
    ok: true,
    fileId: uploaded.file.fileId,
    url: storageUrl,
    storageUrl,
    fileName: uploaded.file.fileName || fileName,
    mimeType: uploaded.file.mimeType || mimeType,
    size: uploaded.file.size ?? bytes.length,
    timings: uploaded.timings,
  };
}

export async function storeResourceFile(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  opts: { kind?: 'image' | 'clip' | 'xml'; label?: string } = {}
): Promise<PipelineResult> {
  const kind = opts.kind;
  const t0 = Date.now();

  // ─── IMAGE: mirror-first (the ONLY significant, legitimate delay) ─────────
  // imghosting (~1-3s) → catbox → telegraph. No timeboxes: each host carries
  // its own fetch timeout inside mirror.ts. The instant a URL comes back the
  // image is permanently stored and the caller may report success.
  if (kind === 'image') {
    const mirror = await mirrorAsset(bytes, fileName, mimeType, 'image');
    if (mirror.ok && mirror.url) {
      return {
        ok: true,
        // Stable, dedupeable id derived from the mirror URL (records created
        // with this fileId reference an external permanent host).
        fileId: `ext:mirror:${mirror.host}`,
        url: mirror.url,
        storageUrl: mirror.url,
        mirrorUrl: mirror.url,
        mirrorHost: mirror.host,
        fileName,
        mimeType,
        size: bytes.length,
        timings: {
          upload_init_ms: 0,
          transfer_ms: 0,
          storage_finalize_ms: Date.now() - t0,
          total_upload_ms: Date.now() - t0,
          attempts: 1,
        },
      };
    }
    console.warn('[file-pipeline] all image mirrors failed — falling back to blob storage');
    return mirrorFallbackBlob(bytes, fileName, mimeType, opts.label);
  }

  // ─── CLIP / XML (legacy path; primary clip/xml traffic now uses the V5
  // parts client): OnyxBase object store first, mirror second ──────────────
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const uploaded = await uploadFileResult(blob, fileName, mimeType, opts.label);
  if (!uploaded.ok) {
    return {
      ok: false,
      code: uploaded.code,
      error: uploaded.error,
      retryAfter: uploaded.retryAfterSecs,
      timings: uploaded.timings,
    };
  }

  const fileId = uploaded.file.fileId;
  const storageUrl = uploaded.file.url || getFileUrl(fileId);

  // External mirror (best-effort, short timeouts inside).
  let mirrorUrl: string | undefined;
  let mirrorHost: string | undefined;
  if (kind === 'clip') {
    try {
      const mirror = await Promise.race([
        mirrorAsset(bytes, fileName, mimeType, kind),
        new Promise<null>((r) => setTimeout(() => r(null), 15000)),
      ]);
      if (mirror && mirror.ok && mirror.url) {
        mirrorUrl = mirror.url;
        mirrorHost = mirror.host;
      }
    } catch (err) {
      console.warn('[file-pipeline] mirror failed (non-fatal):', err);
    }
  }

  return {
    ok: true,
    fileId,
    url: mirrorUrl || storageUrl,
    storageUrl,
    mirrorUrl,
    mirrorHost,
    fileName: uploaded.file.fileName || fileName,
    mimeType: uploaded.file.mimeType || mimeType,
    size: uploaded.file.size ?? bytes.length,
    timings: uploaded.timings,
  };
}

/**
 * Unified resource-file pipeline (server-side).
 *
 * Single entry point used by both:
 * - POST /api/resources/upload        (direct multipart, ≤4.5MB on Vercel)
 * - POST /api/resources/upload-complete (chunked assembly, any size)
 *
 * Steps:
 *  1. Upload bytes to OnyxBase file storage (primary object store).
 *  2. For images ≤10MB: ALSO persist original bytes losslessly in the
 *     durable KV byte store → served permanently from OUR domain
 *     (/api/img/[resourceId]). Zero quality loss — bit-for-bit original.
 *  3. Best-effort external mirror (images: imghosting.in primary,
 *     catbox/telegraph fallback) as an extra fallback.
 *
 * Canonical URL priority for images: KV bytes (/api/img/…) > mirror > OnyxBase.
 * For clips/xml: mirror > OnyxBase (bytes store is image-sized only).
 */

import { uploadFileResult, getFileUrl, type UploadTimings } from './onyxbase';
import { storeImageBytes, MAX_IMAGE_BYTES } from './image-bytes';
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
  /** True when original bytes were durably stored (images only). */
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

export async function storeResourceFile(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  opts: { kind?: 'image' | 'clip' | 'xml'; label?: string } = {}
): Promise<PipelineResult> {
  const kind = opts.kind;
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });

  // Step 1 — object store (required).
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

  // Step 2 — durable lossless byte store for images (best-effort).
  // TIME-BOXED: a drowning backend must never stall the upload — the file
  // URL + mirror already carry the image.
  let bytesStored = false;
  let bytesShards = 0;
  if (kind === 'image' && bytes.length <= MAX_IMAGE_BYTES && bytes.length > 0) {
    try {
      const stored = await Promise.race([
        storeImageBytes(fileId, bytes, mimeType),
        new Promise<null>((r) => setTimeout(() => r(null), 20000)),
      ]);
      if (stored && stored.ok) {
        bytesStored = true;
        bytesShards = stored.shards;
      } else {
        console.warn('[file-pipeline] byte store skipped:', stored ? stored.error : 'timeout');
      }
    } catch (err) {
      console.warn('[file-pipeline] byte store failed (non-fatal):', err);
    }
  }

  // Step 3 — external mirror (best-effort, short timeouts inside).
  let mirrorUrl: string | undefined;
  let mirrorHost: string | undefined;
  if (kind === 'image' || kind === 'clip') {
    try {
      // TIME-BOXED: three sequential external hosts must never stall us.
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
    bytesStored,
    bytesShards,
    fileName: uploaded.file.fileName || fileName,
    mimeType: uploaded.file.mimeType || mimeType,
    size: uploaded.file.size ?? bytes.length,
    timings: uploaded.timings,
  };
}

/**
 * POST /api/resources/upload
 * Phase 1 of the two-phase upload pipeline (PRD §9): raw file → storage.
 *
 * - Validates type + size BEFORE any network work (PRD §38, §39).
 * - Returns structured error codes (PRD §47) and per-stage timings (PRD §3).
 * - On storage throttling answers 429 + retryAfter instead of hanging ~60s.
 *
 * Auth required.
 * Form fields:
 *   - file (required): File | Blob
 *   - thumbnail (optional): File | Blob
 *   - label (optional): string
 *   - kind (optional): 'image' | 'clip' | 'xml' — enables strict type validation
 *
 * Returns:
 *   { ok: true, fileId, url, fileName, mimeType, size, thumbnailFileId?, thumbnailUrl?, timings }
 *   { ok: false, code, error, retryAfter?, timings? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { uploadFileResult, getFileUrl, MAX_SIMPLE_UPLOAD_BYTES } from '@/lib/onyxbase';
import type { UploadErrorCode } from '@/lib/upload-errors';

// Allow long uploads on Vercel (Pro: up to 300s; Hobby caps at 60s).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'bmp', 'ico', 'tiff', 'tif'];
const CLIP_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'ogv'];
const XML_EXTS = ['xml'];

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function validateKind(
  kind: string | null,
  fileName: string,
  mimeType: string
): { ok: true } | { ok: false; error: string } {
  if (!kind) return { ok: true };
  const ext = extOf(fileName);
  const mime = (mimeType || '').toLowerCase();
  if (kind === 'image') {
    if (mime.startsWith('image/') || IMAGE_EXTS.includes(ext)) return { ok: true };
    return { ok: false, error: `Expected an image file, got "${fileName || mimeType || 'unknown'}"` };
  }
  if (kind === 'clip') {
    if (mime.startsWith('video/') || CLIP_EXTS.includes(ext)) return { ok: true };
    return { ok: false, error: `Expected a video file, got "${fileName || mimeType || 'unknown'}"` };
  }
  if (kind === 'xml') {
    if (mime.includes('xml') || mime === 'text/plain' || XML_EXTS.includes(ext)) {
      return { ok: true };
    }
    return { ok: false, error: `Expected an XML file, got "${fileName || mimeType || 'unknown'}"` };
  }
  return { ok: true };
}

function fail(
  code: UploadErrorCode,
  error: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ ok: false, code, error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return fail('AUTH_ERROR', 'Authentication required', 401);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const thumbnail = formData.get('thumbnail');
    const label = formData.get('label');
    const kind = formData.get('kind');

    if (!file || (!(file instanceof File) && !(file instanceof Blob))) {
      return fail('UPLOAD_STORAGE_ERROR', 'Missing or invalid "file" field', 400);
    }

    const fileName = file instanceof File ? file.name : `upload-${Date.now()}`;
    const mimeType =
      file instanceof File && file.type ? file.type : 'application/octet-stream';
    const labelStr = typeof label === 'string' ? label : undefined;
    const kindStr = typeof kind === 'string' ? kind : null;

    // Validate type BEFORE uploading (PRD §38)
    const kindCheck = validateKind(kindStr, fileName, mimeType);
    if (!kindCheck.ok) {
      return fail('FILE_TYPE_ERROR', kindCheck.error, 400);
    }

    // Validate size against the real infrastructure maximum (PRD §39)
    const size = typeof file.size === 'number' ? file.size : 0;
    if (size > MAX_SIMPLE_UPLOAD_BYTES) {
      return fail(
        'FILE_SIZE_ERROR',
        `File is ${(size / 1024 / 1024).toFixed(1)} MB — the current storage limit is ${Math.round(
          MAX_SIMPLE_UPLOAD_BYTES / 1024 / 1024
        )} MB per file.`,
        413
      );
    }
    if (size === 0) {
      return fail('UPLOAD_STORAGE_ERROR', 'File is empty (0 bytes)', 400);
    }

    const uploaded = await uploadFileResult(file, fileName, mimeType, labelStr);

    if (!uploaded.ok) {
      if (uploaded.code === 'UPLOAD_THROTTLED') {
        return fail('UPLOAD_THROTTLED', 'Storage is busy (rate limited). Please retry shortly.', 429, {
          retryAfter: uploaded.retryAfterSecs ?? 10,
          timings: uploaded.timings,
        });
      }
      return fail('UPLOAD_STORAGE_ERROR', 'Failed to upload file to storage', 500, {
        detail: uploaded.error,
        timings: uploaded.timings,
      });
    }

    const response: Record<string, unknown> = {
      ok: true,
      fileId: uploaded.file.fileId,
      url: uploaded.file.url || getFileUrl(uploaded.file.fileId),
      fileName: uploaded.file.fileName || fileName,
      mimeType: uploaded.file.mimeType || mimeType,
      size: uploaded.file.size ?? size,
      timings: uploaded.timings,
    };

    // Optional thumbnail upload (best-effort; must not fail the main upload)
    if (thumbnail && (thumbnail instanceof File || thumbnail instanceof Blob)) {
      try {
        const thumbName =
          thumbnail instanceof File ? thumbnail.name : `thumbnail-${Date.now()}`;
        const thumbMime =
          thumbnail instanceof File && thumbnail.type ? thumbnail.type : 'image/jpeg';
        const thumbUploaded = await uploadFileResult(
          thumbnail,
          thumbName,
          thumbMime,
          `${labelStr || fileName}-thumb`
        );
        if (thumbUploaded.ok && thumbUploaded.file.fileId) {
          response.thumbnailFileId = thumbUploaded.file.fileId;
          response.thumbnailUrl =
            thumbUploaded.file.url || getFileUrl(thumbUploaded.file.fileId);
        }
      } catch (e) {
        console.warn('[resources/upload] thumbnail upload failed (non-fatal):', e);
      }
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('[resources/upload] error:', err);
    return fail('UPLOAD_STORAGE_ERROR', 'Upload failed', 500);
  }
}

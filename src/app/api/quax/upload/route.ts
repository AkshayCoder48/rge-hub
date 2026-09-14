/**
 * POST /api/quax/upload
 * Small-file leg of the qu.ax relay (qu.ax has no CORS, so the hub relays).
 *
 * Body: FormData { file, kind?, label? } — file must fit one request (≤4MB).
 * Larger files go chunked via /api/uploads/chunk + /api/quax/complete.
 *
 * Stores the file on qu.ax PERMANENTLY (expiry=-1, expires:null) and returns
 * URL-only references (nothing but URLs ever touches OnyxBase):
 *   { ok, fileId: "ext:quax:{name}", url, storageUrl, mirrorHost: "quax",
 *     fileName, mimeType, size }
 *
 * Auth required. qu.ax limits: 256MB + extension allowlist (mp4/mov/webm…,
 * zip/pdf/txt…, images). Ineligible files are rejected with a clear error —
 * the client then falls back to getshared automatically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { storeQuax, QUAX_MAX_BYTES } from '@/lib/quax';
import type { UploadErrorCode } from '@/lib/upload-errors';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Single-request ceiling (Vercel caps us at ~4.5MB). */
const MAX_SINGLE_BYTES = 4 * 1024 * 1024;

function fail(code: UploadErrorCode, error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, code, error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return fail('AUTH_ERROR', 'Authentication required', 401);
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return fail('UPLOAD_STORAGE_ERROR', 'No file provided', 400);
    }
    if (file.size === 0) {
      return fail('UPLOAD_STORAGE_ERROR', 'File is empty (0 bytes)', 400);
    }
    if (file.size > MAX_SINGLE_BYTES) {
      return fail(
        'FILE_SIZE_ERROR',
        'File is too large for single-request relay — use the chunked path.',
        413
      );
    }
    if (file.size > QUAX_MAX_BYTES) {
      return fail('FILE_SIZE_ERROR', 'File exceeds the 256MB qu.ax limit.', 413);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await storeQuax(bytes, file.name || 'file', file.type || 'application/octet-stream');
    if (!stored.ok) {
      return fail('UPLOAD_STORAGE_ERROR', stored.error || 'qu.ax upload failed', 502);
    }

    return NextResponse.json({
      ok: true,
      fileId: `ext:quax:${stored.name}`,
      url: stored.directUrl,
      storageUrl: stored.viewerUrl,
      mirrorHost: 'quax',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    });
  } catch (err) {
    console.error('[quax/upload] error:', err);
    return fail('UPLOAD_STORAGE_ERROR', 'qu.ax relay failed', 500);
  }
}

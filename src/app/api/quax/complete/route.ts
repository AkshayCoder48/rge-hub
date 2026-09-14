/**
 * POST /api/quax/complete
 * Large-file leg of the qu.ax relay: assembles previously staged chunks
 * (POSTed to /api/uploads/chunk) and stores the bytes on qu.ax PERMANENTLY.
 *
 * Body (JSON): { uploadId, fileName?, mimeType? }
 * Returns: same shape as /api/quax/upload (URL-only references).
 *
 * Auth required. qu.ax limits: 256MB + extension allowlist — violations are
 * rejected with a clear error and the client falls back to getshared.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { assembleChunks } from '@/lib/chunks';
import { storeQuax, QUAX_MAX_BYTES } from '@/lib/quax';
import type { UploadErrorCode } from '@/lib/upload-errors';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function fail(code: UploadErrorCode, error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, code, error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return fail('AUTH_ERROR', 'Authentication required', 401);
    }

    const body = await request.json().catch(() => null);
    const { uploadId, fileName, mimeType } = body || {};
    if (!uploadId) {
      return fail('UPLOAD_STORAGE_ERROR', 'uploadId is required', 400);
    }

    const assembled = await assembleChunks(uploadId);
    if (!assembled.ok) {
      return fail('UPLOAD_STORAGE_ERROR', assembled.error, 400);
    }
    if (assembled.bytes.length === 0) {
      return fail('UPLOAD_STORAGE_ERROR', 'Assembled file is empty (0 bytes)', 400);
    }
    if (assembled.bytes.length > QUAX_MAX_BYTES) {
      return fail(
        'FILE_SIZE_ERROR',
        `File is ${(assembled.bytes.length / 1024 / 1024).toFixed(0)}MB — qu.ax limit is 256MB.`,
        413
      );
    }

    const name = typeof fileName === 'string' && fileName ? fileName : assembled.fileName;
    const mime = typeof mimeType === 'string' && mimeType ? mimeType : assembled.mimeType;
    const stored = await storeQuax(assembled.bytes, name, mime || 'application/octet-stream');
    if (!stored.ok) {
      return fail('UPLOAD_STORAGE_ERROR', stored.error || 'qu.ax upload failed', 502);
    }

    return NextResponse.json({
      ok: true,
      fileId: `ext:quax:${stored.name}`,
      url: stored.directUrl,
      storageUrl: stored.viewerUrl,
      mirrorHost: 'quax',
      fileName: name,
      mimeType: mime,
      size: assembled.bytes.length,
    });
  } catch (err) {
    console.error('[quax/complete] error:', err);
    return fail('UPLOAD_STORAGE_ERROR', 'qu.ax completion failed', 500);
  }
}

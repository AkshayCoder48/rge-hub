/**
 * POST /api/storage/uploads/init — start a resumable permanent-storage session.
 *
 * Body: { filename, size, mimeType, checksum? }
 *   checksum: client-computed sha256 hex of the WHOLE file (≤64MB files) —
 *   enables instant dedup (a byte-identical re-upload completes in one call).
 *
 * Returns: { ok: true, uploadId, chunkSize, totalChunks }
 *
 * The chunking parameters belong to the storage engine (4 MiB transport parts
 * that fit every proxy in the chain) — the USER never sees them: the browser
 * client slices, uploads with real byte progress, and can resume an
 * interrupted session by asking /status which parts already landed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { storageInit, v5StorageAvailable, V5StorageError } from '@/lib/v5-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json(
        { ok: false, code: 'AUTH_ERROR', error: 'Authentication required' },
        { status: 401 }
      );
    }
    if (!v5StorageAvailable()) {
      return NextResponse.json(
        {
          ok: false,
          code: 'V5_STORAGE_DISABLED',
          error: 'Permanent resumable storage is not configured on this deployment.',
        },
        { status: 503 }
      );
    }
    const body = (await request.json().catch(() => null)) as {
      filename?: string;
      size?: number;
      mimeType?: string;
      checksum?: string;
    } | null;
    if (!body || typeof body.filename !== 'string' || !body.filename.trim()) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'filename is required' }, { status: 400 });
    }
    if (typeof body.size !== 'number' || !Number.isFinite(body.size) || body.size <= 0) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'size (bytes) is required' }, { status: 400 });
    }
    const session = await storageInit({
      filename: body.filename.slice(0, 255),
      size: Math.floor(body.size),
      mimeType: (body.mimeType || 'application/octet-stream').slice(0, 127),
      checksum: typeof body.checksum === 'string' ? body.checksum.slice(0, 128) : undefined,
    });
    return NextResponse.json({
      ok: true,
      uploadId: session.uploadId,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
    });
  } catch (err) {
    if (err instanceof V5StorageError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, missingChunks: err.missingChunks },
        { status: err.status, headers: err.retryAfterSecs ? { 'Retry-After': String(err.retryAfterSecs) } : undefined }
      );
    }
    console.error('[storage/init] error:', err);
    return NextResponse.json({ ok: false, code: 'UPLOAD_STORAGE_ERROR', error: 'Could not start the upload session.' }, { status: 500 });
  }
}

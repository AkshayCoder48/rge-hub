/**
 * PUT /api/storage/uploads/:id/parts/:index — upload ONE raw part.
 *
 * The request body is exactly `chunkSize` bytes (the final part carries the
 * remainder) — the size returned by /init. Streaming-friendly: the body is
 * forwarded to the storage engine without buffering the whole file.
 *
 * Idempotent per index: re-sending a landed part is acknowledged, not stored
 * twice. Throttles surface as 429 + Retry-After.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { storagePutPart, V5StorageError } from '@/lib/v5-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; index: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, code: 'AUTH_ERROR', error: 'Authentication required' }, { status: 401 });
    }
    const { id, index } = await ctx.params;
    const idx = Number.parseInt(index, 10);
    if (!id || !Number.isInteger(idx) || idx < 0 || idx > 511) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Invalid part reference' }, { status: 400 });
    }
    if (!request.body) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing request body' }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Empty part body' }, { status: 400 });
    }
    const part = await storagePutPart(id, idx, buf, 'application/octet-stream');
    return NextResponse.json({
      ok: true,
      index: part.index,
      // Engine part references — required by /complete (the engine re-verifies
      // every one against its durable store; forged refs fail there).
      fileId: part.fileId,
      messageId: part.messageId ?? undefined,
      bytes: part.bytes,
      checksum: part.checksum,
      alreadyStored: part.alreadyStored === true,
    });
  } catch (err) {
    if (err instanceof V5StorageError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, missingChunks: err.missingChunks },
        { status: err.status, headers: err.retryAfterSecs ? { 'Retry-After': String(err.retryAfterSecs) } : undefined }
      );
    }
    console.error('[storage/parts] error:', err);
    return NextResponse.json({ ok: false, code: 'UPLOAD_STORAGE_ERROR', error: 'Part upload failed.' }, { status: 500 });
  }
}

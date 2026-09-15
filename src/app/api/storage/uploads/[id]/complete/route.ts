/**
 * POST /api/storage/uploads/:id/complete — finalize into ONE permanent file.
 *
 * Body: { parts: [{ index, fileId, messageId? }] } — the refs the browser
 * collected from part uploads (freshest set). The engine verifies every ref
 * against its durable store, commits the manifest, and answers:
 *
 *   { ok: true, resourceId, status: 'ready', url: 'https://…/f/<blobId>',
 *     alreadyProcessed?, dedupOf? }
 *
 * `url` is the PERMANENT file URL (Range-aware, HEAD-capable, video-seekable,
 * CORS-enabled). `alreadyProcessed: true` means a byte-identical file
 * already existed (owner + checksum dedup) — the staged duplicate is cleaned
 * up engine-side and the EXISTING url is returned.
 *
 * Idempotent: completing an already-ready blob re-answers ready.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { storageComplete, V5StorageError } from '@/lib/v5-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, code: 'AUTH_ERROR', error: 'Authentication required' }, { status: 401 });
    }
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing upload id' }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as {
      parts?: Array<{ index?: number; fileId?: string; messageId?: number | null }>;
    } | null;
    if (!body || !Array.isArray(body.parts) || body.parts.length === 0) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'parts array is required' },
        { status: 400 }
      );
    }
    // Normalize + hard-validate refs (the engine re-verifies every one).
    const parts = body.parts
      .filter((p) => p && typeof p.index === 'number' && typeof p.fileId === 'string' && p.fileId)
      .map((p) => ({ index: p.index as number, fileId: p.fileId as string, messageId: p.messageId ?? undefined }));
    if (parts.length !== body.parts.length) {
      return NextResponse.json(
        { ok: false, code: 'VALIDATION_ERROR', error: 'Every part needs { index, fileId }.' },
        { status: 400 }
      );
    }
    // Stateless-session context (init geometry, optional) — lets the engine
    // finalize on any instance without waiting for snapshot convergence.
    const c = (body as { context?: { size?: unknown; chunkSize?: unknown; totalChunks?: unknown; checksum?: unknown; filename?: unknown; mimeType?: unknown } }).context;
    const sess =
      c && typeof c.size === 'number' && typeof c.chunkSize === 'number' && typeof c.totalChunks === 'number'
        ? {
            size: c.size,
            chunkSize: c.chunkSize,
            totalChunks: c.totalChunks,
            checksum: typeof c.checksum === 'string' ? c.checksum : null,
            filename: typeof c.filename === 'string' ? c.filename : null,
            mimeType: typeof c.mimeType === 'string' ? c.mimeType : null,
          }
        : null;
    const done = await storageComplete(id, parts, sess);
    return NextResponse.json({
      ok: true,
      resourceId: done.blobId,
      status: done.status,
      url: done.url,
      size: done.size,
      checksum: done.checksum,
      totalChunks: done.totalChunks,
      alreadyProcessed: done.alreadyProcessed === true,
      dedupOf: done.dedupOf,
    });
  } catch (err) {
    if (err instanceof V5StorageError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, missingChunks: err.missingChunks },
        { status: err.status }
      );
    }
    console.error('[storage/complete] error:', err);
    return NextResponse.json({ ok: false, code: 'UPLOAD_STORAGE_ERROR', error: 'Could not finalize the upload.' }, { status: 500 });
  }
}

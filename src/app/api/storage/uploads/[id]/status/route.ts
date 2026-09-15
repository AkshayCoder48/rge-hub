/**
 * GET /api/storage/uploads/:id/status — which parts already landed?
 *
 * The resumable-upload backbone: an interrupted session (browser refresh,
 * network drop) resumes by uploading ONLY the missing parts — never from
 * zero. Returns { receivedChunks, missingChunks, status, chunkSize, … }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { storageStatus, V5StorageError } from '@/lib/v5-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, code: 'AUTH_ERROR', error: 'Authentication required' }, { status: 401 });
    }
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing upload id' }, { status: 400 });
    }
    const s = await storageStatus(id);
    return NextResponse.json({
      ok: true,
      uploadId: s.uploadId,
      status: s.status,
      size: s.size,
      chunkSize: s.chunkSize,
      totalChunks: s.totalChunks,
      receivedChunks: s.receivedChunks,
      missingChunks: s.missingChunks,
      parts: s.parts,
      // Present when the session already finalized — instant success for resumers.
      publicUrl: s.publicUrl,
      checksum: s.checksum,
    });
  } catch (err) {
    if (err instanceof V5StorageError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, missingChunks: err.missingChunks },
        { status: err.status }
      );
    }
    console.error('[storage/status] error:', err);
    return NextResponse.json({ ok: false, code: 'UPLOAD_STORAGE_ERROR', error: 'Could not read upload status.' }, { status: 500 });
  }
}

/**
 * POST /api/uploads/chunk
 * Receive one chunk of a large file (defeats the ~4.5MB Vercel limit).
 *
 * Each request carries ONE small piece (≤2.5MB raw → ~3.4MB base64 JSON),
 * well under the platform payload cap. Chunks persist in the dedicated
 * `upload_chunks` KV collection; the consumer assembles them server-side
 * in a single follow-up request (no instance-affinity dependency).
 *
 * Auth required.
 * Body (JSON): { uploadId, index, total, fileName, mimeType, size, chunk }
 *   - uploadId: client-generated stable id [A-Za-z0-9_-]{8,64}
 *   - index/total: 0-based chunk position and total chunk count (≤40)
 *   - chunk: base64 of the raw slice
 *
 * Returns: { ok: true, received, total } — call the consumer (analyze /
 * speedramp / upload-complete) with { uploadId } once received === total.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { backendAcceptsWrites } from '@/lib/onyxbase';
import { saveChunk } from '@/lib/chunks';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }

    // Circuit breaker: fail in seconds when the backend is drowning in
    // Telegram 429s — never grind minutes into a timeout.
    if (!(await backendAcceptsWrites())) {
      return NextResponse.json(
        { ok: false, error: 'Servers are busy — please retry in a minute.', retryable: true },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => null);
    const { uploadId, index, total, fileName, mimeType, size, chunk } = body || {};

    if (typeof fileName !== 'string' || !fileName) {
      return NextResponse.json({ ok: false, error: 'fileName is required' }, { status: 400 });
    }

    const result = await saveChunk(
      uploadId,
      index,
      total,
      fileName,
      typeof mimeType === 'string' ? mimeType : 'application/octet-stream',
      typeof size === 'number' ? size : 0,
      chunk
    );

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, received: result.received, total });
  } catch (err) {
    console.error('[uploads/chunk] error:', err);
    return NextResponse.json({ ok: false, error: 'Chunk upload failed' }, { status: 500 });
  }
}

/**
 * POST /api/resources/upload-complete
 * Phase-1 completion for LARGE files (chunked path).
 *
 * Flow: client slices the file → POSTs each piece to /api/uploads/chunk →
 * then calls here with { uploadId }. The server assembles the bytes and
 * runs the SAME unified file pipeline as /api/resources/upload
 * (OnyxBase object store + lossless KV byte store + mirrors).
 *
 * Auth required.
 * Body (JSON): { uploadId, fileName?, mimeType?, label?, kind? }
 *   (fileName/mimeType fall back to the chunk manifest when omitted)
 *
 * Returns: same shape as /api/resources/upload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { backendAcceptsWrites } from '@/lib/onyxbase';
import { assembleChunks } from '@/lib/chunks';
import { storeResourceFile } from '@/lib/file-pipeline';
import { MAX_SIMPLE_UPLOAD_BYTES } from '@/lib/onyxbase';
import { validateKind, fail } from '../upload/route';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return fail('AUTH_ERROR', 'Authentication required', 401);
    }

    // Circuit breaker: fail in seconds when the backend is drowning in
    // Telegram 429s — never grind a minute into a 504.
    if (!(await backendAcceptsWrites())) {
      return fail('UPLOAD_THROTTLED', 'Servers are busy — please retry in a minute.', 503);
    }

    const body = await request.json().catch(() => null);
    const { uploadId, fileName, mimeType, label, kind } = body || {};
    if (!uploadId) {
      return fail('UPLOAD_STORAGE_ERROR', 'uploadId is required', 400);
    }

    const assembled = await assembleChunks(uploadId);
    if (!assembled.ok) {
      return fail('UPLOAD_STORAGE_ERROR', assembled.error, 400);
    }

    const name = typeof fileName === 'string' && fileName ? fileName : assembled.fileName;
    const mime =
      typeof mimeType === 'string' && mimeType ? mimeType : assembled.mimeType;
    const kindStr = kind === 'image' || kind === 'clip' || kind === 'xml' ? kind : undefined;

    const kindCheck = validateKind(kindStr ?? null, name, mime);
    if (!kindCheck.ok) {
      return fail('FILE_TYPE_ERROR', kindCheck.error, 400);
    }
    if (assembled.bytes.length === 0) {
      return fail('UPLOAD_STORAGE_ERROR', 'Assembled file is empty (0 bytes)', 400);
    }
    if (assembled.bytes.length > MAX_SIMPLE_UPLOAD_BYTES) {
      return fail(
        'FILE_SIZE_ERROR',
        `File is ${(assembled.bytes.length / 1024 / 1024).toFixed(1)} MB — the current storage limit is ${Math.round(
          MAX_SIMPLE_UPLOAD_BYTES / 1024 / 1024
        )} MB per file.`,
        413
      );
    }

    // ROUTE BUDGET: same 48s race as /api/resources/upload — a drowning
    // backend yields a retryable 503, never a 60s 504.
    const stored = await Promise.race([
      storeResourceFile(assembled.bytes, name, mime, {
        kind: kindStr,
        label: typeof label === 'string' ? label : undefined,
      }),
      new Promise<null>((r) => setTimeout(() => r(null), 48000)),
    ]);
    if (!stored) {
      return fail('UPLOAD_THROTTLED', 'Storage is busy — please retry shortly.', 503, {
        retryAfter: 25,
      });
    }

    if (!stored.ok) {
      if (stored.code === 'UPLOAD_THROTTLED') {
        return fail('UPLOAD_THROTTLED', 'Storage is busy (rate limited). Please retry shortly.', 429, {
          retryAfter: stored.retryAfter ?? 10,
          timings: stored.timings,
        });
      }
      return fail('UPLOAD_STORAGE_ERROR', 'Failed to upload file to storage', 500, {
        detail: stored.error,
        timings: stored.timings,
      });
    }

    return NextResponse.json({
      ok: true,
      fileId: stored.fileId,
      url: stored.url,
      storageUrl: stored.storageUrl,
      mirrorUrl: stored.mirrorUrl,
      mirrorHost: stored.mirrorHost,
      bytesStored: stored.bytesStored,
      bytesShards: stored.bytesShards,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      size: stored.size,
      timings: stored.timings,
    });
  } catch (err) {
    console.error('[resources/upload-complete] error:', err);
    return fail('UPLOAD_STORAGE_ERROR', 'Upload completion failed', 500);
  }
}

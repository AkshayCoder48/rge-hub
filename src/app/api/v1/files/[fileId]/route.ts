/**
 * GET /api/v1/files/[fileId] — file metadata + stable download URL (public).
 *
 * Returns the on-domain URL (GET follows a 302 to the backing storage —
 * the permanent address even if the storage host changes) plus stored
 * metadata when available.
 */
import { NextRequest } from 'next/server';
import { ok, fail, ERROR_CODES, newRequestId } from '@/lib/api-contract';
import { getFileMeta } from '@/lib/onyxbase';
import { absoluteUrl, guardPublicIp, tooManyRequests } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

const FILE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const ip = guardPublicIp(request, 60, 60_000);
  if (!ip.ok) return tooManyRequests(ip.retryAfterSecs, meta);

  const { fileId } = await params;
  if (!FILE_ID_RE.test(fileId)) {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.VALIDATION_ERROR, 'Malformed file id.', meta, { status: 400 });
  }

  const metaInfo = await getFileMeta(fileId).catch(() => null);

  meta.durationMs = Date.now() - t0;
  return ok(
    {
      fileId,
      url: absoluteUrl(request, `/api/f/${fileId}`),
      fileName: metaInfo?.fileName ?? null,
      mimeType: metaInfo?.mimeType ?? null,
      size: metaInfo?.size ?? null,
      createdAt: metaInfo?.createdAt ?? null,
    },
    meta
  );
}

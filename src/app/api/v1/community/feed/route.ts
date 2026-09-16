/**
 * GET /api/v1/community/feed — public feed of all published community
 * resources, newest first (no auth required).
 *
 * Query: limit (default 50, max 200).
 */
import { NextRequest } from 'next/server';
import { ok, fail, ERROR_CODES, newRequestId } from '@/lib/api-contract';
import { listAllPublicResources } from '@/lib/resources';
import { serializeResource, guardPublicIp, tooManyRequests } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const ip = guardPublicIp(request, 30, 60_000);
  if (!ip.ok) return tooManyRequests(ip.retryAfterSecs, meta);

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  let limit = 50;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (Number.isNaN(n) || n < 1) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'limit must be a positive number.', meta, { status: 400 });
    }
    limit = Math.min(n, 200);
  }

  const resources = await listAllPublicResources().catch(() => []);
  meta.durationMs = Date.now() - t0;
  return ok(
    {
      total: resources.length,
      resources: resources.slice(0, limit).map((r) => serializeResource(r, request)),
    },
    meta
  );
}

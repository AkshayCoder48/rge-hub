/**
 * GET /api/v1/health — public API liveness (no auth).
 *
 * Reports the hub + storage engine status so integrations (and the MCP
 * server's --check mode) can verify an instance is reachable.
 */
import { NextRequest } from 'next/server';
import { ok, newRequestId } from '@/lib/api-contract';
import { backendReadReady } from '@/lib/onyxbase';
import { guardPublicIp, tooManyRequests } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const meta = { requestId, durationMs: 0 };
  const t0 = Date.now();

  const ip = guardPublicIp(request, 60, 60_000);
  if (!ip.ok) return tooManyRequests(ip.retryAfterSecs, meta);

  const engineOk = await backendReadReady().catch(() => false);

  meta.durationMs = Date.now() - t0;
  return ok(
    {
      status: 'ok',
      service: 'rge-hub-public-api',
      version: '1',
      components: {
        api: { ok: true },
        storage: { ok: engineOk },
      },
      time: new Date().toISOString(),
    },
    meta
  );
}

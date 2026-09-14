/**
 * GET /api/health — dependency health check (PRD §38, OnyxBase PRD §38).
 * Unauthenticated, always 200 (degraded states included) so monitors can
 * read component detail. Identifies WHICH dependency is unhealthy.
 */
import { NextResponse } from 'next/server';
import { newRequestId } from '@/lib/api-contract';
import { hasDirectMcpemailsKey, pingDirect } from '@/lib/mcpemail';
import { kvGet } from '@/lib/onyxbase';
import * as aisense from '@/lib/aisense';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = newRequestId();
  const t0 = Date.now();

  const [onyx, sense, email] = await Promise.all([
    kvGet('__health_probe__', 'default')
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : String(e) })),
    (async () => {
      try {
        // Cheap write probe (tiny object, expires in 24h server-side).
        const put = await aisense.put({ probe: 'rge-health', at: Date.now() });
        return { ok: true, detail: `storage ok (${put.storageId.slice(0, 8)}…)` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    })(),
    hasDirectMcpemailsKey()
      ? pingDirect()
      : Promise.resolve({ ok: true, detail: 'direct key not set — OnyxBase email fallback in use' }),
  ]);

  const components = {
    api: { ok: true },
    otpTempStorage: sense,
    email: email.ok ? { ok: true, detail: email.detail } : { ok: false, detail: email.detail },
    onyxbase: onyx,
    sessionSecret: process.env.SESSION_SECRET
      ? { ok: true }
      : { ok: false, detail: 'SESSION_SECRET not set — derived fallback in use (sessions reset per deploy)' },
  };
  const allOk = Object.values(components).every((c) => (c as { ok: boolean }).ok);

  return NextResponse.json(
    {
      success: true,
      data: {
        status: allOk ? 'healthy' : 'degraded',
        components,
      },
      requestId,
      durationMs: Date.now() - t0,
    },
    { headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } }
  );
}

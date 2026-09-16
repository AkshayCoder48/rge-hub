/**
 * POST /api/agent/tool — execute ONE whitelisted SERVER-side agent tool.
 *
 * The agent engine runs in the browser (web-container workspace + client
 * tools). A few tools genuinely need the server (hub storage operations):
 * this route executes exactly those, whitelisted:
 *
 *   update_resource  — edit a hub resource's metadata (title/description/…)
 *   speedramp_clip   — server-side ffmpeg speed-ramp on a hub clip
 *
 * Body: { name: string, args: object }
 * Response: { success, data: { ok, result, meta? } }
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { executeTool } from '@/lib/agent/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SERVER_TOOLS = new Set(['update_resource', 'speedramp_clip']);

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const session = sessionResult.session;

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const args =
      body?.args && typeof body.args === 'object' && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    if (!name || !SERVER_TOOLS.has(name)) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, `Unknown server tool "${name.slice(0, 60)}".`, meta, { status: 400 });
    }

    const ctx = { userId: session.userId, session, req: request };
    const result = await executeTool(name, args, ctx);

    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/tool', 'POST', 200, `agent.tool.${name}`);
    return ok({ ok: result.ok, result: result.result, ...(result.meta ? { meta: result.meta } : {}) }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/tool] error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Tool execution failed.', meta, { status: 500 });
  }
}

/**
 * POST /api/agent/models — OpenAI-compatible MODEL AUTO-DISCOVERY.
 *
 * Body: { baseUrl: string, apiKey?: string }
 *
 * Server-side GET {normalized baseUrl}/models (keyless providers supported —
 * the Authorization header only rides the request when a key is provided).
 * Returns the discovered model ids for the Settings model picker:
 *   { success, data: { ok, models: string[], count, endpoint } }
 * Graceful, honest failures — never fake model ids.
 *
 * The API key is used for THIS request only — never persisted, never logged.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { normalizeOpenAiBaseUrl } from '@/lib/agent/protocol';

export const dynamic = 'force-dynamic';

const MAX_MODELS = 500;

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

    const body = await request.json().catch(() => null);
    const rawBase = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim().slice(0, 400) : '';

    if (!rawBase || !/^https?:\/\//.test(rawBase)) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Provide the provider base URL (e.g. https://api.example.com/v1).', meta, { status: 400 });
    }

    const base = normalizeOpenAiBaseUrl(rawBase);
    const endpoint = `${base}/models`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let res: Response;
    try {
      res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    } catch (err) {
      meta.durationMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const hint = /timed? ?out|abort/i.test(msg) ? 'The endpoint did not respond within 15s.' : `Could not reach ${endpoint} (${msg}).`;
      return ok({ ok: false, error: hint, models: [], count: 0, endpoint }, meta);
    }

    if (res.status === 401 || res.status === 403) {
      meta.durationMs = Date.now() - t0;
      return ok(
        { ok: false, error: `The endpoint requires a valid API key (HTTP ${res.status}). Add the key, then fetch again.`, models: [], count: 0, endpoint },
        meta
      );
    }
    if (!res.ok) {
      meta.durationMs = Date.now() - t0;
      const text = await res.text().catch(() => '');
      return ok(
        { ok: false, error: `Endpoint answered HTTP ${res.status}${text ? `: ${text.slice(0, 180).replace(/\s+/g, ' ')}` : ''}`, models: [], count: 0, endpoint },
        meta
      );
    }

    const data = await res.json().catch(() => null);
    // Standard OpenAI shape: { object: 'list', data: [{ id, object: 'model' }] }
    const source = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    const models: string[] = [];
    for (const m of source) {
      const id = typeof m === 'string' ? m : typeof m?.id === 'string' ? m.id : '';
      if (id && !models.includes(id)) models.push(id);
      if (models.length >= MAX_MODELS) break;
    }

    meta.durationMs = Date.now() - t0;
    if (models.length === 0) {
      return ok(
        {
          ok: false,
          error: 'The endpoint responded but exposed no model ids (expected {"data":[{"id":…}]}). You can still enter the model id manually.',
          models: [],
          count: 0,
          endpoint,
        },
        meta
      );
    }
    logRequest(meta, '/api/agent/models', 'POST', 200, 'agent.models.discovered');
    return ok({ ok: true, models, count: models.length, endpoint }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/models] error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Model discovery failed.', meta, { status: 500 });
  }
}

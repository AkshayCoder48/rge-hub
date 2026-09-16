/**
 * /api/agent/config
 *
 * GET — the signed-in user's agent LLM config (API key MASKED).
 * PUT — validate + save a patch: { provider, baseUrl?, apiKey?, model?,
 *       temperature?, maxTokens? }. OpenAI-compatible requires baseUrl +
 * apiKey; temperature clamps to 0–2. A masked apiKey echo keeps the stored
 * key; an empty string clears it.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { getAgentConfig, saveAgentConfig, toPublicConfig, sanitizeConfig } from '@/lib/agent/config';
import type { AgentConfig } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const cfg = await getAgentConfig(sessionResult.session.userId);
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/config', 'GET', 200, 'agent.config.get');
    return ok(toPublicConfig(cfg), meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/config] get error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to load agent config.', meta, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
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
    if (!body || typeof body !== 'object') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid request body.', meta, { status: 400 });
    }

    const patch: Partial<AgentConfig> = {};
    if (body.provider !== undefined) {
      if (body.provider !== 'zai' && body.provider !== 'openai') {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'provider must be "zai" or "openai".', meta, { status: 400 });
      }
      patch.provider = body.provider;
    }
    if (body.baseUrl !== undefined) {
      if (body.baseUrl !== '' && !/^https?:\/\//.test(String(body.baseUrl).trim())) {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'baseUrl must be an http(s) URL.', meta, { status: 400 });
      }
      patch.baseUrl = String(body.baseUrl).trim();
    }
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== 'string') {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'apiKey must be a string.', meta, { status: 400 });
      }
      patch.apiKey = body.apiKey;
    }
    if (body.model !== undefined) patch.model = String(body.model ?? '');
    if (body.temperature !== undefined) {
      const t = Number(body.temperature);
      if (!Number.isFinite(t) || t < 0 || t > 2) {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'temperature must be between 0 and 2.', meta, { status: 400 });
      }
      patch.temperature = t;
    }
    if (body.maxTokens !== undefined) {
      const m = Number(body.maxTokens);
      if (!Number.isFinite(m) || m < 256 || m > 32768) {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'maxTokens must be 256–32768.', meta, { status: 400 });
      }
      patch.maxTokens = Math.round(m);
    }

    // OpenAI-compatible completeness check (against stored + patch values).
    const current = await getAgentConfig(sessionResult.session.userId);
    const merged = sanitizeConfig({
      ...current,
      ...patch,
      apiKey: patch.apiKey !== undefined && patch.apiKey.includes('…') ? current.apiKey : patch.apiKey,
    });
    if (merged.provider === 'openai') {
      if (!merged.baseUrl || !/^https?:\/\//.test(merged.baseUrl)) {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'The OpenAI-compatible provider needs a base URL (e.g. https://api.openai.com/v1).', meta, { status: 400 });
      }
      if (!merged.apiKey) {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.VALIDATION_ERROR, 'The OpenAI-compatible provider needs an API key.', meta, { status: 400 });
      }
    }

    const saved = await saveAgentConfig(sessionResult.session.userId, patch);
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/config', 'PUT', 200, 'agent.config.save', {
      provider: saved.provider,
      hasApiKey: !!saved.apiKey, // boolean only — the key itself never reaches logs
    });
    return ok(toPublicConfig(saved), meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/config] put error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to save agent config.', meta, { status: 500 });
  }
}

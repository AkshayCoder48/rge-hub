/**
 * PUBLIC API (v1) — API-key authentication.
 *
 * The RGE Hub public API (/api/v1/*) authenticates with the user's account
 * API key — the SAME key revealed in Settings → Security ("Reveal API
 * key"). Keys are OnyxBase V5 account keys: the engine verifies them
 * cryptographically (sha256 hash lookup in v5_accounts) via
 * GET {engine}/api/v5/accounts/whoami, which resolves the key to its
 * userId. The hub then loads the RGE profile for that userId.
 *
 * Accepted headers (either):
 *   Authorization: Bearer kv_live_xxx
 *   X-API-Key: kv_live_xxx
 *
 * Security properties:
 *   - The key NEVER travels to the browser from these routes and is never
 *     logged (only its last 6 chars in the request log context, "keyTail").
 *   - whoami results are cached in-memory for 60s per key hash, so hot API
 *     traffic costs zero engine reads.
 *   - Per-key sliding-window rate limit (in-memory, per instance).
 *   - Admin rights are recomputed from the verified profile email/userId —
 *     identical rules to session auth (session.ts isAdminUser).
 */

import { getProfile, type Profile } from './resources';
import { allow } from './rate-limit';
import { isAdminUser } from './session';
import crypto from 'crypto';

const ENGINE_BASE = (() => {
  const v5 = (process.env.ONYXBASE_V5_URL || '').trim().replace(/\/+$/, '');
  if (v5) return v5;
  return (process.env.ONYXBASE_BASE_URL || '').trim().replace(/\/+$/, '');
})();

export const API_KEY_RATE_LIMIT = 90; // requests per minute per key
export const API_KEY_RATE_WINDOW_MS = 60_000;

export interface ApiKeyAuthOk {
  status: 'ok';
  /** Last 6 chars — the only key material that may appear in logs. */
  keyTail: string;
  userId: string;
  profile: Profile | null;
  isAdmin: boolean;
}

export type ApiKeyAuthResult =
  | ApiKeyAuthOk
  | { status: 'no-key' }
  | { status: 'invalid' }
  | { status: 'rate-limited'; retryAfterSecs: number };

/** Extract the caller's API key from Authorization (Bearer) or X-API-Key. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    const k = auth.replace(/^Bearer\s+/i, '').trim();
    if (k) return k;
  }
  const xk = req.headers.get('x-api-key');
  if (xk && xk.trim()) return xk.trim();
  return null;
}

// ─── whoami cache: key-hash → { userId, at } ────────────────────────────────
const WHOAMI_CACHE_MS = 60_000;
const WHOAMI_CACHE_MAX = 512;
const whoamiCache = new Map<string, { userId: string; at: number }>();

async function resolveKeyToUserId(key: string): Promise<string | null> {
  const h = crypto.createHash('sha256').update(key).digest('hex').slice(0, 40);
  const hit = whoamiCache.get(h);
  if (hit && Date.now() - hit.at < WHOAMI_CACHE_MS) return hit.userId;

  const base = ENGINE_BASE;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/v5/accounts/whoami`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null; // engine trouble → treat as invalid (fail-secure)
    const data = await res.json().catch(() => null);
    const userId = data?.data?.userId || data?.userId;
    if (!userId || typeof userId !== 'string') return null;
    if (whoamiCache.size >= WHOAMI_CACHE_MAX) {
      // drop the oldest entries (Map preserves insertion order)
      const drop = Math.floor(WHOAMI_CACHE_MAX / 4);
      let i = 0;
      for (const k of whoamiCache.keys()) {
        whoamiCache.delete(k);
        if (++i >= drop) break;
      }
    }
    whoamiCache.set(h, { userId, at: Date.now() });
    return userId;
  } catch {
    return null;
  }
}

/**
 * Authenticate a public-API request. Cheap: one in-memory rate-limit check,
 * one cached engine whoami per minute, one profile read.
 */
export async function authenticateApiKey(req: Request): Promise<ApiKeyAuthResult> {
  const key = extractApiKey(req);
  if (!key) return { status: 'no-key' };
  if (key.length < 16 || key.length > 256) return { status: 'invalid' };

  const rl = allow(`apiv1:${key.slice(0, 16)}`, API_KEY_RATE_LIMIT, API_KEY_RATE_WINDOW_MS);
  if (!rl.allowed) {
    return { status: 'rate-limited', retryAfterSecs: rl.retryAfterSecs ?? 60 };
  }

  const userId = await resolveKeyToUserId(key);
  if (!userId) return { status: 'invalid' };

  const profile = await getProfile(userId).catch(() => null);
  const isAdmin = isAdminUser({ email: profile?.email, userId });
  return { status: 'ok', keyTail: key.slice(-6), userId, profile, isAdmin };
}

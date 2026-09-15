/**
 * GET /api/account/details — session-scoped account summary for Settings.
 *
 * Returns the signed-in user's email, API key and member-since date. The
 * key is only ever shown to its owner (session cookie required) — this is
 * the "I lost my key" recovery view inside Settings → Security.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getProfile } from '@/lib/resources';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';

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
    const s = sessionResult.session;

    // Member-since lives on the profile row (created at registration).
    // Missing/legacy profile → fall back to the session's createdAt.
    const profile = await getProfile(s.userId).catch(() => null);
    const createdAt = profile?.createdAt || s.createdAt;

    const res = ok(
      {
        userId: s.userId,
        username: s.username,
        email: s.email || profile?.email || '',
        apiKey: s.apiKey,
        createdAt,
      },
      meta
    );
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/account/details', 'GET', 200, 'account.details');
    return res;
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[account/details] error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to load account details.', meta, { status: 500 });
  }
}

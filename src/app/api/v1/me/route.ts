/**
 * GET /api/v1/me — the authenticated account (API key required).
 *
 * Returns the caller's profile (safe fields — never the API key) plus
 * upload/follower counts. This is the natural first call to verify a key.
 */
import { NextRequest } from 'next/server';
import { ok, fail, ERROR_CODES, newRequestId } from '@/lib/api-contract';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { listResourcesByOwner, getFollowCounts } from '@/lib/resources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };

  const auth = await authenticateApiKey(request);
  if (auth.status === 'no-key') {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.UNAUTHENTICATED, 'API key required — send Authorization: Bearer <key> or X-API-Key: <key>.', meta, { status: 401 });
  }
  if (auth.status === 'rate-limited') {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.RATE_LIMITED, 'Too many requests — retry shortly.', meta, {
      status: 429,
      retryable: true,
      retryAfterSecs: auth.retryAfterSecs,
    });
  }
  if (auth.status === 'invalid') {
    meta.durationMs = Date.now() - t0;
    return fail(ERROR_CODES.UNAUTHENTICATED, 'Invalid or revoked API key.', meta, { status: 401 });
  }

  if (!auth.profile) {
    meta.durationMs = Date.now() - t0;
    // Valid engine account, but no RGE Hub profile (never signed in to the Hub).
    return fail(
      ERROR_CODES.ACCOUNT_NOT_FOUND,
      'This key is valid but has no RGE Hub profile — sign in to the Hub once to create it.',
      meta,
      { status: 404 }
    );
  }

  const [resources, counts] = await Promise.all([
    listResourcesByOwner(auth.userId).catch(() => [] as Awaited<ReturnType<typeof listResourcesByOwner>>),
    getFollowCounts(auth.userId).catch(() => ({ followersCount: 0, followingCount: 0 })),
  ]);

  const p = auth.profile;
  meta.durationMs = Date.now() - t0;
  return ok(
    {
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      avatar: p.avatar || null,
      bio: p.bio || '',
      createdAt: p.createdAt,
      isAdmin: auth.isAdmin,
      counts: {
        uploads: resources.length,
        published: resources.filter((r) => r.published).length,
        drafts: resources.filter((r) => !r.published).length,
        ...counts,
      },
    },
    meta
  );
}

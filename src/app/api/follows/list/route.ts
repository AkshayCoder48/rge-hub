/**
 * GET /api/follows/list?userId=<id>&kind=followers|following&page=1&limit=30
 * Resolved rows for the Followers/Following lists: profile + role badge +
 * follow state relative to the viewer.
 *
 * PERF (PRD §14, OnyxBase PRD §13): profiles resolve in PARALLEL
 * (concurrency 8) through a 30s cached fetch instead of 150 sequential
 * 10s point-reads. Pagination applied server-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getFollowerIds, getFollowingIds, getProfileCached } from '@/lib/resources';
import { loadStaffRoleMap, publicRoleFor } from '@/lib/admin';
import { newRequestId } from '@/lib/api-contract';

export const dynamic = 'force-dynamic';

/** Run tasks with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const sessionResult = await getSession();
  if (sessionResult.status !== 'ok') {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, requestId },
      { status: 401, headers: { 'x-request-id': requestId } }
    );
  }
  const viewerId = sessionResult.session.userId;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') || '';
  const kind = searchParams.get('kind') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '30', 10) || 30));
  if (!userId || (kind !== 'followers' && kind !== 'following')) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'userId and kind=followers|following are required' },
        requestId,
      },
      { status: 400, headers: { 'x-request-id': requestId } }
    );
  }
  try {
    const [ids, staffMap, viewerFollowing] = await Promise.all([
      kind === 'followers' ? getFollowerIds(userId) : getFollowingIds(userId),
      loadStaffRoleMap(),
      getFollowingIds(viewerId),
    ]);
    const viewerSet = new Set(viewerFollowing);

    // Dedup + resolve in parallel (bounded), then paginate server-side.
    const seen = new Set<string>();
    const uniqueIds = ids.filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const resolved = await mapLimit(uniqueIds, 8, async (id) => {
      const profile = await getProfileCached(id).catch(() => null);
      if (!profile || !profile.username) return null; // deleted/ghost — skip safely
      return {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        role: publicRoleFor(profile, staffMap),
        isFollowing: (id === viewerId ? 'self' : viewerSet.has(id)) as boolean | 'self',
      };
    });

    const rows = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
    const total = rows.length;
    const start = (page - 1) * limit;
    const paged = rows.slice(start, start + limit);

    return NextResponse.json(
      {
        success: true,
        data: {
          kind,
          userId,
          total,
          page,
          limit,
          hasMore: start + paged.length < total,
          users: paged,
        },
        requestId,
        durationMs: Date.now() - t0,
      },
      { headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[follows/list] error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to load list' },
        requestId,
      },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}

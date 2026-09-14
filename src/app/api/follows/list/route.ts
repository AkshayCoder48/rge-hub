/**
 * GET /api/follows/list?userId=<id>&kind=followers|following
 * Resolved rows for the Followers/Following lists: profile + role badge +
 * follow state relative to the viewer. Missing/deleted profiles are skipped
 * (never shown, never break the list). Deduped by userId, capped at 150.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getFollowerIds, getFollowingIds, getProfile } from '@/lib/resources';
import { loadStaffRoleMap, publicRoleFor } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionResult = await getSession();
  if (sessionResult.status !== 'ok') {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
  }
  const viewerId = sessionResult.session.userId;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') || '';
  const kind = searchParams.get('kind') || '';
  if (!userId || (kind !== 'followers' && kind !== 'following')) {
    return NextResponse.json(
      { ok: false, error: 'userId and kind=followers|following are required' },
      { status: 400 }
    );
  }
  try {
    const [ids, staffMap, viewerFollowing] = await Promise.all([
      kind === 'followers' ? getFollowerIds(userId) : getFollowingIds(userId),
      loadStaffRoleMap(),
      getFollowingIds(viewerId),
    ]);
    const viewerSet = new Set(viewerFollowing);
    const seen = new Set<string>();
    const rows: Array<{
      userId: string;
      username: string;
      displayName: string;
      avatar?: string;
      role: string;
      isFollowing: boolean | 'self';
    }> = [];
    for (const id of ids.slice(0, 150)) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const profile = await getProfile(id).catch(() => null);
      if (!profile || !profile.username) continue; // deleted/ghost — skip safely
      rows.push({
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        role: publicRoleFor(profile, staffMap),
        isFollowing: id === viewerId ? 'self' : viewerSet.has(id),
      });
    }
    return NextResponse.json({ ok: true, kind, userId, total: ids.length, users: rows });
  } catch (err) {
    console.error('[follows/list] error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to load list' }, { status: 500 });
  }
}

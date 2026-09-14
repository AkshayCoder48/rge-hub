/**
 * GET /api/users/[id]
 * Public profile by userId: safe profile + published resources + counts.
 *
 * No auth required (public pages). When logged in, includes `isFollowing`
 * ('self' for your own profile).
 *
 * Returns: { ok: true, profile, resources, uploadsCount,
 *            followersCount, followingCount, isFollowing }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { loadStaffRoleMap, publicRoleFor } from '@/lib/admin';
import {
  getProfile,
  listResourcesByOwner,
  getFollowCounts,
  isFollowing,
  type Profile,
} from '@/lib/resources';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: 'User id is required' }, { status: 400 });
    }

    const [profile, sessionResult] = await Promise.all([
      getProfile(id).catch(() => null) as Promise<Profile | null>,
      getSession().catch(() => null),
    ]);
    if (!profile) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    const [allResources, counts] = await Promise.all([
      listResourcesByOwner(profile.userId).catch(() => []),
      getFollowCounts(profile.userId),
    ]);
    const resources = allResources.filter((r) => r.published);

    const staffMap = await loadStaffRoleMap().catch(() => new Map<string, 'admin' | 'moderator'>());
    const role = publicRoleFor(profile, staffMap);

    let isFollowingValue: boolean | 'self' | null = null;
    if (sessionResult && sessionResult.status === 'ok') {
      const viewerId = sessionResult.session.userId;
      isFollowingValue =
        viewerId === profile.userId ? 'self' : await isFollowing(viewerId, profile.userId).catch(() => false);
    }

    return NextResponse.json({
      ok: true,
      profile: {
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        role,
        bio: profile.bio,
        createdAt: profile.createdAt,
      },
      resources,
      uploadsCount: resources.length,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
      isFollowing: isFollowingValue,
    });
  } catch (err) {
    console.error('[users/get] error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to load profile' }, { status: 500 });
  }
}

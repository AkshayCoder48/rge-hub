/**
 * /api/follows — social graph.
 *
 * GET  ?userId=<id> (default: self) → { following, followingCount, followersCount }
 * POST { targetId }                 → follow
 * DELETE ?targetId=<id>             → unfollow
 *
 * Auth required for everything (reads are cheap single-key GETs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  getFollowingIds,
  getFollowCounts,
  followUser,
  unfollowUser,
} from '@/lib/resources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || session.userId;
    const [following, counts] = await Promise.all([
      getFollowingIds(userId),
      getFollowCounts(userId),
    ]);
    return NextResponse.json({
      ok: true,
      userId,
      following,
      followingCount: counts.followingCount,
      followersCount: counts.followersCount,
    });
  } catch (err) {
    console.error('[follows/get] error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to load follows' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;
    const body = await request.json().catch(() => null);
    const targetId = typeof body?.targetId === 'string' ? body.targetId : '';
    if (!targetId) {
      return NextResponse.json({ ok: false, error: 'targetId is required' }, { status: 400 });
    }
    const result = await followUser(session.userId, targetId);
    if (!result.ok) {
      return NextResponse.json(result, { status: result.retryable ? 503 : 400 });
    }

    return NextResponse.json({
      ok: true,
      already: result.already,
      following: result.following,
      followingCount: result.followingCount,
      followersCount: result.followersCount,
    });
  } catch (err) {
    console.error('[follows/post] error:', err);
    return NextResponse.json({ ok: false, error: 'Follow failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('targetId') || '';
    if (!targetId) {
      return NextResponse.json({ ok: false, error: 'targetId is required' }, { status: 400 });
    }
    const result = await unfollowUser(session.userId, targetId);
    if (!result.ok) {
      return NextResponse.json(result, { status: result.retryable ? 503 : 400 });
    }

    return NextResponse.json({
      ok: true,
      already: result.already,
      following: result.following,
      followingCount: result.followingCount,
      followersCount: result.followersCount,
    });
  } catch (err) {
    console.error('[follows/delete] error:', err);
    return NextResponse.json({ ok: false, error: 'Unfollow failed' }, { status: 500 });
  }
}

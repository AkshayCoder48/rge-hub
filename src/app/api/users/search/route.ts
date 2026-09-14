/**
 * GET /api/users/search?q=<query>
 * Find people by username / display name substring.
 *
 * Auth required. Single export + in-memory filter (profiles collection is
 * small); never leaks apiKey/email.
 *
 * Returns: { ok: true, users: SafeMiniProfile[], following: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { kvExport } from '@/lib/onyxbase';
import { ONYXBASE_COLLECTIONS } from '@/lib/onyxbase';
import { getFollowingIds, type Profile } from '@/lib/resources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const session = sessionResult.session;
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 2) {
      return NextResponse.json({ ok: false, error: 'Type at least 2 characters' }, { status: 400 });
    }

    const [all, following] = await Promise.all([
      kvExport(ONYXBASE_COLLECTIONS.PROFILES) as Promise<Record<string, Profile>>,
      getFollowingIds(session.userId),
    ]);

    const seen = new Set<string>();
    const users: Array<{
      userId: string;
      username: string;
      displayName: string;
      avatar?: string;
      bio: string;
    }> = [];
    for (const key of Object.keys(all)) {
      const p = all[key];
      if (!p || typeof p !== 'object' || !p.userId || seen.has(p.userId)) continue;
      // Skip index rows (username:*/email:* map to bare userId strings).
      if (typeof (p as unknown as string) === 'string') continue;
      const hay = `${p.username || ''} ${p.displayName || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      seen.add(p.userId);
      users.push({
        userId: p.userId,
        username: p.username,
        displayName: p.displayName,
        avatar: p.avatar,
        bio: typeof p.bio === 'string' ? p.bio.slice(0, 140) : '',
      });
      if (users.length >= 20) break;
    }

    return NextResponse.json({ ok: true, users, following });
  } catch (err) {
    console.error('[users/search] error:', err);
    return NextResponse.json({ ok: false, error: 'Search failed' }, { status: 500 });
  }
}

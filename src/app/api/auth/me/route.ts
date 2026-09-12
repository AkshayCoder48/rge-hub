/**
 * GET /api/auth/me
 * Returns the current authenticated user's session data.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, user: null }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      userId: session.userId,
      username: session.username,
      displayName: session.displayName,
      avatar: session.avatar,
      bio: session.bio,
      isAdmin: session.isAdmin,
    },
  });
}

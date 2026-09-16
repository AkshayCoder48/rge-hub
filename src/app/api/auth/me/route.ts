/**
 * GET /api/auth/me
 * Returns the current authenticated user's session data.
 *
 * CRITICAL: This endpoint distinguishes between:
 * - "authenticated" — session is valid, user is logged in
 * - "unauthenticated" — no session or session expired (user should log in)
 * - "loading" — database error, do NOT log user out (frontend should retry)
 *
 * This prevents false auto-logouts when OnyxBase has temporary failures.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolveRole } from '@/lib/admin';
import { kvGetStatus, ONYXBASE_COLLECTIONS } from '@/lib/onyxbase';

export async function GET() {
  const result = await getSession();

  if (result.status === 'ok') {
    const s = result.session;
    // DELETED-ACCOUNT CHECK: stateless HMAC cookies stay valid until expiry,
    // and the in-memory revocation from DELETE /api/account only covers the
    // instance that handled the deletion. The profile row is the durable
    // truth — a session whose profile no longer exists (account deleted)
    // is dead everywhere. Engine trouble degrades to "loading" (never a
    // false logout); ONLY a confirmed 404 signs the user out.
    let profileRead = await kvGetStatus(`profile:${s.userId}`, ONYXBASE_COLLECTIONS.PROFILES);
    if (profileRead.status === 'missing') {
      // Cold-boot race guard: a fresh engine instance briefly serves an
      // EMPTY store while its boot-restore is still in flight — a 404 from
      // that window is NOT a deleted profile. Re-read once after a short
      // wait; only a CONFIRMED second miss signs the user out.
      await new Promise((r) => setTimeout(r, 900));
      profileRead = await kvGetStatus(`profile:${s.userId}`, ONYXBASE_COLLECTIONS.PROFILES);
    }
    if (profileRead.status === 'missing') {
      return NextResponse.json({
        ok: false,
        status: 'unauthenticated',
        user: null,
      }, { status: 200 });
    }
    if (profileRead.status === 'error') {
      // Engine unreachable — tell the frontend to RETRY, not log out.
      return NextResponse.json({
        ok: true,
        status: 'loading',
        user: null,
        message: 'Session check in progress',
      }, { status: 200 });
    }
    // Role lookup is advisory here — KV trouble degrades to plain user
    // rather than breaking login.
    const resolved = await resolveRole({ userId: s.userId, email: s.email }).catch(() => ({
      role: 'user' as const,
      permissions: [] as string[],
    }));
    return NextResponse.json({
      ok: true,
      status: 'authenticated',
      user: {
        userId: s.userId,
        username: s.username,
        displayName: s.displayName,
        avatar: s.avatar,
        bio: s.bio,
        isAdmin: s.isAdmin,
        role: resolved.role,
        permissions: resolved.permissions,
      },
    });
  }

  if (result.status === 'error') {
    // Database error — tell frontend to RETRY, not log out
    return NextResponse.json({
      ok: true,
      status: 'loading',
      user: null,
      message: 'Session check in progress',
    }, { status: 200 });
  }

  // no-session or expired — genuinely unauthenticated
  return NextResponse.json({
    ok: false,
    status: 'unauthenticated',
    user: null,
  }, { status: 200 });
}

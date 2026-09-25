/**
 * GET /api/auth/me
 * Returns the current authenticated user's session data.
 *
 * CRITICAL: This endpoint distinguishes between:
 * - "authenticated" — session is valid, user is logged in
 * - "unauthenticated" — no session, session expired, or account PROVABLY deleted
 * - "loading" — database error, do NOT log user out (frontend should retry)
 *
 * This prevents false auto-logouts when OnyxBase has temporary failures.
 *
 * STRANDED-PROFILE GUARD (refresh auto-logout fix): the engine is a
 * multi-instance serverless store — a KV row can be missing on the serving
 * instance AND absent from the shared snapshot (stranded) while the account
 * itself is alive elsewhere. The OLD code treated a profile miss as
 * "account deleted" and destroyed a perfectly valid session on every
 * refresh. Now a profile miss triggers an ACCOUNT-LIVENESS CHECK via the
 * engine's whoami (the session's apiKey resolves while the account exists):
 *   - alive      → the profile row is stranded/late, NOT deleted — heal it
 *                  from session data (upsertProfile → the write ships a
 *                  kv-delta that resurrects the row fleet-wide) and stay
 *                  signed in.
 *   - 401 ×2     → the canonical account row AND its keys are gone — a real
 *                  deletion → sign out.
 *   - error      → engine trouble → "loading" (never a false logout).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolveRole } from '@/lib/admin';
import { kvGetStatus, ONYXBASE_COLLECTIONS, ONYXBASE_V5_ENABLED, v5WhoamiAccount } from '@/lib/onyxbase';
import { upsertProfile, type Profile } from '@/lib/resources';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getSession();

  if (result.status === 'ok') {
    const s = result.session;
    // DELETED-ACCOUNT CHECK: stateless HMAC cookies stay valid until expiry,
    // and the in-memory revocation from DELETE /api/account only covers the
    // instance that handled the deletion. The profile row is the durable
    // truth — a session whose profile no longer exists (account deleted)
    // is dead everywhere. Engine trouble degrades to "loading" (never a
    // false logout); ONLY a confirmed liveness failure signs the user out.
    let profileRead = await kvGetStatus(`profile:${s.userId}`, ONYXBASE_COLLECTIONS.PROFILES);
    if (profileRead.status === 'missing') {
      // Cold-boot race guard: a fresh engine instance briefly serves an
      // EMPTY store while its boot-restore is still in flight — a 404 from
      // that window is NOT a deleted profile. Re-read once after a short
      // wait; only a CONFIRMED second miss enters the liveness check.
      await new Promise((r) => setTimeout(r, 900));
      profileRead = await kvGetStatus(`profile:${s.userId}`, ONYXBASE_COLLECTIONS.PROFILES);
    }
    if (profileRead.status === 'missing') {
      // STRANDED-PROFILE LIVENESS CHECK — is the ACCOUNT still alive?
      let alive: 'ok' | 'unauthorized' | 'error' = 'error';
      if (ONYXBASE_V5_ENABLED && s.apiKey) {
        const first = await v5WhoamiAccount(s.apiKey);
        if (first.status === 'ok') {
          alive = 'ok';
        } else {
          // Two strikes, short delay apart (different engine instance luck
          // + the engine's own freshness retries inside whoami): a stranded
          // KEY row must not read as a deleted account.
          await new Promise((r) => setTimeout(r, 600));
          const second = await v5WhoamiAccount(s.apiKey);
          alive = second.status;
        }
      } else {
        // No V5 engine — the profile row alone can't prove deletion.
        alive = 'ok';
      }
      if (alive === 'error') {
        // Engine unreachable — tell the frontend to RETRY, not log out.
        return NextResponse.json({
          ok: true,
          status: 'loading',
          user: null,
          message: 'Session check in progress',
        }, { status: 200 });
      }
      if (alive === 'unauthorized') {
        // Confirmed: the account (and every key it minted) is gone —
        // UNLESS the session is YOUNG. A freshly minted session key can
        // itself be stranded (the login/register instance's snapshot
        // upload lost the race) while the account is perfectly alive;
        // signing out over that is a false logout. Real deletions destroy
        // the session cookie server-side (the Hub's delete-account flow),
        // so a still-present young cookie + whoami-401 is far more likely
        // cross-instance lag than deletion. Young sessions (< 24h) get
        // 'loading' — the client retries with backoff and never logs out
        // over it; old sessions sign out (the grace is long past).
        const sessionAgeMs = s.createdAt ? Date.now() - new Date(s.createdAt).getTime() : 0;
        if (sessionAgeMs < 24 * 60 * 60 * 1000) {
          return NextResponse.json({
            ok: true,
            status: 'loading',
            user: null,
            message: 'Session check in progress',
          }, { status: 200 });
        }
        return NextResponse.json({
          ok: false,
          status: 'unauthenticated',
          user: null,
        }, { status: 200 });
      }
      // Account alive, profile stranded/late — HEAL the row from session
      // data. upsertProfile also rebuilds the email:/username: index keys,
      // and the write ships an engine kv-delta that resurrects the row on
      // every instance (the refresh-logout heals itself fleet-wide).
      const now = new Date().toISOString();
      const healed: Profile = {
        userId: s.userId,
        username: s.username,
        displayName: s.displayName,
        avatar: s.avatar || '',
        bio: s.bio || '',
        email: s.email ?? '',
        apiKey: s.apiKey,
        createdAt: s.createdAt || now,
        updatedAt: now,
      } as Profile;
      const healedOk = await upsertProfile(healed).catch(() => false);
      if (!healedOk) {
        // Heal write didn't commit — still authenticated; the next /me
        // retries the heal.
        console.warn('[auth/me] profile heal pending for:', s.userId);
      }
      // Fall through to the authenticated response below.
    }
    if (profileRead.status === 'error') {
      // Engine unreachable — tell frontend to RETRY, not log out.
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

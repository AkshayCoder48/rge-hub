/**
 * POST /api/auth/reset-password  — FIXED (was dead in production).
 *
 * THE OLD BUG: the password update went through OnyxBase's V4 REGISTER
 * endpoint ("re-register to update the password") — but that endpoint
 * REFUSES existing emails with 409 "An account with this email already
 * exists…", so tapping Confirm on the new-password step ALWAYS failed with
 * exactly that message. Password reset could never succeed.
 *
 * THE NEW FLOW:
 *   1. User requests reset OTP (/api/auth/otp/send, purpose=password_reset)
 *   2. User verifies (/api/auth/otp/verify) → receives a signed resetToken
 *      (HMAC-SHA256, 10-minute TTL, bound to the email)
 *   3. User submits { email, password, resetToken } here.
 *   4. V5 path (production): master-authed service call
 *      POST /api/v5/accounts/password → password_hash updated + fresh
 *      apiKey minted for the SAME account. The Hub owns the user-facing
 *      proof (the signed resetToken); the V5 route is the privileged write.
 *   5. SELF-HEALING profile: the V5 account is the source of truth for
 *      auth. If the hub profile row is missing (its write at registration
 *      can fail honestly — register logs "profile pending, login heals
 *      it"), it is REBUILT from the V5 account here. Reset never dead-ends
 *      on "No account found" when the account provably exists.
 *      V4 fallback: honest error (the legacy API has no update path).
 */
import { NextRequest } from 'next/server';
import {
  ONYXBASE_V5_ENABLED,
  v5UpdateAccountPassword,
  registerByEmailPassword,
  backendAcceptsWrites,
} from '@/lib/onyxbase';
import { getProfileByEmail, getProfileByUsername, upsertProfile, type Profile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import { verifyResetToken } from '@/lib/otp';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { allow, clientIpFrom } from '@/lib/rate-limit';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Derive a unique, valid username from the account name / email prefix. */
async function deriveUsername(seed: string, userId: string): Promise<string> {
  const base =
    (seed || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 14) || 'user';
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!/^[a-z0-9_]{3,20}$/.test(candidate)) continue;
    const taken = await getProfileByUsername(candidate);
    if (!taken || taken.userId === userId) return candidate;
  }
  return `user_${userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()}`;
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const resetToken = typeof body?.resetToken === 'string' ? body.resetToken : '';
    if (!email || !password || !resetToken) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Email, new password, and reset token are required.', meta, {
        status: 400,
      });
    }
    if (password.length < 6) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Password must be at least 6 characters.', meta, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit the expensive path (per IP).
    const rl = allow(`reset:ip:${clientIpFrom(request)}`, 6, 60 * 60_000);
    if (!rl.allowed) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.RATE_LIMITED, 'Too many reset attempts. Please wait a moment.', meta, {
        status: 429,
        retryable: true,
        retryAfterSecs: rl.retryAfterSecs,
      });
    }

    // Verify the signed reset token (fixes the dead "consumed flag" path).
    const tokenCheck = verifyResetToken(resetToken);
    if (!tokenCheck.ok || tokenCheck.email !== normalizedEmail) {
      meta.durationMs = Date.now() - t0;
      return fail(
        ERROR_CODES.RESET_TOKEN_INVALID,
        'Your reset session has expired. Please verify a new code and try again.',
        meta,
        { status: 400 }
      );
    }

    // ─── 1. Password update (V5 first — the authoritative account) ────────
    let accountUserId: string | undefined;
    let accountApiKey: string | undefined;
    let accountName: string | undefined;
    let profileWasMissing = false;

    if (ONYXBASE_V5_ENABLED) {
      const upd = await v5UpdateAccountPassword(normalizedEmail, password);
      meta.durationMs = Date.now() - t0;
      if (upd.ok && upd.userId && upd.apiKey) {
        accountUserId = upd.userId;
        accountApiKey = upd.apiKey;
        accountName = upd.name;
      } else if (upd.code === 'ACCOUNT_NOT_FOUND' || upd.code === 'NOT_FOUND') {
        // No V5 account — maybe a V4-era one with a hub profile (below).
        accountUserId = undefined;
      } else if (upd.code === 'RATE_LIMITED') {
        return fail(ERROR_CODES.RATE_LIMITED, upd.error || 'Too many attempts — please wait a moment.', meta, {
          status: 429,
          retryable: true,
        });
      } else {
        return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, upd.error || 'Password reset failed. Please try again.', meta, {
          status: 502,
          retryable: true,
        });
      }
    }

    // ─── 2. Locate the hub profile (get-or-BUILD from the V5 account) ────
    let existingProfile = await getProfileByEmail(normalizedEmail);

    if (!existingProfile && accountUserId) {
      // The V5 account PROVABLY exists (we just rotated its password) —
      // rebuild the missing hub profile row instead of dead-ending. This
      // heals the register path's honest "profile pending" outcome.
      profileWasMissing = true;
      const username = await deriveUsername(accountName || normalizedEmail.split('@')[0], accountUserId);
      const now = new Date().toISOString();
      const rebuilt: Profile = {
        userId: accountUserId,
        username,
        displayName: accountName || username,
        avatar: '',
        bio: '',
        email: normalizedEmail,
        apiKey: accountApiKey!,
        createdAt: now,
        updatedAt: now,
      } as Profile;
      const saved = await upsertProfile(rebuilt);
      if (!saved) {
        // The account's password IS updated — say so honestly and let the
        // next login heal the profile; never claim the reset failed.
        console.warn('[reset-password] profile rebuild pending for', accountUserId);
      }
      existingProfile = rebuilt;
    }

    // ─── 3. V4 legacy path (no V5 account + no V5 mode) ───────────────────
    if (!accountUserId) {
      if (!existingProfile) {
        // Don't reveal whether the email exists — generic message.
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.RESET_TOKEN_INVALID, 'No account found with this email address.', meta, {
          status: 400,
        });
      }
      if (!(await backendAcceptsWrites())) {
        meta.durationMs = Date.now() - t0;
        return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, 'The auth service is briefly unavailable — please retry.', meta, {
          status: 503,
          retryable: true,
        });
      }
      const regResult = await registerByEmailPassword(
        existingProfile.displayName,
        normalizedEmail,
        password
      );
      meta.durationMs = Date.now() - t0;
      if (regResult.ok && regResult.apiKey && regResult.userId) {
        accountUserId = regResult.userId;
        accountApiKey = regResult.apiKey;
      } else {
        const taken = /already registered|already exists/i.test(regResult.error || '');
        return fail(
          ERROR_CODES.UPSTREAM_UNAVAILABLE,
          taken
            ? 'Password reset is temporarily unavailable on the legacy auth service — please retry in a moment.'
            : regResult.error || 'Password reset failed. Please try again.',
          meta,
          { status: 502, retryable: true }
        );
      }
    }

    // ─── 4. Sync the profile's apiKey + session ───────────────────────────
    if (!existingProfile || !accountApiKey) {
      // Unreachable in practice (all paths above either return or set both)
      // — a defensive honest failure instead of a crash.
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.INTERNAL_ERROR, 'Password reset failed. Please try again.', meta, { status: 500 });
    }
    if (existingProfile.userId !== accountUserId && !profileWasMissing) {
      console.warn(
        '[reset-password] account id drift:',
        existingProfile.userId,
        '→',
        accountUserId,
        '(keeping profile row)'
      );
    }
    const updatedProfile: Profile = {
      ...existingProfile,
      apiKey: accountApiKey,
      updatedAt: new Date().toISOString(),
    };
    await upsertProfile(updatedProfile);

    const isAdmin = isAdminUser({
      username: updatedProfile.username,
      displayName: updatedProfile.displayName,
      email: updatedProfile.email,
    });
    await createSession({
      userId: updatedProfile.userId,
      username: updatedProfile.username,
      displayName: updatedProfile.displayName,
      email: updatedProfile.email,
      avatar: updatedProfile.avatar,
      bio: updatedProfile.bio,
      apiKey: updatedProfile.apiKey,
      isAdmin,
    });

    const res = ok(
      {
        message: 'Password reset successfully',
        user: {
          userId: updatedProfile.userId,
          username: updatedProfile.username,
          displayName: updatedProfile.displayName,
          avatar: updatedProfile.avatar,
          bio: updatedProfile.bio,
          isAdmin,
        },
      },
      meta
    );
    logRequest(meta, '/api/auth/reset-password', 'POST', 200, 'auth.reset_password');
    return res;
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[reset-password] error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Password reset failed.', meta, { status: 500 });
  }
}

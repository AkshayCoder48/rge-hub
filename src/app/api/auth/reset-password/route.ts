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
 *      V4 fallback: honest error (the legacy API has no update path).
 */
import { NextRequest } from 'next/server';
import {
  ONYXBASE_V5_ENABLED,
  v5UpdateAccountPassword,
  registerByEmailPassword,
  backendAcceptsWrites,
} from '@/lib/onyxbase';
import { getProfileByEmail, upsertProfile } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import { verifyResetToken } from '@/lib/otp';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { allow, clientIpFrom } from '@/lib/rate-limit';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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

    // Find the existing profile by email.
    const existingProfile = await getProfileByEmail(normalizedEmail);
    if (!existingProfile) {
      // Don't reveal whether the email exists — generic message.
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.RESET_TOKEN_INVALID, 'No account found with this email address.', meta, {
        status: 400,
      });
    }

    // ─── Password update ────────────────────────────────────────────────────
    // V5 (production): master-authed REAL update on the same account —
    // never the old "re-register" hack that collided with EMAIL_TAKEN.
    let accountUserId: string | undefined;
    let accountApiKey: string | undefined;

    if (ONYXBASE_V5_ENABLED) {
      const upd = await v5UpdateAccountPassword(normalizedEmail, password);
      meta.durationMs = Date.now() - t0;
      if (upd.ok && upd.userId && upd.apiKey) {
        accountUserId = upd.userId;
        accountApiKey = upd.apiKey;
      } else if (upd.code === 'ACCOUNT_NOT_FOUND' || upd.code === 'NOT_FOUND') {
        return fail(ERROR_CODES.RESET_TOKEN_INVALID, 'No account found with this email address.', meta, {
          status: 400,
        });
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
    } else {
      // V4 legacy: the old API has NO password-update path — its register
      // endpoint refuses existing emails (the original bug). Be honest
      // instead of replaying the "already exists" dead end.
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
        // Only possible for an email that did NOT exist — treat as created.
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

    // Keep the profile's apiKey in sync with the freshly minted key.
    if (existingProfile.userId !== accountUserId) {
      console.warn(
        '[reset-password] account id drift:',
        existingProfile.userId,
        '→',
        accountUserId,
        '(keeping profile row)'
      );
    }
    const updatedProfile = {
      ...existingProfile,
      apiKey: accountApiKey!,
      updatedAt: new Date().toISOString(),
    };
    await upsertProfile(updatedProfile);

    // Create a new session.
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

/**
 * POST /api/auth/reset-password  — FIXED (PRD §10).
 *
 * OLD (broken) flow: required `otp:{email}:password_reset` to still exist
 * with `consumed === true` — but verification DELETES the record on
 * success, so the check could never pass; password reset was dead.
 *
 * NEW flow:
 *   1. User requests reset OTP (/api/auth/otp/send, purpose=password_reset)
 *   2. User verifies (/api/auth/otp/verify) → receives a signed resetToken
 *      (HMAC-SHA256, 10-minute TTL, bound to the email)
 *   3. User submits { email, password, resetToken } here.
 *
 * The token is verified SERVER-SIDE against the session secret — no OTP
 * record re-read, no OnyxBase OTP lookup (PRD §3).
 *
 * Password update itself still goes through OnyxBase's native re-register
 * (it mints a fresh apiKey for the account) + profile upsert.
 */
import { NextRequest } from 'next/server';
import { registerByEmailPassword } from '@/lib/onyxbase';
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
        'Your reset link has expired. Please verify a new code and try again.',
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

    // Re-register with OnyxBase to update the password (mints a new apiKey).
    const regResult = await registerByEmailPassword(
      existingProfile.displayName,
      normalizedEmail,
      password
    );
    meta.durationMs = Date.now() - t0;
    if (!regResult.ok || !regResult.apiKey) {
      return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE, regResult.error || 'Password reset failed. Please try again.', meta, {
        status: 502,
        retryable: true,
      });
    }

    // Update the profile with the new API key.
    const updatedProfile = {
      ...existingProfile,
      apiKey: regResult.apiKey,
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

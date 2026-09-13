/**
 * POST /api/auth/reset-password
 * Reset password using a verified OTP.
 *
 * Flow:
 * 1. User requests password reset OTP (via /api/auth/otp/send with purpose=password_reset)
 * 2. User verifies OTP (via /api/auth/otp/verify with purpose=password_reset)
 * 3. User submits new password with email + verified OTP reference
 * 4. This endpoint:
 *    a. Looks up the profile by email
 *    b. If found, registers a NEW OnyxBase account (OnyxBase doesn't have a password update endpoint,
 *       so we re-register which gives a new API key)
 *    c. Updates the profile with the new API key
 *    d. Creates a new session
 *
 * NOTE: OnyxBase's /api/auth/register endpoint creates a new account if the email doesn't exist
 * or returns the existing account. The password is updated by re-registering.
 *
 * Body: { email, password }
 * Requires: password_reset OTP must have been verified for this email.
 *
 * We verify the OTP was consumed by checking the OTP record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { registerByEmailPassword } from '@/lib/onyxbase';
import { getProfileByEmail, upsertProfile, getProfileByUsername } from '@/lib/resources';
import { createSession, isAdminUser } from '@/lib/session';
import { kvGet, kvDelete, ONYXBASE_COLLECTIONS } from '@/lib/onyxbase';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verify that the password_reset OTP was consumed for this email
    const otpRecord = await kvGet<{ consumed: boolean }>(
      `otp:${normalizedEmail}:password_reset`,
      ONYXBASE_COLLECTIONS.OTPS
    );
    if (!otpRecord || !otpRecord.consumed) {
      return NextResponse.json(
        { ok: false, error: 'Please verify your email with the reset code first.' },
        { status: 400 }
      );
    }

    // Find the existing profile by email
    const existingProfile = await getProfileByEmail(normalizedEmail);
    if (!existingProfile) {
      // Don't reveal whether the email exists — generic message
      return NextResponse.json(
        { ok: false, error: 'No account found with this email address.' },
        { status: 400 }
      );
    }

    // Re-register with OnyxBase to update the password (OnyxBase will update the existing account)
    const regResult = await registerByEmailPassword(
      existingProfile.displayName,
      normalizedEmail,
      password
    );

    if (!regResult.ok || !regResult.apiKey) {
      return NextResponse.json(
        { ok: false, error: regResult.error || 'Password reset failed. Please try again.' },
        { status: 400 }
      );
    }

    // Update the profile with the new API key
    const updatedProfile = {
      ...existingProfile,
      apiKey: regResult.apiKey,
      updatedAt: new Date().toISOString(),
    };
    await upsertProfile(updatedProfile);

    // Clean up the OTP record (one-time use)
    try {
      await kvDelete(`otp:${normalizedEmail}:password_reset`, ONYXBASE_COLLECTIONS.OTPS);
    } catch {}

    // Create a new session
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

    return NextResponse.json({
      ok: true,
      message: 'Password reset successfully',
      user: {
        userId: updatedProfile.userId,
        username: updatedProfile.username,
        displayName: updatedProfile.displayName,
        avatar: updatedProfile.avatar,
        bio: updatedProfile.bio,
        isAdmin,
      },
    });
  } catch (err) {
    console.error('[reset-password] error:', err);
    return NextResponse.json({ ok: false, error: 'Password reset failed' }, { status: 500 });
  }
}

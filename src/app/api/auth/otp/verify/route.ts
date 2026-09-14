/**
 * POST /api/auth/otp/verify
 * Verifies the OTP code for an email.
 * Checks: existence, expiry, attempts, consumed state, hash match.
 *
 * Body: { email, code, purpose? }
 * purpose: "registration" (default) | "password_reset"
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, type OtpPurpose } from '@/lib/otp';
import { backendAcceptsWrites } from '@/lib/onyxbase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email, code, purpose } = await request.json();
    if (!email || !code) {
      return NextResponse.json({ ok: false, error: 'Email and code required' }, { status: 400 });
    }

    // Circuit breaker: fail in seconds when the backend is drowning in
    // Telegram 429s — never grind minutes into a timeout.
    if (!(await backendAcceptsWrites())) {
      return NextResponse.json(
        { ok: false, error: 'Servers are busy — please retry in a minute.', retryable: true },
        { status: 503 }
      );
    }
    const otpPurpose: OtpPurpose = purpose === 'password_reset' ? 'password_reset' : 'registration';
    const result = await verifyOtp(email, code, otpPurpose);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: 'Email verified' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 500 });
  }
}

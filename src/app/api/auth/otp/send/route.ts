/**
 * POST /api/auth/otp/send
 * Sends a 6-digit OTP to the provided email.
 * The OTP is stored in OnyxBase KV with 10-min expiry, keyed by email+purpose.
 *
 * Body: { email, purpose? }
 * purpose: "registration" (default) | "password_reset"
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendOtp, type OtpPurpose } from '@/lib/otp';
import { backendAcceptsWrites } from '@/lib/onyxbase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email, purpose } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ ok: false, error: 'Valid email required' }, { status: 400 });
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
    const result = await sendOtp(email, otpPurpose);
    if (!result.ok) {
      const busy = /busy|timed out/i.test(result.error || '');
      return NextResponse.json(
        { ok: false, error: result.error, retryable: true },
        { status: busy ? 503 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.alreadySent ? 'Code already sent — check your inbox' : 'Verification code sent',
      alreadySent: result.alreadySent === true,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to send OTP' }, { status: 500 });
  }
}

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

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email, purpose } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ ok: false, error: 'Valid email required' }, { status: 400 });
    }

    const otpPurpose: OtpPurpose = purpose === 'password_reset' ? 'password_reset' : 'registration';
    const result = await sendOtp(email, otpPurpose);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: 'Verification code sent' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to send OTP' }, { status: 500 });
  }
}

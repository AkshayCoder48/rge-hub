/**
 * POST /api/auth/otp/send
 * Sends a 6-digit OTP to the provided email.
 * Body: { email }
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendOtp } from '@/lib/otp';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ ok: false, error: 'Valid email required' }, { status: 400 });
    }

    const result = await sendOtp(email);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: 'Verification code sent' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to send OTP' }, { status: 500 });
  }
}

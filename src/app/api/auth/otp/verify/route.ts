/**
 * POST /api/auth/otp/verify
 * Verifies the OTP code for an email.
 * Body: { email, code }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/otp';

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();
    if (!email || !code) {
      return NextResponse.json({ ok: false, error: 'Email and code required' }, { status: 400 });
    }

    const result = await verifyOtp(email, code);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: 'Email verified' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 500 });
  }
}

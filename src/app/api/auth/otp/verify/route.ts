/**
 * POST /api/auth/otp/verify  — REWRITTEN (PRD §3, §4, §8).
 *
 * Verifies the code against the AI SENSE temp record (by otpRef, or the
 * email→ref fallback when the page was refreshed). OnyxBase is never
 * queried to verify an OTP.
 *
 * Body: { email, code, purpose?, otpRef? }
 *
 * Responses (fast contract):
 *   200 success — { data: { verified: true, resetToken? } }
 *   400 OTP_INVALID / OTP_EXPIRED / OTP_NOT_FOUND / OTP_ATTEMPTS_EXCEEDED
 *       — wrong-code responses carry the UPDATED otpRef (attempt counter
 *         is a new temp record) so the client retries with it.
 *   429 rate limited (30 verification attempts / 15 min / email).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, type OtpPurpose } from '@/lib/otp';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { allow } from '@/lib/rate-limit';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const purpose: OtpPurpose = body?.purpose === 'password_reset' ? 'password_reset' : 'registration';
    const otpRef = typeof body?.otpRef === 'string' ? body.otpRef : undefined;
    if (!email || !code) {
      meta.durationMs = Date.now() - t0;
      const res = fail(ERROR_CODES.VALIDATION_ERROR, 'Email and code are required.', meta, { status: 400 });
      logRequest(meta, '/api/auth/otp/verify', 'POST', 400, 'otp.verify');
      return res;
    }
    const normalizedEmail = email.toLowerCase().trim();

    // Verification rate limit — generous (typing mistakes are normal),
    // bounded (the record itself dies after 5 wrong attempts).
    const rl = allow(`otp:verify:${normalizedEmail}`, 30, 15 * 60_000);
    if (!rl.allowed) {
      meta.durationMs = Date.now() - t0;
      const res = fail(
        ERROR_CODES.RATE_LIMITED,
        'Too many verification attempts. Please wait a moment.',
        meta,
        { status: 429, retryable: true, retryAfterSecs: rl.retryAfterSecs }
      );
      logRequest(meta, '/api/auth/otp/verify', 'POST', 429, 'otp.verify.rate_limited');
      return res;
    }

    const result = await verifyOtp(normalizedEmail, code, purpose, otpRef);
    meta.durationMs = Date.now() - t0;

    if (!result.ok) {
      // Wrong-code responses rotate the temp record; hand the client the
      // new otpRef so its next attempt hits the updated attempt counter.
      const errorBody: Record<string, unknown> = {
        code: result.errorCode || ERROR_CODES.OTP_INVALID,
        message: result.error || 'Invalid code',
        ...(result.otpRef ? { otpRef: result.otpRef } : {}),
        ...(result.remainingAttempts !== undefined ? { remainingAttempts: result.remainingAttempts } : {}),
      };
      const res = NextResponse.json(
        { success: false, error: errorBody, requestId },
        { status: 400, headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } }
      );
      logRequest(meta, '/api/auth/otp/verify', 'POST', 400, 'otp.verify.invalid', {
        errorCode: result.errorCode,
        remainingAttempts: result.remainingAttempts,
      });
      return res;
    }

    const res = ok(
      {
        verified: true,
        purpose,
        ...(purpose === 'password_reset' && result.resetToken ? { resetToken: result.resetToken } : {}),
      },
      meta
    );
    logRequest(meta, '/api/auth/otp/verify', 'POST', 200, 'otp.verify.success');
    return res;
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[otp/verify] error:', err instanceof Error ? err.message : err);
    const res = fail(ERROR_CODES.INTERNAL_ERROR, 'Verification failed.', meta, { status: 500 });
    logRequest(meta, '/api/auth/otp/verify', 'POST', 500, 'otp.verify.error');
    return res;
  }
}

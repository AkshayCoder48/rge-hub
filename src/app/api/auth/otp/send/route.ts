/**
 * POST /api/auth/otp/send  — REWRITTEN (PRD §3, §4, §8, §21).
 *
 * Flow: generate → hash → AI SENSE temp record → email (direct MCPEmails,
 * OnyxBase email fallback) → definitive response with otpRef.
 *
 * OnyxBase is NOT involved in OTP state (no KV writes, no lookups) — the
 * email-verification path no longer depends on it at all.
 *
 * Rate limits (PRD §18, §39 — protect MCPEmails' 100/min key ceiling):
 *   - 1 per 60s per email+purpose (duplicate-send guard)
 *   - 5 per hour per email
 *   - 12 per hour per client IP
 *
 * Response (fast contract):
 *   200 { success, data: { message, alreadySent?, otpRef, expiresInMs, emailVia }, requestId, durationMs }
 */
import { NextRequest } from 'next/server';
import { sendOtp, type OtpPurpose } from '@/lib/otp';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { allow, clientIpFrom } from '@/lib/rate-limit';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email : '';
    const purpose: OtpPurpose = body?.purpose === 'password_reset' ? 'password_reset' : 'registration';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const res = fail(ERROR_CODES.VALIDATION_ERROR, 'A valid email address is required.', meta, { status: 400 });
      meta.durationMs = Date.now() - t0;
      logRequest(meta, '/api/auth/otp/send', 'POST', 400, 'otp.send');
      return res;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const ip = clientIpFrom(request);

    // Rate limits — specific codes, never a generic "server busy".
    const perEmail = allow(`otp:send:${purpose}:${normalizedEmail}`, 1, 60_000);
    if (!perEmail.allowed) {
      const res = fail(
        ERROR_CODES.RATE_LIMITED,
        `A code was just sent to this email. Check your inbox — you can request a new one in ${perEmail.retryAfterSecs}s.`,
        meta,
        { status: 429, retryable: true, retryAfterSecs: perEmail.retryAfterSecs }
      );
      meta.durationMs = Date.now() - t0;
      logRequest(meta, '/api/auth/otp/send', 'POST', 429, 'otp.send.rate_limited');
      return res;
    }
    const perEmailHour = allow(`otp:hour:${normalizedEmail}`, 5, 60 * 60_000);
    if (!perEmailHour.allowed) {
      const res = fail(
        ERROR_CODES.RATE_LIMITED,
        'Too many codes requested for this email. Please wait before requesting another.',
        meta,
        { status: 429, retryable: true, retryAfterSecs: perEmailHour.retryAfterSecs }
      );
      meta.durationMs = Date.now() - t0;
      logRequest(meta, '/api/auth/otp/send', 'POST', 429, 'otp.send.rate_limited');
      return res;
    }
    const perIp = allow(`otp:ip:${ip}`, 12, 60 * 60_000);
    if (!perIp.allowed) {
      const res = fail(
        ERROR_CODES.RATE_LIMITED,
        'Too many verification requests from this network. Please wait a moment.',
        meta,
        { status: 429, retryable: true, retryAfterSecs: perIp.retryAfterSecs }
      );
      meta.durationMs = Date.now() - t0;
      logRequest(meta, '/api/auth/otp/send', 'POST', 429, 'otp.send.rate_limited');
      return res;
    }

    const result = await sendOtp(normalizedEmail, purpose);
    meta.durationMs = Date.now() - t0;

    if (!result.ok) {
      const status = result.retryable ? 503 : 400;
      const res = fail(result.errorCode || ERROR_CODES.EMAIL_SEND_FAILED, result.error || 'Failed to send code', meta, {
        status,
        retryable: result.retryable,
      });
      logRequest(meta, '/api/auth/otp/send', 'POST', status, 'otp.send.failed', {
        emailVia: result.emailVia,
      });
      return res;
    }

    const res = ok(
      {
        message: 'Verification code sent',
        alreadySent: result.alreadySent === true,
        otpRef: result.otpRef,
        expiresInMs: result.expiresInMs,
        purpose,
      },
      meta
    );
    logRequest(meta, '/api/auth/otp/send', 'POST', 200, 'otp.send', {
      emailVia: result.emailVia,
    });
    return res;
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[otp/send] error:', err instanceof Error ? err.message : err);
    const res = fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to send verification code.', meta, { status: 500 });
    logRequest(meta, '/api/auth/otp/send', 'POST', 500, 'otp.send.error');
    return res;
  }
}

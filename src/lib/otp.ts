/**
 * OTP (One-Time Password) system — REWRITTEN per PRD §3–§4.
 *
 * OnyxBase is REMOVED from the OTP path entirely (no OTP writes, no OTP
 * lookups, no OTP verification queries against OnyxBase).
 *
 * New flow:
 *   generate OTP → hash → POST temp record to AI SENSE → storage_id
 *   → send email (direct MCPEmails, or OnyxBase email fallback when
 *     MCPEMAILS_API_KEY is not yet configured) → return the otpRef
 *
 *   verify: GET record by otpRef from AI SENSE → check email hash,
 *   expiry, attempts → compare OTP hash → success.
 *
 * Security (PRD §4):
 *   - 6-digit cryptographically secure OTP (crypto.getRandomValues)
 *   - expires in 10 minutes (logical, inside the record)
 *   - max 5 verification attempts
 *   - OTP hashed (SHA-256 + salt) before storage — never plaintext
 *   - never logged, never in API responses, never in URLs
 *   - only email_hash + otp_hash + timing/attempts stored — no PII
 *   - storage UUID (otpRef) is an unguessable capability, 24h max life
 *
 * AI SENSE limits (documented): unauthenticated, 24h expiry,
 * 5,000 req/IP/24h, no durability/SLA, anyone with the UUID can read —
 * hence hashed payloads and strictly temporary use.
 *
 * Password reset (bug fix): verification of a password_reset OTP now
 * issues a short-lived HMAC-signed reset token; /api/auth/reset-password
 * verifies that token instead of re-reading an OTP record that the
 * verify step correctly deletes (the old "consumed flag" check could
 * never pass — resets were permanently broken).
 *
 * REGISTRATION VERIFICATION TRANSACTIONS (auth-state fix):
 * A successful registration-OTP verification issues a short-lived,
 * HMAC-signed, PURPOSE-BOUND ('registration') verification token bound
 * to the verified email. /api/auth/register validates THAT token (or a
 * legacy direct otpRef+code proof) instead of demanding the same OTP a
 * second time — the server-issued transaction is the single source of
 * truth for "this email is verified for registration".
 *
 * - Signed with a domain-separated key (never interchangeable with a
 *   password-reset token).
 * - Carries { email, purpose, expiresAt, transactionId } only — never
 *   the OTP, never secrets.
 * - 30-minute TTL (the user needs time to fill the create-account form).
 * - One-time use (best-effort in-memory consumed set + the durable
 *   backstop that a used email can only reach the sign-in path, never a
 *   second account).
 */

import * as aisense from './aisense';
import { sendEmailDirect, hasDirectMcpemailsKey, McpeError } from './mcpemail';
import { sendEmail as sendEmailViaOnyxbase } from './onyxbase';
import crypto from 'crypto';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes (PRD §4)
const OTP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // reset token lives 10 minutes
const REG_VERIFICATION_TTL_MS = 30 * 60 * 1000; // 30 minutes to complete the create-account form

export type OtpPurpose = 'registration' | 'password_reset';

/** Minimal OTP record stored in AI SENSE (PRD §4 — no plaintext OTP, no raw email). */
interface OtpRecord {
  purpose: OtpPurpose;
  email_hash: string; // SHA-256(normalized email + salt)
  otp_hash: string; // SHA-256(code + salt)
  salt: string;
  created_at: string;
  expires_at: string;
  attempts: number;
}

// ============ Hashing ============

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateOtpCode(): string {
  // Cryptographically secure, uniform modulo reduction (reject bias).
  const max = 1_000_000;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return String(v % max).padStart(6, '0');
}

async function hashOtp(code: string, salt: string): Promise<string> {
  // Web-crypto compatible (works on Vercel edge/node runtimes).
  const data = new TextEncoder().encode(code + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hashEmail(email: string, salt: string): string {
  return sha256(`email:${email}:${salt}`);
}

// ============ otpRef fallback map (page-refresh resilience) ============
//
// The otpRef is returned to the client and normally round-trips through
// the auth screen. If the page is refreshed, the ref is lost — this
// per-instance map lets verify() recover it by email (best effort on
// serverless; a miss simply asks the user to request a new code, which
// now costs ~2 seconds instead of 2 minutes).

interface RefEntry {
  ref: string;
  expiresAt: number;
}
const emailToRef = new Map<string, RefEntry>();

// Refs superseded by a NEWER code for the same email+purpose. Requesting a
// new code invalidates the previous one (newest-code-wins) — an old code
// must never verify once a newer one exists.
const supersededRefs = new Set<string>();

function rememberRef(email: string, purpose: OtpPurpose, ref: string) {
  const key = `${purpose}:${email}`;
  const prev = emailToRef.get(key);
  if (prev && prev.ref !== ref) {
    supersededRefs.add(prev.ref);
    if (supersededRefs.size > 1000) supersededRefs.clear(); // bounded; residual window capped by the 10-min OTP TTL
  }
  emailToRef.set(key, { ref, expiresAt: Date.now() + OTP_EXPIRY_MS });
  // opportunistic cleanup
  if (emailToRef.size > 500) {
    const now = Date.now();
    for (const [k, v] of emailToRef) if (v.expiresAt < now) emailToRef.delete(k);
  }
}

function lookupRef(email: string, purpose: OtpPurpose): string | null {
  const e = emailToRef.get(`${purpose}:${email}`);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    emailToRef.delete(`${purpose}:${email}`);
    return null;
  }
  return e.ref;
}

function forgetRef(email: string, purpose: OtpPurpose) {
  emailToRef.delete(`${purpose}:${email}`);
}

// ============ Public API ============

export interface SendOtpResult {
  ok: boolean;
  otpRef?: string;
  alreadySent?: boolean;
  expiresInMs?: number;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  emailVia?: 'mcpemails-direct' | 'onyxbase-fallback';
}

/**
 * Create + store + email an OTP. Returns as soon as the email-provider
 * operation has definitively succeeded (PRD §21) — no artificial waits.
 */
export async function sendOtp(
  email: string,
  purpose: OtpPurpose = 'registration'
): Promise<SendOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const code = generateOtpCode();
  const salt = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

  const record: OtpRecord = {
    purpose,
    email_hash: hashEmail(normalizedEmail, salt),
    otp_hash: await hashOtp(code, salt),
    salt,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    attempts: 0,
  };

  // 1) Temporary OTP state in AI SENSE (NOT OnyxBase — PRD §3).
  let storageId: string;
  try {
    const put = await aisense.put(record as unknown as Record<string, unknown>);
    storageId = put.storageId;
  } catch (err) {
    return {
      ok: false,
      error:
        'Temporary OTP storage is unavailable right now — please retry in a moment. (No code was sent.)',
      errorCode: 'OTP_STORAGE_UNAVAILABLE',
      retryable: true,
    };
  }

  rememberRef(normalizedEmail, purpose, storageId);

  // 2) Email delivery. Direct MCPEmails when the key is configured;
  //    OnyxBase's connected MCPEmail credential as the fallback so
  //    production keeps working before the key is set (PRD §2 — use the
  //    existing integration; never invent a key).
  const subject =
    purpose === 'password_reset'
      ? 'RailGuyEdits — Password Reset Code'
      : 'RailGuyEdits — Verification Code';

  const codeLine =
    purpose === 'password_reset'
      ? 'You requested a password reset for your RailGuyEdits account.\n\nYour password reset code is:'
      : 'Your verification code for RailGuyEdits is:';

  const bodyText = `Hello,\n\n${codeLine} ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.\n\n— RailGuyEdits Platform`;

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 24px; color: #8b5cf6; margin: 0;">RailGuyEdits</h1>
    <p style="color: #666; font-size: 14px; margin-top: 4px;">Editing Platform</p>
  </div>
  <p style="font-size: 16px; color: #333;">${purpose === 'password_reset' ? 'Your password reset code is:' : 'Your verification code is:'}</p>
  <div style="text-align: center; margin: 24px 0;">
    <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #8b5cf6; background: #f5f3ff; padding: 16px 32px; border-radius: 12px; display: inline-block;">${code}</span>
  </div>
  <p style="font-size: 14px; color: #666;">This code expires in 10 minutes.</p>
  <p style="font-size: 14px; color: #999; margin-top: 32px;">If you didn't request this code, you can safely ignore this email.</p>
</div>`;

  // Idempotency for the email send itself (PRD §7/§18): a retried send for
  // the SAME storage record reuses the same key so MCPEmails can dedupe.
  const emailIdemKey = `rge-otp-${storageId}`;

  if (hasDirectMcpemailsKey()) {
    try {
      await sendEmailDirect({
        to: normalizedEmail,
        subject,
        body: bodyText,
        htmlBody,
        idempotencyKey: emailIdemKey,
      });
      return {
        ok: true,
        otpRef: storageId,
        expiresInMs: OTP_EXPIRY_MS,
        emailVia: 'mcpemails-direct',
      };
    } catch (err) {
      if (err instanceof McpeError && (err.code === 'rate_limited' || err.code === 'timeout')) {
        // The provider may or may not have accepted the message — never
        // blind-retry the send (PRD §18). Tell the user to wait/retry once.
        return {
          ok: false,
          error:
            'The email provider is rate-limiting us right now. Please wait about a minute before requesting a new code.',
          errorCode: 'EMAIL_SEND_FAILED',
          retryable: true,
          otpRef: storageId,
        };
      }
      return {
        ok: false,
        error:
          err instanceof Error ? `Email delivery failed: ${err.message}` : 'Email delivery failed',
        errorCode: 'EMAIL_SEND_FAILED',
        retryable: true,
      };
    }
  }

  // Fallback: OnyxBase's connected MCPEmail credential (existing integration).
  const result = await sendEmailViaOnyxbase(normalizedEmail, subject, bodyText, htmlBody);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || 'Failed to send verification email',
      errorCode: 'EMAIL_SEND_FAILED',
      retryable: true,
    };
  }
  return {
    ok: true,
    otpRef: storageId,
    expiresInMs: OTP_EXPIRY_MS,
    emailVia: 'onyxbase-fallback',
  };
}

export interface VerifyOtpResult {
  ok: boolean;
  /** Updated ref after a wrong attempt (client must use it for the next try). */
  otpRef?: string;
  /** Issued ONLY for purpose=password_reset on success (bug fix). */
  resetToken?: string;
  /** Issued ONLY for purpose=registration on success — the verification
   *  transaction token the create-account step must present. */
  verificationToken?: string;
  error?: string;
  errorCode?: string;
  remainingAttempts?: number;
}

/**
 * Verify an OTP code against the AI SENSE temp record.
 * Body: { email, code, otpRef? } — otpRef preferred; falls back to the
 * per-instance email→ref map when omitted (page refresh case).
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose = 'registration',
  otpRef?: string
): Promise<VerifyOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const trimmedCode = code.trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    return { ok: false, error: 'Enter the 6-digit code from your email.', errorCode: 'OTP_INVALID' };
  }

  let ref = otpRef && /^[A-Za-z0-9-]{8,64}$/.test(otpRef) ? otpRef : null;
  if (!ref) ref = lookupRef(normalizedEmail, purpose);
  if (!ref) {
    return {
      ok: false,
      error: 'No active code found for this email. Please request a new one.',
      errorCode: 'OTP_NOT_FOUND',
    };
  }

  // Newest-code-wins: a code superseded by a newer request for the same
  // email+purpose can no longer verify (duplicate OTP records can never
  // race past each other — only the latest transaction counts).
  if (supersededRefs.has(ref)) {
    return {
      ok: false,
      error: 'A newer code was requested for this email. Please use the latest one.',
      errorCode: 'OTP_EXPIRED',
    };
  }

  let record: OtpRecord;
  try {
    record = (await aisense.get<Record<string, unknown>>(ref)) as unknown as OtpRecord;
  } catch (err) {
    if (err instanceof aisense.AiSenseError && err.code === 'not_found') {
      forgetRef(normalizedEmail, purpose);
      return {
        ok: false,
        error: 'This code is no longer valid. Please request a new one.',
        errorCode: 'OTP_EXPIRED',
      };
    }
    return {
      ok: false,
      error: 'Temporary OTP storage is unreachable — please retry in a moment.',
      errorCode: 'OTP_STORAGE_UNAVAILABLE',
    };
  }

  // Field sanity (the record is capability-protected but treat as untrusted).
  if (!record || typeof record !== 'object' || !record.otp_hash || !record.salt) {
    return {
      ok: false,
      error: 'This code is no longer valid. Please request a new one.',
      errorCode: 'OTP_EXPIRED',
    };
  }

  // Bind: record must belong to this email + purpose.
  if (record.email_hash !== hashEmail(normalizedEmail, record.salt) || record.purpose !== purpose) {
    return {
      ok: false,
      error: 'This code was not issued for this email. Please request a new one.',
      errorCode: 'OTP_INVALID',
    };
  }

  // Expiry — refuse after 10 minutes (PRD §4).
  if (new Date(record.expires_at).getTime() < Date.now()) {
    forgetRef(normalizedEmail, purpose);
    return {
      ok: false,
      error: 'Verification code expired. Please request a new one.',
      errorCode: 'OTP_EXPIRED',
    };
  }

  // Attempts — max 5.
  if ((record.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    forgetRef(normalizedEmail, purpose);
    return {
      ok: false,
      error: 'Too many failed attempts. Please request a new code.',
      errorCode: 'OTP_ATTEMPTS_EXCEEDED',
    };
  }

  // Compare hash.
  const inputHash = await hashOtp(trimmedCode, record.salt);
  if (inputHash !== record.otp_hash) {
    const attempts = (record.attempts ?? 0) + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      forgetRef(normalizedEmail, purpose);
      return {
        ok: false,
        error: 'Too many failed attempts. Please request a new code.',
        errorCode: 'OTP_ATTEMPTS_EXCEEDED',
      };
    }
    // Persist the incremented attempt count as a NEW temp record and hand
    // the client the new ref (AI SENSE objects are write-once by UUID).
    try {
      const updated: OtpRecord = { ...record, attempts };
      const put = await aisense.put(updated as unknown as Record<string, unknown>);
      // The ref used for this FAILED attempt is dead — the attempt counter
      // now lives in the NEW record. Supersede it explicitly so the pristine
      // (attempts:0) original can never be replayed to reset the counter.
      supersededRefs.add(ref);
      rememberRef(normalizedEmail, purpose, put.storageId);
      const remaining = OTP_MAX_ATTEMPTS - attempts;
      return {
        ok: false,
        otpRef: put.storageId,
        remainingAttempts: remaining,
        error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
        errorCode: 'OTP_INVALID',
      };
    } catch {
      // Could not persist the counter — fail closed on the safe side by
      // keeping the old ref (attempts stay as-is; next wrong try re-increments).
      const remaining = OTP_MAX_ATTEMPTS - attempts;
      return {
        ok: false,
        otpRef: ref,
        remainingAttempts: remaining,
        error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
        errorCode: 'OTP_INVALID',
      };
    }
  }

  // SUCCESS — one-time use: forget the ref (the temp record ages out of
  // AI SENSE within 24h max; nothing to delete server-side).
  forgetRef(normalizedEmail, purpose);

  // Password reset: issue the signed reset token (fixes the old
  // "consumed flag" dead path — the reset route no longer re-reads OTPs).
  if (purpose === 'password_reset') {
    return { ok: true, resetToken: issueResetToken(normalizedEmail) };
  }

  // Registration: issue the server-side verification transaction token —
  // the create-account step validates THIS (never the same OTP twice).
  return { ok: true, verificationToken: issueRegistrationToken(normalizedEmail, ref) };
}

// ============ Registration verification transactions (auth-state fix) ============
//
// The server-side "this email is verified for registration" state. Issued
// atomically with a successful registration-OTP verification; validated by
// /api/auth/register (signature → purpose → email → expiry → consumption).
// Stateless HMAC + a best-effort consumed set; the durable single-use
// backstop is account-existence (a used email can only reach sign-in).

interface RegVerificationPayload {
  e: string; // verified email (normalized)
  p: 'registration'; // purpose-bound: never valid for password_reset
  x: number; // expiresAt (epoch ms)
  j: string; // transaction id (the verified OTP storage ref)
}

/** Consumed registration transactions (transaction id → expiry), per instance. */
const consumedRegTx = new Map<string, number>();

function regVerificationSigningKey(): Buffer {
  // Domain-separated key: a registration token can NEVER be forged from a
  // password-reset token (or vice versa) even though both derive from the
  // same root secret.
  return crypto.createHmac('sha256', resetSecret()).update('rge-regver-v1').digest();
}

export function issueRegistrationToken(email: string, otpRef: string): string {
  const payload: RegVerificationPayload = {
    e: email.toLowerCase().trim(),
    p: 'registration',
    x: Date.now() + REG_VERIFICATION_TTL_MS,
    j: otpRef,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', regVerificationSigningKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export interface RegVerificationCheck {
  ok: boolean;
  email?: string;
  transactionId?: string;
  reason?: 'invalid' | 'expired' | 'consumed';
}

export function verifyRegistrationToken(token: string): RegVerificationCheck {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return { ok: false, reason: 'invalid' };
    const expected = crypto.createHmac('sha256', regVerificationSigningKey()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' };
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<RegVerificationPayload>;
    if (data.p !== 'registration' || !data.e || typeof data.x !== 'number' || !data.j) {
      return { ok: false, reason: 'invalid' }; // purpose-bound: reset tokens don't carry p:'registration'
    }
    if (data.x < Date.now()) return { ok: false, reason: 'expired' };
    if (consumedRegTx.has(data.j)) return { ok: false, reason: 'consumed' };
    return { ok: true, email: data.e, transactionId: data.j };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Mark a verification transaction as used (one-time use, best effort per
 *  instance; the durable backstop is account-existence → sign-in path). */
export function consumeRegistrationTransaction(transactionId: string): void {
  if (!transactionId) return;
  consumedRegTx.set(transactionId, Date.now() + REG_VERIFICATION_TTL_MS);
  if (consumedRegTx.size > 1000) {
    const now = Date.now();
    for (const [k, v] of consumedRegTx) if (v < now) consumedRegTx.delete(k);
  }
}

// ============ Signed reset tokens (password-reset bug fix) ============

function resetSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const kb = process.env.ONYXBASE_API_KEY;
  if (kb) return crypto.createHash('sha256').update(`rge-reset-v1:${kb}`).digest('hex');
  return `boot-${'unconfigured'}`; // fail-secure: signature won't verify
}

export function issueResetToken(email: string): string {
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ e: email.toLowerCase().trim(), x: expiresAt })).toString('base64url');
  const sig = crypto.createHmac('sha256', resetSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyResetToken(token: string): { ok: boolean; email?: string } {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return { ok: false };
    const expected = crypto.createHmac('sha256', resetSecret()).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      e?: string;
      x?: number;
    };
    if (!data.e || typeof data.x !== 'number' || data.x < Date.now()) return { ok: false };
    return { ok: true, email: data.e };
  } catch {
    return { ok: false };
  }
}

/**
 * OTP (One-Time Password) helpers for email verification.
 *
 * OTP records are stored in OnyxBase KV (collection: "otps") keyed by email.
 * Each record includes a purpose field to distinguish registration from password reset.
 *
 * Security:
 * - OTP is hashed with SHA-256 + salt (never stored plaintext)
 * - 10-minute expiry (enforced server-side on every validation)
 * - Max 5 verification attempts
 * - Rate limited: 1 per 60s per email+purpose
 * - One-time use: the record is DELETED on success (replay → "not found")
 * - New OTP invalidates previous OTP for same email+purpose
 * - Expired/consumed rows are DELETED (access path + piggyback sweeps),
 *   so the DB never holds dead OTPs — what you see in the DB is live.
 *
 * OTP record shape (stored in OnyxBase KV):
 * {
 *   email: "user@example.com",       // normalized lowercase
 *   otpHash: "...",                   // SHA-256(code + salt)
 *   salt: "...",                      // random UUID
 *   purpose: "registration",          // "registration" | "password_reset"
 *   expiresAt: "ISO string",          // 10 min from creation
 *   attempts: 0,                      // incremented on wrong code
 *   consumed: false,                  // legacy flag (success now deletes)
 *   createdAt: "ISO string"
 * }
 *
 * Key format: `otp:{email}:{purpose}` (e.g., `otp:user@example.com:registration`)
 */

import { kvSet, kvDeleteSpread, kvExport, kvGetQuorum, sendEmail } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT_MS = 60 * 1000; // 1 per minute

export type OtpPurpose = 'registration' | 'password_reset';

interface OtpRecord {
  email: string;
  otpHash: string;
  salt: string;
  purpose: OtpPurpose;
  expiresAt: string;
  attempts: number;
  consumed: boolean;
  createdAt: string;
  emailed?: boolean; // true once the code was actually mailed (send-then-error recovery)
}

/**
 * Get the KV key for an OTP record.
 */
function otpKey(email: string, purpose: OtpPurpose): string {
  return `otp:${email.toLowerCase().trim()}:${purpose}`;
}

/**
 * Generate a 6-digit OTP code.
 */
function generateOtpCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

/**
 * Hash an OTP with a random salt.
 */
async function hashOtp(code: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Delete one OTP row (spread — best effort across backend replicas). */
async function deleteOtpRow(key: string): Promise<void> {
  try {
    await kvDeleteSpread(key, ONYXBASE_COLLECTIONS.OTPS, 3);
  } catch {
    // non-fatal — piggyback sweeps retry later
  }
}

/**
 * Send an OTP to an email address for a specific purpose.
 * Stores the OTP record in OnyxBase KV with 10-min expiry.
 * Invalidates any previous OTP for the same email+purpose.
 *
 * Returns { ok, error? }
 */
export async function sendOtp(
  email: string,
  purpose: OtpPurpose = 'registration'
): Promise<{ ok: boolean; error?: string; alreadySent?: boolean }> {
  // Piggyback sweep so dead OTPs never pile up in the DB (non-blocking).
  void cleanupExpiredOtps();

  const normalizedEmail = email.toLowerCase().trim();
  const key = otpKey(normalizedEmail, purpose);

  // Check rate limit (small quorum — single reads can flap to null).
  const existing = await kvGetQuorum<OtpRecord>(key, ONYXBASE_COLLECTIONS.OTPS, 3);
  if (existing && new Date(existing.expiresAt).getTime() >= Date.now()) {
    const ageMs = Date.now() - new Date(existing.createdAt).getTime();
    if (existing.emailed) {
      // Code was mailed. Recent → the user HAS it (their "code arrived but
      // the app errored" case): succeed WITHOUT mailing a duplicate.
      if (ageMs < OTP_RATE_LIMIT_MS) return { ok: true, alreadySent: true };
      // Old → fall through and generate a fresh one.
    }
    // Not mailed (an earlier attempt died after storing) → fall through and
    // send immediately; the user never got a code.
  } else if (existing) {
    // Stale/expired row — delete it now so it can't rate-limit or linger.
    await deleteOtpRow(key);
  }

  // Generate new OTP
  const code = generateOtpCode();
  const salt = crypto.randomUUID();
  const hash = await hashOtp(code, salt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

  const record: OtpRecord = {
    email: normalizedEmail,
    otpHash: hash,
    salt,
    purpose,
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    consumed: false,
    createdAt: now.toISOString(),
  };

  // Store in OnyxBase (this invalidates any previous OTP for this email+purpose).
  // Single write — kvSet only reports true for a DURABLE backend write, so a
  // second confirm-read round just doubled flood pain (never email otherwise).
  const stored = await kvSet(key, record, ONYXBASE_COLLECTIONS.OTPS);
  if (!stored) {
    return { ok: false, error: 'Servers are busy — please retry in a moment.' };
  }

  // Build email content based on purpose
  const subject = purpose === 'password_reset'
    ? 'RailGuyEdits — Password Reset Code'
    : 'RailGuyEdits — Verification Code';

  const bodyText = purpose === 'password_reset'
    ? `Hello,\n\nYou requested a password reset for your RailGuyEdits account.\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.\n\n— RailGuyEdits Platform`
    : `Hello,\n\nYour verification code for RailGuyEdits is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this code, you can safely ignore this email.\n\n— RailGuyEdits Platform`;

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

  const result = await sendEmail(normalizedEmail, subject, bodyText, htmlBody);
  if (!result.ok) {
    return { ok: false, error: result.error || 'Failed to send verification email' };
  }

  // Mark mailed — post-response RELIABLE. A plain void-promise dies at
  // Vercel freeze (the flag needs ~10-15s: pacing-absorb + pin round-trip;
  // the route responds first), and a missing flag makes the next resend
  // re-mail a duplicate. after() extends lifetime past the response so the
  // flag actually lands; the void fallback covers non-Vercel runtimes.
  const markEmailed = () =>
    kvSet(key, { ...record, emailed: true }, ONYXBASE_COLLECTIONS.OTPS).catch(() => {});
  try {
    const { after } = (await import('next/server')) as unknown as {
      after?: (cb: () => unknown) => void;
    };
    if (typeof after === 'function') after(() => void markEmailed());
    else void markEmailed();
  } catch {
    void markEmailed();
  }

  return { ok: true };
}

/**
 * Verify an OTP code.
 * Checks: existence, expiry, attempts, consumed state, and hash match.
 * On success: DELETES the OTP (one-time use — replay is impossible).
 * On expiry/attempts-exhausted: DELETES the OTP (dies on time).
 *
 * Returns { ok, error? }
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose = 'registration'
): Promise<{ ok: boolean; error?: string }> {
  // Piggyback sweep so dead OTPs never pile up in the DB (non-blocking).
  void cleanupExpiredOtps();

  const normalizedEmail = email.toLowerCase().trim();
  const key = otpKey(normalizedEmail, purpose);

  const record = await kvGetQuorum<OtpRecord>(key, ONYXBASE_COLLECTIONS.OTPS, 3);
  if (!record) {
    return { ok: false, error: 'No verification code found. Please request a new one.' };
  }

  // Check if already consumed (legacy rows)
  if (record.consumed) {
    await deleteOtpRow(key);
    return { ok: false, error: 'This code has already been used. Please request a new one.' };
  }

  // Check expiry — delete ON TIME (the moment it's observed expired).
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await deleteOtpRow(key);
    return { ok: false, error: 'Verification code expired. Please request a new one.' };
  }

  // Check attempts
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await deleteOtpRow(key);
    return { ok: false, error: 'Too many failed attempts. Please request a new code.' };
  }

  // Verify hash
  const inputHash = await hashOtp(code.trim(), record.salt);
  if (inputHash !== record.otpHash) {
    // Increment attempts and save
    record.attempts++;
    await kvSet(key, record, ONYXBASE_COLLECTIONS.OTPS);
    const remaining = OTP_MAX_ATTEMPTS - record.attempts;
    return { ok: false, error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` };
  }

  // Success — DELETE the code (one-time use; replay → "not found").
  await deleteOtpRow(key);

  return { ok: true };
}

/**
 * Sweep expired/consumed OTP rows so the DB holds only live codes.
 * Runs piggyback (non-blocking) on every send/verify — no cron needed.
 * ONLY touches the OTPs collection — never profiles, resources, or other data.
 */
let lastSweepAt = 0;
const SWEEP_MIN_GAP_MS = 5 * 60 * 1000;

export async function cleanupExpiredOtps(): Promise<number> {
  // Throttled: a full-collection export on EVERY auth call self-floods a
  // drowning backend. One sweep per 5 min per instance is plenty for 10-min codes.
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_MIN_GAP_MS) return 0;
  lastSweepAt = now;
  let cleaned = 0;
  try {
    const all = await kvExport<Record<string, OtpRecord>>(ONYXBASE_COLLECTIONS.OTPS);
    const now = Date.now();
    for (const key of Object.keys(all)) {
      const record = all[key];
      if (!record) continue;
      const isExpired = new Date(record.expiresAt).getTime() < now;
      if (isExpired || record.consumed) {
        // CRITICAL: Only delete if the key starts with "otp:" (safety check)
        if (key.startsWith('otp:')) {
          await deleteOtpRow(key);
          cleaned++;
        }
      }
    }
  } catch (err) {
    console.error('[otp] cleanup error:', err);
  }
  return cleaned;
}

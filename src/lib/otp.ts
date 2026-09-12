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
 * - One-time use: consumed=true after success
 * - New OTP invalidates previous OTP for same email+purpose
 *
 * OTP record shape (stored in OnyxBase KV):
 * {
 *   email: "user@example.com",       // normalized lowercase
 *   otpHash: "...",                   // SHA-256(code + salt)
 *   salt: "...",                      // random UUID
 *   purpose: "registration",          // "registration" | "password_reset"
 *   expiresAt: "ISO string",          // 10 min from creation
 *   attempts: 0,                      // incremented on wrong code
 *   consumed: false,                  // set true on success
 *   createdAt: "ISO string"
 * }
 *
 * Key format: `otp:{email}:{purpose}` (e.g., `otp:user@example.com:registration`)
 */

import { kvSet, kvGet, kvDelete, kvExport, sendEmail } from './onyxbase';
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
): Promise<{ ok: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  const key = otpKey(normalizedEmail, purpose);

  // Check rate limit
  const existing = await kvGet<OtpRecord>(key, ONYXBASE_COLLECTIONS.OTPS);
  if (existing) {
    const elapsed = Date.now() - new Date(existing.createdAt).getTime();
    if (elapsed < OTP_RATE_LIMIT_MS) {
      const waitSec = Math.ceil((OTP_RATE_LIMIT_MS - elapsed) / 1000);
      return { ok: false, error: `Please wait ${waitSec}s before requesting another code.` };
    }
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

  // Store in OnyxBase (this invalidates any previous OTP for this email+purpose)
  await kvSet(key, record, ONYXBASE_COLLECTIONS.OTPS);

  // Build email content based on purpose
  const subject = purpose === 'password_reset'
    ? 'RailGuyEdits — Password Reset Code'
    : 'RailGuyEdits — Verification Code';

  const bodyText = purpose === 'password_reset'
    ? `Hello,

You requested a password reset for your RailGuyEdits account.

Your password reset code is: ${code}

This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.

— RailGuyEdits Platform`
    : `Hello,

Your verification code for RailGuyEdits is: ${code}

This code expires in 10 minutes.

If you didn't request this code, you can safely ignore this email.

— RailGuyEdits Platform`;

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

  return { ok: true };
}

/**
 * Verify an OTP code.
 * Checks: existence, expiry, attempts, consumed state, and hash match.
 * On success: marks OTP as consumed (one-time use).
 *
 * Returns { ok, error? }
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose = 'registration'
): Promise<{ ok: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  const key = otpKey(normalizedEmail, purpose);

  const record = await kvGet<OtpRecord>(key, ONYXBASE_COLLECTIONS.OTPS);
  if (!record) {
    return { ok: false, error: 'No verification code found. Please request a new one.' };
  }

  // Check if already consumed
  if (record.consumed) {
    return { ok: false, error: 'This code has already been used. Please request a new one.' };
  }

  // Check expiry
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    // Clean up expired OTP (ONLY the OTP record, nothing else)
    try { await kvDelete(key, ONYXBASE_COLLECTIONS.OTPS); } catch {}
    return { ok: false, error: 'Verification code expired. Please request a new one.' };
  }

  // Check attempts
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    try { await kvDelete(key, ONYXBASE_COLLECTIONS.OTPS); } catch {}
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

  // Success — mark as consumed (do NOT delete yet, in case we need to verify it was used)
  record.consumed = true;
  await kvSet(key, record, ONYXBASE_COLLECTIONS.OTPS);

  return { ok: true };
}

/**
 * Clean up expired OTP records.
 * ONLY touches the OTPs collection — never touches profiles, resources, or other data.
 */
export async function cleanupExpiredOtps(): Promise<number> {
  let cleaned = 0;
  try {
    const all = await kvExport<Record<string, OtpRecord>>(ONYXBASE_COLLECTIONS.OTPS);
    const now = Date.now();
    for (const key of Object.keys(all)) {
      const record = all[key];
      if (!record) continue;
      // Delete if expired or consumed (and older than 1 hour)
      const isExpired = new Date(record.expiresAt).getTime() < now;
      const isOldConsumed = record.consumed && (now - new Date(record.createdAt).getTime() > 60 * 60 * 1000);
      if (isExpired || isOldConsumed) {
        // CRITICAL: Only delete if the key starts with "otp:" (safety check)
        if (key.startsWith('otp:')) {
          try {
            await kvDelete(key, ONYXBASE_COLLECTIONS.OTPS);
            cleaned++;
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error('[otp] cleanup error:', err);
  }
  return cleaned;
}

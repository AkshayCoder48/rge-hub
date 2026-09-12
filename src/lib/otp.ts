/**
 * OTP (One-Time Password) helpers for email verification.
 *
 * Flow:
 * 1. User enters email → server generates 6-digit OTP
 * 2. Server stores hashed OTP + expiry + attempts in OnyxBase KV
 * 3. Server sends OTP via OnyxBase Email Automation API
 * 4. User enters OTP → server validates against stored hash
 * 5. On success: delete OTP, mark email verified
 *
 * Security:
 * - OTP is hashed with SHA-256 + salt (never stored plaintext)
 * - 10-minute expiry
 * - Max 5 verification attempts
 * - Previous OTP invalidated when new one generated
 * - Rate limited per email (1 per 60s)
 */

import { kvSet, kvGet, kvDelete, sendEmail } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT_MS = 60 * 1000; // 1 per minute

interface OtpRecord {
  email: string;
  hash: string;
  salt: string;
  expiresAt: string;
  attempts: number;
  createdAt: string;
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
 * Send an OTP to an email address.
 * Returns { ok, error? }
 */
export async function sendOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  // Check rate limit
  const existing = await kvGet<OtpRecord>(`otp:${email.toLowerCase()}`, ONYXBASE_COLLECTIONS.OTPS);
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
    email: email.toLowerCase(),
    hash,
    salt,
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    createdAt: now.toISOString(),
  };

  await kvSet(`otp:${email.toLowerCase()}`, record, ONYXBASE_COLLECTIONS.OTPS);

  // Send email
  const subject = 'Your RailGuyEdits verification code';
  const body = `Hello,

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
  <p style="font-size: 16px; color: #333;">Your verification code is:</p>
  <div style="text-align: center; margin: 24px 0;">
    <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #8b5cf6; background: #f5f3ff; padding: 16px 32px; border-radius: 12px; display: inline-block;">${code}</span>
  </div>
  <p style="font-size: 14px; color: #666;">This code expires in 10 minutes.</p>
  <p style="font-size: 14px; color: #999; margin-top: 32px;">If you didn't request this code, you can safely ignore this email.</p>
</div>`;

  const result = await sendEmail(email, subject, body, htmlBody);
  if (!result.ok) {
    return { ok: false, error: result.error || 'Failed to send verification email' };
  }

  return { ok: true };
}

/**
 * Verify an OTP code.
 * Returns { ok, error? }
 */
export async function verifyOtp(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const record = await kvGet<OtpRecord>(`otp:${email.toLowerCase()}`, ONYXBASE_COLLECTIONS.OTPS);
  if (!record) {
    return { ok: false, error: 'No verification code found. Please request a new one.' };
  }

  // Check expiry
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await kvDelete(`otp:${email.toLowerCase()}`, ONYXBASE_COLLECTIONS.OTPS);
    return { ok: false, error: 'Verification code expired. Please request a new one.' };
  }

  // Check attempts
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await kvDelete(`otp:${email.toLowerCase()}`, ONYXBASE_COLLECTIONS.OTPS);
    return { ok: false, error: 'Too many failed attempts. Please request a new code.' };
  }

  // Verify hash
  const inputHash = await hashOtp(code.trim(), record.salt);
  if (inputHash !== record.hash) {
    // Increment attempts
    record.attempts++;
    await kvSet(`otp:${email.toLowerCase()}`, record, ONYXBASE_COLLECTIONS.OTPS);
    const remaining = OTP_MAX_ATTEMPTS - record.attempts;
    return { ok: false, error: `Invalid code. ${remaining} attempts remaining.` };
  }

  // Success — delete the OTP
  await kvDelete(`otp:${email.toLowerCase()}`, ONYXBASE_COLLECTIONS.OTPS);
  return { ok: true };
}

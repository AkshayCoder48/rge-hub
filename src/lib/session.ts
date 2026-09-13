/**
 * Server-side session management for the RailGuyEdits platform.
 *
 * Sessions are stored as stateless HMAC-signed cookies.
 * The session data is encoded as base64 JSON, signed with HMAC-SHA256
 * using a server secret. The cookie is httpOnly and secure.
 *
 * SECURITY (admin impersonation fix):
 * - Admin rights come ONLY from the admin EMAIL (ADMIN_EMAIL env) or an
 *   explicit ADMIN_USER_IDS allowlist. Username / display name NEVER grant
 *   admin — anyone can type "RailGuyEdits" as a display name.
 * - isAdmin is RECOMPUTED from the session email on every getSession() call,
 *   so stale/tampered cookies can never retain admin rights.
 * - For revocation (logout), we maintain a lightweight in-memory set of
 *   revoked session IDs.
 */

import { cookies } from 'next/headers';
import crypto from 'crypto';

export const SESSION_COOKIE = 'rge_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Server secret for signing cookies — falls back to a dev secret
const SESSION_SECRET = process.env.SESSION_SECRET || 'railguyedits-dev-secret-change-in-production';

// In-memory revoked session set (cleared on server restart, which is fine)
const revokedSessions = new Set<string>();

export interface SessionData {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  avatar?: string;
  bio?: string;
  apiKey: string;
  isAdmin: boolean;
  createdAt: string;
  expiresAt: string;
}

export type SessionResult =
  | { status: 'ok'; session: SessionData }
  | { status: 'no-session' }
  | { status: 'expired' }
  | { status: 'error'; message: string };

/**
 * Sign data with HMAC-SHA256.
 */
function sign(data: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
}

/**
 * Encode session data into a signed cookie string.
 */
function encodeSession(session: SessionData): string {
  const json = JSON.stringify(session);
  const b64 = Buffer.from(json).toString('base64url');
  const signature = sign(b64);
  return `${b64}.${signature}`;
}

/**
 * Decode and verify a signed cookie string.
 * Returns null if the signature is invalid or data is malformed.
 */
function decodeSession(cookieValue: string): SessionData | null {
  try {
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return null;
    const [b64, signature] = parts;

    // Verify signature
    const expectedSig = sign(b64);
    if (signature !== expectedSig) {
      console.error('[session] Invalid signature — cookie tampered');
      return null;
    }

    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    const session = JSON.parse(json) as SessionData;
    return session;
  } catch (err) {
    console.error('[session] Failed to decode session:', err);
    return null;
  }
}

/**
 * Create a new session and set the cookie.
 * The session data is stored directly in the cookie (signed), not in OnyxBase.
 */
export async function createSession(user: {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  avatar?: string;
  bio?: string;
  apiKey: string;
  isAdmin: boolean;
}): Promise<SessionData> {
  const sessionId = `sess_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  const session: SessionData = {
    sessionId,
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatar: user.avatar,
    bio: user.bio,
    apiKey: user.apiKey,
    isAdmin: user.isAdmin,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const cookieValue = encodeSession(session);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS / 1000,
  });


  return session;
}

/**
 * Get the current session from the signed cookie.
 *
 * This is stateless — no OnyxBase read required.
 * The session data is decoded and verified from the cookie itself.
 *
 * SECURITY: isAdmin is recomputed from the session email on EVERY call.
 * Sessions minted before this fix (no email stored) resolve to non-admin —
 * the admin simply logs in again to get a fresh session.
 */
export async function getSession(): Promise<SessionResult> {
  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(SESSION_COOKIE)?.value;
    if (!cookieValue) return { status: 'no-session' };

    const session = decodeSession(cookieValue);
    if (!session) return { status: 'no-session' };

    // Check if session was revoked (explicit logout)
    if (revokedSessions.has(session.sessionId)) {
      return { status: 'no-session' };
    }

    // Check expiry
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return { status: 'expired' };
    }

    // Recompute admin from verified email — never trust the stored flag.
    session.isAdmin = isAdminUser({ email: session.email, userId: session.userId });

    return { status: 'ok', session };
  } catch (err) {
    // Any error here is a cookie parsing error, not a database error
    console.error('[session] getSession error:', err);
    return { status: 'no-session' };
  }
}

/**
 * Destroy the current session (explicit logout only).
 * Adds the session ID to the revoked set and clears the cookie.
 */
export async function destroySession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(SESSION_COOKIE)?.value;
    if (cookieValue) {
      const session = decodeSession(cookieValue);
      if (session) {
        revokedSessions.add(session.sessionId);
      }
      cookieStore.delete(SESSION_COOKIE);
    }
  } catch {
    // ignore
  }
}

/**
 * Check if a user is the admin.
 *
 * SECURITY: ONLY the admin email (or an explicitly allowlisted userId)
 * grants admin. Username and displayName are user-controlled vanity
 * strings and MUST never confer privileges.
 */
export function isAdminUser(user: { email?: string; userId?: string; username?: string; displayName?: string }): boolean {
  // Explicit userId allowlist (comma-separated) — strongest signal.
  const allowlist = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (user.userId && allowlist.includes(user.userId)) return true;

  const adminEmail = (process.env.ADMIN_EMAIL || 'railguyedits@gmail.com').toLowerCase().trim();
  if (user.email && user.email.toLowerCase().trim() === adminEmail) return true;

  return false;
}

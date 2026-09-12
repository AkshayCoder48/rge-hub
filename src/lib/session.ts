/**
 * Server-side session management for the RailGuyEdits platform.
 *
 * Sessions are stored as OnyxBase KV records in the "sessions" collection.
 * The session ID is stored in an httpOnly cookie.
 *
 * Session record shape:
 * {
 *   sessionId: "sess_xxx",
 *   userId: "usr_xxx",       // OnyxBase user ID
 *   username: "railfan123",
 *   displayName: "Rail Fan",
 *   apiKey: "kv_live_xxx",   // user's OnyxBase key (for file ops)
 *   isAdmin: false,
 *   createdAt: "...",
 *   expiresAt: "..."
 * }
 */

import { cookies } from 'next/headers';
import { kvSet, kvGet, kvDelete } from './onyxbase';
import { ONYXBASE_COLLECTIONS } from './onyxbase';

export const SESSION_COOKIE = 'rge_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionData {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  apiKey: string;
  isAdmin: boolean;
  createdAt: string;
  expiresAt: string;
}

/**
 * Create a new session and set the cookie.
 */
export async function createSession(user: {
  userId: string;
  username: string;
  displayName: string;
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
    avatar: user.avatar,
    bio: user.bio,
    apiKey: user.apiKey,
    isAdmin: user.isAdmin,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await kvSet(sessionId, session, ONYXBASE_COLLECTIONS.SESSIONS);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return session;
}

/**
 * Get the current session from the cookie.
 * Returns null if not authenticated or expired.
 */
export async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionId) return null;

    const session = await kvGet<SessionData>(sessionId, ONYXBASE_COLLECTIONS.SESSIONS);
    if (!session) return null;

    // Check expiry
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await kvDelete(sessionId, ONYXBASE_COLLECTIONS.SESSIONS);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Destroy the current session.
 */
export async function destroySession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (sessionId) {
      await kvDelete(sessionId, ONYXBASE_COLLECTIONS.SESSIONS);
      cookieStore.delete(SESSION_COOKIE);
    }
  } catch {
    // ignore
  }
}

/**
 * Check if a user is the admin (RailGuyEdits).
 * Admin is determined by matching the admin email or username.
 */
export function isAdminUser(user: { username?: string; displayName?: string; email?: string }): boolean {
  const adminEmail = process.env.ADMIN_EMAIL || 'railguyedits@gmail.com';
  const adminUsername = 'railguyedits';
  const adminDisplay = 'RailGuyEdits';

  if (user.email && user.email.toLowerCase() === adminEmail.toLowerCase()) return true;
  if (user.username && user.username.toLowerCase() === adminUsername.toLowerCase()) return true;
  if (user.displayName && user.displayName.toLowerCase() === adminDisplay.toLowerCase()) return true;
  return false;
}

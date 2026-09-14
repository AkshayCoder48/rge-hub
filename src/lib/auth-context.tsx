'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, TIMEOUTS } from '@/lib/api-client';

interface AuthUser {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  isAdmin: boolean;
  role?: string;
  permissions?: string[];
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  status: 'loading',
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

/**
 * Bounded backoff schedule (PRD §17): attempt 1 fires immediately, then
 * 2s / 4s / 8s / 16s / 32s — 6 attempts total. Replaces the old infinite
 * 5s retry loop that could spin on the loading spinner forever.
 */
const MAX_ATTEMPTS = 6;
const BACKOFF_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

type SessionCheck =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'unauthenticated' }
  | { kind: 'transient' };

/**
 * One bounded /api/auth/me check through the request manager.
 *
 * /api/auth/me still speaks the legacy { ok, status, user } shape, which
 * api() normalizes. The crucial distinction:
 *   - { ok:false, status:'unauthenticated' } → REQUEST_FAILED = a DEFINITIVE
 *     "no session" (HTTP 200, server answered) → show the login screen.
 *   - REQUEST_TIMEOUT / NETWORK_ERROR / UPSTREAM_UNAVAILABLE = outcome
 *     UNKNOWN → retry with backoff, never log the user out over it.
 */
async function checkSession(): Promise<SessionCheck> {
  const res = await api<{ status?: string; user?: AuthUser }>('/api/auth/me', {
    timeoutMs: TIMEOUTS.normal,
  });
  if (res.success) {
    const d = res.data;
    if (d?.status === 'authenticated' && d.user) {
      return { kind: 'authenticated', user: d.user };
    }
    if (d?.status === 'loading') {
      // Server-side database hiccup — retry, don't log out.
      return { kind: 'transient' };
    }
    return { kind: 'unauthenticated' };
  }
  if (res.error?.code === 'REQUEST_FAILED') {
    return { kind: 'unauthenticated' };
  }
  return { kind: 'transient' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const hasInitializedRef = useRef(false);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /** Run one attempt; on a transient outcome schedule the next backoff step. */
  const runAttempt = useCallback(async () => {
    attemptRef.current += 1;
    let outcome: SessionCheck;
    try {
      outcome = await checkSession();
    } catch {
      outcome = { kind: 'transient' };
    }

    if (outcome.kind === 'authenticated') {
      hasInitializedRef.current = true;
      attemptRef.current = 0;
      setUser(outcome.user);
      setStatus('authenticated');
      return;
    }
    if (outcome.kind === 'unauthenticated') {
      hasInitializedRef.current = true;
      attemptRef.current = 0;
      setUser(null);
      setStatus('unauthenticated');
      return;
    }

    // Transient (timeout / network / db-loading) — outcome unknown. Back off
    // exponentially instead of hammering, and stop after MAX_ATTEMPTS.
    if (attemptRef.current >= MAX_ATTEMPTS) {
      attemptRef.current = 0;
      // Never drop a session we already hold — only surface a terminal error
      // when no session state could be established at all. A manual refresh
      // (visibility change, "Try again") restarts the sequence.
      if (!hasInitializedRef.current) {
        setStatus('error');
      }
      return;
    }
    const delay = BACKOFF_DELAYS_MS[Math.min(attemptRef.current - 1, BACKOFF_DELAYS_MS.length - 1)];
    clearRetryTimer();
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void runAttempt();
    }, delay);
  }, [clearRetryTimer]);

  const refresh = useCallback(async () => {
    // Prevent duplicate concurrent auth requests.
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      // External trigger (post-login/register, tab visible, "Try again"):
      // replace any pending backoff with a fresh bounded sequence.
      clearRetryTimer();
      attemptRef.current = 0;
      await runAttempt();
    } finally {
      isRefreshingRef.current = false;
    }
  }, [clearRetryTimer, runAttempt]);

  const logout = useCallback(async () => {
    clearRetryTimer();
    attemptRef.current = 0;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
    setStatus('unauthenticated');
  }, [clearRetryTimer]);

  useEffect(() => {
    refresh();
    return () => {
      clearRetryTimer();
    };
  }, [refresh, clearRetryTimer]);

  // Listen for tab visibility changes — refresh session when tab becomes visible
  // but do NOT change status during refresh (prevents AuthScreen remount).
  // This also retriggers the sequence after a terminal 'error'.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, status, loading: status === 'loading', refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

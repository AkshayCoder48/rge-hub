'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

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

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(false);
  const hasInitializedRef = useRef(false);

  const refresh = useCallback(async () => {
    // Prevent duplicate concurrent auth requests
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();

      if (data.status === 'authenticated' && data.user) {
        setUser(data.user);
        setStatus('authenticated');
      } else if (data.status === 'loading') {
        // Database error — do NOT change status if we already have a user
        // Only set to loading on initial load (before first successful check)
        if (!hasInitializedRef.current) {
          // Keep status as 'loading' — don't change
        }
        // Schedule a retry after 5 seconds
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => { refresh(); }, 5000);
      } else {
        // unauthenticated
        hasInitializedRef.current = true;
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch {
      // Network error — do NOT change status if we already have a user
      // Only keep loading on initial load
      if (!hasInitializedRef.current) {
        // Keep status as 'loading'
      }
      // Retry after 5 seconds
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => { refresh(); }, 5000);
    } finally {
      isRefreshingRef.current = false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  // Listen for tab visibility changes — refresh session when tab becomes visible
  // but do NOT change status during refresh (prevents AuthScreen remount)
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

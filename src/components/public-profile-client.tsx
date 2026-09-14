'use client';

import React, { useState, useCallback } from 'react';
import { UserView } from '@/components/platform/views/user-view';

interface PublicProfileClientProps {
  initialUserId: string;
  initialUsername: string;
}

/**
 * Standalone-profile navigator: hopping between creators stays in-app
 * (resolves userId -> username, swaps the view, syncs the URL).
 */
export function PublicProfileClient({ initialUserId, initialUsername }: PublicProfileClientProps) {
  const [current, setCurrent] = useState({ userId: initialUserId, username: initialUsername });

  const openUser = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const username = data.ok && data.profile?.username ? (data.profile.username as string) : null;
      if (username) {
        setCurrent({ userId, username });
        window.history.pushState(null, '', `/${username}`);
        window.scrollTo({ top: 0 });
        return;
      }
    } catch {}
    // Fallback: plain reload of the id-based API is useless — go home.
    window.location.assign('/');
  }, []);

  const openSelf = useCallback(() => {
    window.location.assign('/');
  }, []);

  return (
    <UserView
      key={current.userId}
      userId={current.userId}
      onOpenUser={openUser}
      onOpenSelf={openSelf}
    />
  );
}

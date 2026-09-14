'use client';

import React, { useEffect, useState } from 'react';
import { UserPlus, UserCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FollowButtonProps {
  userId: string;
  initialFollowing: boolean;
  onChange?: (following: boolean, followersCount?: number) => void;
  size?: 'sm' | 'md';
}

export function FollowButton({ userId, initialFollowing, onChange, size = 'md' }: FollowButtonProps) {
  const { toast } = useToast();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing, userId]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        following ? `/api/follows?targetId=${encodeURIComponent(userId)}` : '/api/follows',
        following
          ? { method: 'DELETE', cache: 'no-store' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetId: userId }),
              cache: 'no-store',
            }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast({
          title: following ? 'Unfollow failed' : 'Follow failed',
          description: (data.error as string) || 'Please retry shortly.',
          variant: 'destructive',
        });
        return;
      }
      const next = !following;
      setFollowing(next);
      onChange?.(next, data.followersCount as number | undefined);
    } catch {
      toast({ title: 'Network error', description: 'Please check your connection and retry.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const cls =
    size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-5 py-2 text-xs';
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-full font-manrope font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-60 ${cls} ${
        following
          ? 'bg-white/[0.04] border border-white/10 text-zinc-300 hover:text-white hover:border-[#ef233c]/30'
          : 'bg-[#ef233c] text-white hover:bg-red-700 shadow-[0_0_20px_-8px_rgba(239,35,60,0.6)]'
      }`}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : following ? (
        <UserCheck className="w-3.5 h-3.5" />
      ) : (
        <UserPlus className="w-3.5 h-3.5" />
      )}
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

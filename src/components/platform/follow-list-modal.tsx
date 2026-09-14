'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { X, Users, UserCheck, Loader2 } from 'lucide-react';
import { FollowButton } from './follow-button';
import { RoleBadge } from './role-badge';

interface FollowListModalProps {
  userId: string;
  displayName: string;
  initialTab: 'followers' | 'following';
  onClose: () => void;
  onOpenUser: (userId: string) => void;
}

interface Row {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  role: string;
  isFollowing: boolean | 'self';
}

const PAGE = 30;

export function FollowListModal({ userId, displayName, initialTab, onClose, onOpenUser }: FollowListModalProps) {
  const [tab, setTab] = useState<'followers' | 'following'>(initialTab);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);

  const load = useCallback(
    async (kind: 'followers' | 'following') => {
      setLoading(true);
      setError(null);
      setVisible(PAGE);
      try {
        const res = await fetch(
          `/api/follows/list?userId=${encodeURIComponent(userId)}&kind=${kind}`,
          { cache: 'no-store' }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setError((data.error as string) || 'Failed to load list');
          setRows([]);
          setTotal(0);
        } else {
          // Dedupe client-side too (belt + suspenders over the server dedupe).
          const seen = new Set<string>();
          const clean = ((data.users as Row[]) || []).filter((r) => {
            if (!r || !r.userId || seen.has(r.userId)) return false;
            seen.add(r.userId);
            return true;
          });
          setRows(clean);
          setTotal(typeof data.total === 'number' ? data.total : clean.length);
        }
      } catch {
        setError('Network error — please retry.');
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  const switchTab = (kind: 'followers' | 'following') => {
    if (kind !== tab) setTab(kind);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80vh] bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <div className="min-w-0">
            <h2 className="font-manrope font-semibold text-base text-white truncate">{displayName}</h2>
            <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500">
              {total} {tab}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-5 pt-3 shrink-0">
          {(
            [
              { key: 'followers', label: 'Followers', icon: Users },
              { key: 'following', label: 'Following', icon: UserCheck },
            ] as const
          ).map((t) => {
            const TabIcon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                    : 'text-zinc-500 hover:text-white border border-transparent'
                }`}
              >
                <TabIcon className={`w-3.5 h-3.5 ${active ? 'text-[#ef233c]' : ''}`} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-[#ef233c] animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-10">
              <p className="font-inter text-sm text-zinc-400 mb-3">{error}</p>
              <button
                onClick={() => load(tab)}
                className="px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/10 text-xs text-zinc-300 hover:text-white transition-all"
              >
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10">
              <p className="font-manrope font-medium text-sm text-white mb-1">
                {tab === 'followers' ? 'No followers yet.' : "You're not following anyone yet."}
              </p>
              <p className="font-inter text-xs text-zinc-500">
                {tab === 'followers'
                  ? 'Share your profile link to grow your audience.'
                  : 'Discover creators via Search.'}
              </p>
            </div>
          ) : (
            <>
              {rows.slice(0, visible).map((r) => (
                <div
                  key={r.userId}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/10 transition-all"
                >
                  <button
                    onClick={() => {
                      onClose();
                      onOpenUser(r.userId);
                    }}
                    className="shrink-0"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-sm font-manrope font-semibold text-white overflow-hidden">
                      {r.avatar ? (
                        <img src={r.avatar} alt={r.displayName} className="w-full h-full object-cover" />
                      ) : (
                        (r.displayName || '?').charAt(0).toUpperCase()
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      onOpenUser(r.userId);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="font-inter text-sm font-medium text-white truncate hover:underline">
                        {r.displayName}
                      </p>
                      <RoleBadge role={r.role} />
                    </div>
                    <p className="text-[11px] font-manrope text-zinc-500">@{r.username}</p>
                  </button>
                  {r.isFollowing !== 'self' && (
                    <div className="shrink-0">
                      <FollowButton userId={r.userId} initialFollowing={r.isFollowing === true} size="sm" />
                    </div>
                  )}
                </div>
              ))}
              {visible < rows.length && (
                <button
                  onClick={() => setVisible((v) => v + PAGE)}
                  className="w-full py-2 rounded-xl text-xs font-manrope text-zinc-400 hover:text-white bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all"
                >
                  Show more ({rows.length - visible} remaining)
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

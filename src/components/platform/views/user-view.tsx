'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Resource, ResourceType } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
import { FollowButton } from '../follow-button';
import { useToast } from '@/hooks/use-toast';
import {
  Image as ImageIcon,
  Film,
  FileCode,
  Calendar,
  User as UserIcon,
  PackageOpen,
  Share2,
} from 'lucide-react';

interface UserViewProps {
  userId: string;
  onOpenUser: (userId: string) => void;
  onOpenSelf: () => void;
}

interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio: string;
  createdAt: string;
}

type FetchState = 'loading' | 'not-found' | 'error' | 'ready';
type TabKey = 'all' | ResourceType;

export function UserView({ userId, onOpenUser, onOpenSelf }: UserViewProps) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState<boolean | 'self' | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [tab, setTab] = useState<TabKey>('all');
  const [selected, setSelected] = useState<Resource | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFetchState('loading');
    fetch(`/api/users/${encodeURIComponent(userId)}`, { cache: 'no-store' })
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data.ok) {
          setProfile(data.profile as PublicProfile);
          setResources((data.resources as Resource[]) || []);
          setFollowersCount(data.followersCount || 0);
          setFollowingCount(data.followingCount || 0);
          setIsFollowing((data.isFollowing as boolean | 'self' | null) ?? null);
          setFetchState('ready');
        } else if (res.status === 404) {
          setFetchState('not-found');
        } else {
          setFetchState('error');
        }
      })
      .catch(() => {
        if (!cancelled) setFetchState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const counts = useMemo(() => {
    return {
      all: resources.length,
      image: resources.filter((r) => r.type === 'image').length,
      clip: resources.filter((r) => r.type === 'clip').length,
      xml: resources.filter((r) => r.type === 'xml').length,
    };
  }, [resources]);

  const filtered = useMemo(() => {
    const list = tab === 'all' ? resources : resources.filter((r) => r.type === tab);
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [resources, tab]);

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const handleShareProfile = () => {
    const url = `${window.location.origin}/${profile?.username || userId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: 'Profile link copied!', description: url }))
      .catch(() => toast({ title: 'Copy failed', description: 'Could not copy URL', variant: 'destructive' }));
  };

  if (fetchState === 'loading') {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="rounded-xl border border-white/10 bg-black/60 p-8">
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-white/5" />
            <div className="flex-1">
              <div className="h-6 bg-white/5 rounded w-1/3 mb-2" />
              <div className="h-3 bg-white/5 rounded w-1/4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (fetchState !== 'ready' || !profile) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
        <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
          <UserIcon className="w-7 h-7 text-[#ef233c]" />
        </div>
        <h3 className="font-manrope font-semibold text-lg text-white mb-1">
          {fetchState === 'not-found' ? 'User not found' : 'Could not load profile'}
        </h3>
        <p className="font-inter text-sm text-zinc-500">This profile may have been removed.</p>
      </div>
    );
  }

  const initials = (profile.displayName || '?')
    .split(' ')
    .map((s) => s.charAt(0))
    .join('')
    .substring(0, 2)
    .toUpperCase();
  const joinDate = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const tabs: { key: TabKey; label: string; icon: typeof ImageIcon; count: number }[] = [
    { key: 'all', label: 'All', icon: UserIcon, count: counts.all },
    { key: 'image', label: 'Images', icon: ImageIcon, count: counts.image },
    { key: 'clip', label: 'Clips', icon: Film, count: counts.clip },
    { key: 'xml', label: 'Files', icon: FileCode, count: counts.xml },
  ];

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <section className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-2xl font-manrope font-semibold text-white overflow-hidden shrink-0">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.displayName} className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="font-manrope font-semibold text-2xl lg:text-3xl text-white leading-tight truncate">
                  {profile.displayName}
                </h1>
                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-manrope text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="w-3 h-3" />@{profile.username}
                  </span>
                  {joinDate && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      Joined {joinDate}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={handleShareProfile}
                title="Copy profile link"
                className="shrink-0 p-2 rounded-full bg-white/[0.04] border border-white/10 text-zinc-400 hover:text-white hover:border-[#ef233c]/30 transition-all"
              >
                <Share2 className="w-4 h-4" />
              </button>
              {isFollowing === 'self' ? (
                <button
                  onClick={onOpenSelf}
                  className="shrink-0 flex items-center gap-2 px-5 py-2 rounded-full bg-white/[0.04] border border-white/10 text-xs font-manrope text-zinc-300 hover:text-white hover:border-[#ef233c]/30 transition-all"
                >
                  Open my profile
                </button>
              ) : (
                isFollowing !== null && (
                  <div className="shrink-0">
                    <FollowButton
                      userId={profile.userId}
                      initialFollowing={isFollowing === true}
                      onChange={(next, n) => {
                        setIsFollowing(next);
                        if (typeof n === 'number') setFollowersCount(n);
                        else setFollowersCount((c) => c + (next ? 1 : -1));
                      }}
                    />
                  </div>
                )
              )}
            </div>
            {profile.bio && (
              <p className="mt-3 font-inter text-sm text-zinc-400 max-w-2xl leading-relaxed">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="relative grid grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/5">
          <div className="rounded-xl bg-white/[0.02] border border-white/5 px-4 py-3 text-center">
            <div className="font-manrope font-semibold text-xl text-white">{resources.length}</div>
            <div className="text-[10px] font-manrope uppercase tracking-[0.15em] text-zinc-500 mt-0.5">Uploads</div>
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/5 px-4 py-3 text-center">
            <div className="font-manrope font-semibold text-xl text-white">{followersCount}</div>
            <div className="text-[10px] font-manrope uppercase tracking-[0.15em] text-zinc-500 mt-0.5">Followers</div>
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/5 px-4 py-3 text-center">
            <div className="font-manrope font-semibold text-xl text-white">{followingCount}</div>
            <div className="text-[10px] font-manrope uppercase tracking-[0.15em] text-zinc-500 mt-0.5">Following</div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 w-fit overflow-x-auto max-w-full">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isActive
                  ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                  : 'text-zinc-500 hover:text-white border border-transparent'
              }`}
            >
              <TabIcon className={`w-3.5 h-3.5 ${isActive ? 'text-[#ef233c]' : ''}`} />
              {t.label}
              <span
                className={`text-[9px] font-manrope px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-zinc-600'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-7 h-7 text-[#ef233c]" />
          </div>
          <h3 className="font-manrope font-semibold text-lg text-white mb-1">No uploads yet</h3>
          <p className="font-inter text-sm text-zinc-500 max-w-md mx-auto">
            @{profile.username} hasn&apos;t published anything here yet.
          </p>
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {filtered.map((r) => (
            <div key={r.id} className="break-inside-avoid mb-4">
              <ResourceCard
                resource={r}
                onClick={() => setSelected(r)}
                onDownload={() => handleDownload(r)}
                showOwner={false}
              />
            </div>
          ))}
        </div>
      )}

      {selected && (
        <ResourceDetailModal
          resource={selected}
          onClose={() => setSelected(null)}
          onDownload={handleDownload}
          onOpenUser={onOpenUser}
        />
      )}
    </div>
  );
}

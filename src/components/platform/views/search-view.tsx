'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Resource } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
import { FollowButton } from '../follow-button';
import { useResourceStore } from '@/lib/resource-store';
import { useToast } from '@/hooks/use-toast';
import { Search, Users, LayoutGrid, PackageOpen, Crown } from 'lucide-react';

interface SearchViewProps {
  onOpenUser: (userId: string) => void;
}

interface MiniProfile {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio: string;
}

type TabKey = 'people' | 'content';

export function SearchView({ onOpenUser }: SearchViewProps) {
  const { toast } = useToast();
  const allResources = useResourceStore((s) => s.allResources);
  const loaded = useResourceStore((s) => s.loaded);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabKey>('people');
  const [people, setPeople] = useState<MiniProfile[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Resource | null>(null);

  // Debounced people search (server-side; min 2 chars).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setPeople([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setPeople((data.users as MiniProfile[]) || []);
          setFollowingIds((data.following as string[]) || []);
        } else {
          setPeople([]);
        }
      } catch {
        setPeople([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Content search is instant (client-side over the loaded store).
  const content = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allResources.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.ownerName?.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [allResources, query]);

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const tabs: { key: TabKey; label: string; icon: typeof Users }[] = [
    { key: 'people', label: 'People', icon: Users },
    { key: 'content', label: 'Posts', icon: LayoutGrid },
  ];

  const showEmpty =
    query.trim().length >= 2 &&
    !searching &&
    (tab === 'people' ? people.length === 0 : content.length === 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center">
            <Search className="w-6 h-6 text-[#ef233c]" />
          </div>
          <div>
            <h1 className="font-manrope font-semibold text-2xl text-white leading-tight">Search</h1>
            <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
              Find creators and their work
            </p>
          </div>
        </div>
      </div>

      {/* Search box */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search creators, titles, tags..."
          autoFocus
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 font-inter text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ef233c]/40 focus:bg-black/80 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
        />
        {searching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#ef233c]/30 border-t-[#ef233c] rounded-full animate-spin" />
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 w-fit">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isActive
                  ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                  : 'text-zinc-500 hover:text-white border border-transparent'
              }`}
            >
              <TabIcon className={`w-3.5 h-3.5 ${isActive ? 'text-[#ef233c]' : ''}`} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      {query.trim().length < 2 ? (
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
            <Search className="w-7 h-7 text-[#ef233c]" />
          </div>
          <h3 className="font-manrope font-semibold text-lg text-white mb-1">Start typing to search</h3>
          <p className="font-inter text-sm text-zinc-500 max-w-md mx-auto">
            Find creators by name, or posts by title, tag, and description.
          </p>
        </div>
      ) : showEmpty ? (
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-7 h-7 text-[#ef233c]" />
          </div>
          <h3 className="font-manrope font-semibold text-lg text-white mb-1">No matches found</h3>
          <p className="font-inter text-sm text-zinc-500 max-w-md mx-auto">Try a different search.</p>
        </div>
      ) : tab === 'people' ? (
        <div className="space-y-3">
          {people.map((p) => (
            <div
              key={p.userId}
              className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl hover:border-[#ef233c]/30 transition-all"
            >
              <button onClick={() => onOpenUser(p.userId)} className="shrink-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-base font-manrope font-semibold text-white overflow-hidden">
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.displayName} className="w-full h-full object-cover" />
                  ) : (
                    (p.displayName || '?').charAt(0).toUpperCase()
                  )}
                </div>
              </button>
              <button onClick={() => onOpenUser(p.userId)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  <p className="font-inter text-sm font-medium text-white truncate hover:underline">{p.displayName}</p>
                </div>
                <p className="text-[11px] font-manrope text-zinc-500">@{p.username}</p>
                {p.bio && <p className="text-xs font-inter text-zinc-400 truncate mt-0.5">{p.bio}</p>}
              </button>
              <div className="shrink-0">
                <FollowButton userId={p.userId} initialFollowing={followingIds.includes(p.userId)} size="sm" />
              </div>
            </div>
          ))}
        </div>
      ) : !loaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-black/60 p-4 animate-pulse">
              <div className="w-full h-40 bg-white/5 rounded-lg mb-3" />
              <div className="h-4 bg-white/5 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {content.map((r) => (
            <div key={r.id} className="break-inside-avoid mb-4">
              <ResourceCard
                resource={r}
                onClick={() => setSelected(r)}
                onDownload={() => handleDownload(r)}
                showOwner
                onOwnerClick={onOpenUser}
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
          onUpdated={(r) => setSelected(r)}
        />
      )}
    </div>
  );
}

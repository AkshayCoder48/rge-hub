'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Resource, ResourceType } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
import { useResourceStore } from '@/lib/resource-store';
import { useToast } from '@/hooks/use-toast';
import {
  Users,
  Image as ImageIcon,
  Film,
  FileCode,
  LayoutGrid,
  Search,
  PackageOpen,
  UserCheck,
} from 'lucide-react';

type FilterKey = 'all' | 'following' | ResourceType;

interface CommunityViewProps {
  onOpenUser: (userId: string) => void;
}

export function CommunityView({ onOpenUser }: CommunityViewProps) {
  const { toast } = useToast();
  const allResources = useResourceStore((s) => s.allResources);
  const loaded = useResourceStore((s) => s.loaded);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Resource | null>(null);
  const [followingIds, setFollowingIds] = useState<string[]>([]);

  // Who I follow (for the Following tab) — one cheap read.
  useEffect(() => {
    fetch('/api/follows', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.following)) setFollowingIds(data.following as string[]);
      })
      .catch(() => {});
  }, []);

  const resources = allResources;

  const filtered = useMemo(() => {
    let list = resources;
    if (filter === 'following') list = list.filter((r) => followingIds.includes(r.ownerId));
    else if (filter !== 'all') list = list.filter((r) => r.type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.title?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.ownerName?.toLowerCase().includes(q) ||
          r.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [resources, filter, search]);

  const counts = useMemo(() => {
    return {
      all: resources.length,
      following: resources.filter((r) => followingIds.includes(r.ownerId)).length,
      image: resources.filter((r) => r.type === 'image').length,
      clip: resources.filter((r) => r.type === 'clip').length,
      xml: resources.filter((r) => r.type === 'xml').length,
    };
  }, [resources, followingIds]);

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const tabs: { key: FilterKey; label: string; icon: typeof LayoutGrid; count: number }[] = [
    { key: 'all', label: 'All', icon: LayoutGrid, count: counts.all },
    { key: 'following', label: 'Following', icon: UserCheck, count: counts.following },
    { key: 'image', label: 'Images', icon: ImageIcon, count: counts.image },
    { key: 'clip', label: 'Clips', icon: Film, count: counts.clip },
    { key: 'xml', label: 'Files', icon: FileCode, count: counts.xml },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-[#ef233c]" />
          </div>
          <div>
            <h1 className="font-manrope font-semibold text-2xl text-white leading-tight">Community Feed</h1>
            <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
              {counts.all} published resources from {new Set(resources.map((r) => r.ownerId)).size} creators
            </p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 w-fit overflow-x-auto max-w-full">
        {tabs.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = filter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isActive
                  ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                  : 'text-zinc-500 hover:text-white border border-transparent'
              }`}
            >
              <TabIcon className={`w-3.5 h-3.5 ${isActive ? 'text-[#ef233c]' : ''}`} />
              {tab.label}
              <span className={`text-[9px] font-manrope px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-zinc-600'}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, tag, or creator..."
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 font-inter text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ef233c]/40 focus:bg-black/80 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
        />
      </div>

      {/* Grid (masonry via CSS columns) */}
      {!loaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-black/60 p-4 animate-pulse">
              <div className="w-full h-40 bg-white/5 rounded-lg mb-3" />
              <div className="h-4 bg-white/5 rounded w-3/4 mb-2" />
              <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-7 h-7 text-[#ef233c]" />
          </div>
          <h3 className="font-manrope font-semibold text-lg text-white mb-1">
            {search || filter !== 'all' ? 'No matches found' : 'Nothing here yet'}
          </h3>
          <p className="font-inter text-sm text-zinc-500 max-w-md mx-auto">
            {search || filter !== 'all'
              ? 'Try adjusting your search or filter.'
              : 'Community resources will appear here once published.'}
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
                showOwner
                onOwnerClick={onOpenUser}
              />
            </div>
          ))}
        </div>
      )}

      {/* Resource detail modal */}
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

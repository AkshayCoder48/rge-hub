'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Resource, ResourceType } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
import { useToast } from '@/hooks/use-toast';
import {
  Users,
  Image as ImageIcon,
  Film,
  FileCode,
  LayoutGrid,
  Search,
  PackageOpen,
} from 'lucide-react';

type FilterKey = 'all' | ResourceType;

export function CommunityView() {
  const { toast } = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Resource | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/community/feed?limit=50');
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) setResources(data.resources || []);
          else setError(data.error || 'Failed to load community feed');
        }
      } catch {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let list = resources;
    if (filter !== 'all') list = list.filter((r) => r.type === filter);
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
      image: resources.filter((r) => r.type === 'image').length,
      clip: resources.filter((r) => r.type === 'clip').length,
      xml: resources.filter((r) => r.type === 'xml').length,
    };
  }, [resources]);

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const tabs: { key: FilterKey; label: string; icon: typeof LayoutGrid; count: number; color: string }[] = [
    { key: 'all', label: 'All', icon: LayoutGrid, count: counts.all, color: 'text-white' },
    { key: 'image', label: 'Images', icon: ImageIcon, count: counts.image, color: 'text-violet-400' },
    { key: 'clip', label: 'Clips', icon: Film, count: counts.clip, color: 'text-cyan-400' },
    { key: 'xml', label: 'XMLs', icon: FileCode, count: counts.xml, color: 'text-emerald-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="font-serif-display text-2xl text-white leading-tight">Community Feed</h1>
            <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 mt-1">
              {counts.all} published resources from {new Set(resources.map((r) => r.ownerId)).size} creators
            </p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 p-1 rounded-2xl bg-white/[0.02] border border-white/5 w-fit overflow-x-auto max-w-full">
        {tabs.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = filter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-300 ease-snap ${
                isActive
                  ? 'bg-white/[0.06] text-white border border-white/10'
                  : 'text-neutral-500 hover:text-white'
              }`}
            >
              <TabIcon className={`w-3.5 h-3.5 ${isActive ? tab.color : ''}`} />
              {tab.label}
              <span className={`text-[9px] font-mono-display px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-neutral-600'}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, tag, or creator..."
          className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/[0.02] border border-white/5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-violet-500/30 focus:bg-white/[0.04] transition-all duration-300"
        />
      </div>

      {/* Grid (masonry via CSS columns) */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-neutral-500">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-7 h-7 text-cyan-400" />
          </div>
          <h3 className="font-serif-display text-lg text-white mb-1">
            {search || filter !== 'all' ? 'No matches found' : 'Nothing here yet'}
          </h3>
          <p className="text-sm text-neutral-500 max-w-md mx-auto">
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
        />
      )}
    </div>
  );
}

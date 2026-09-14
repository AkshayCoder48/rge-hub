'use client';

import React, { useMemo, useState } from 'react';
import type { Resource, ResourceType } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
import { useAuth } from '@/lib/auth-context';
import { useResourceStore } from '@/lib/resource-store';
import { useToast } from '@/hooks/use-toast';
import {
  Image as ImageIcon,
  Film,
  FileCode,
  Upload,
  Search,
  PackageOpen,
} from 'lucide-react';

interface ResourcesViewProps {
  type: ResourceType;
  onUpload: () => void;
  onOpenUser: (userId: string) => void;
}

export function ResourcesView({ type, onUpload, onOpenUser }: ResourcesViewProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const loaded = useResourceStore((s) => s.loaded);


  // Read typed slices from the store
  const images = useResourceStore((s) => s.images);
  const clips = useResourceStore((s) => s.clips);
  const xmls = useResourceStore((s) => s.xmls);
  const myResources = useResourceStore((s) => s.myResources);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Resource | null>(null);

  const TypeIcon = type === 'image' ? ImageIcon : type === 'clip' ? Film : FileCode;
  const typeLabel = type === 'image' ? 'Images' : type === 'clip' ? 'Clips' : 'Files';

  // Merge public resources of this type with the user's own resources of this type,
  // deduplicating by id so unpublished drafts still show up.
  const resources = useMemo(() => {
    const publicOfType =
      type === 'image' ? images : type === 'clip' ? clips : xmls;
    const mineOfType = myResources.filter((r) => r.type === type);
    const seen = new Set<string>();
    const merged: Resource[] = [];
    for (const r of [...publicOfType, ...mineOfType]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    // Newest first
    merged.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return merged;
  }, [type, images, clips, xmls, myResources]);

  const filtered = useMemo(() => {
    if (!search.trim()) return resources;
    const q = search.toLowerCase();
    return resources.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.ownerName?.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [resources, search]);

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const handleDelete = async (r: Resource) => {
    if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    try {
      const params = new URLSearchParams();
      params.set('type', r.type);
      if (r.xmlSource) params.set('xmlSource', r.xmlSource);
      const res = await fetch(`/api/resources/${r.id}?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'Resource deleted', description: r.title });
        setSelected(null);
        // Instant UI sync everywhere (no ghost counts) + quiet background re-sync.
        useResourceStore.getState().removeById(r.id);
        useResourceStore.getState().softRefresh(user?.userId);
      } else {
        toast({ title: 'Delete failed', description: data.error || 'Unknown error', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Delete failed', description: 'Network error', variant: 'destructive' });
    }
  };

  const handleUploadClick = () => {
    onUpload();
  };

  const isOwn = (r: Resource) => !!user && r.ownerId === user.userId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center">
              <TypeIcon className="w-6 h-6 text-[#ef233c]" />
            </div>
            <div>
              <h1 className="font-manrope font-semibold text-2xl text-white leading-tight">{typeLabel} Library</h1>
              <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
                {filtered.length} {filtered.length === 1 ? 'resource' : 'resources'} available
              </p>
            </div>
          </div>
          <button
            onClick={handleUploadClick}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[0_0_20px_-8px_rgba(239,35,60,0.6)]"
          >
            <Upload className="w-4 h-4" /> {type === 'xml' ? 'Add File or Link' : type === 'image' ? 'Upload Image' : 'Upload Clip'}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${typeLabel.toLowerCase()} by title, tag, or creator...`}
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 font-inter text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ef233c]/40 focus:bg-black/80 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
        />
      </div>

      {/* Grid */}
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
            {search ? 'No matches found' : `No ${typeLabel.toLowerCase()} yet`}
          </h3>
          <p className="font-inter text-sm text-zinc-500 mb-5 max-w-md mx-auto">
            {search
              ? `Try adjusting your search terms.`
              : `Be the first to ${type === 'xml' ? 'add a file or link' : `upload a${type === 'image' ? 'n' : ''} ${type}`} to the library.`}
          </p>
          {!search && (
            <button
              onClick={handleUploadClick}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
            >
              <Upload className="w-4 h-4" /> Upload now
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <ResourceCard
              key={r.id}
              resource={r}
              onClick={() => setSelected(r)}
              onDownload={() => handleDownload(r)}
              showOwner
              onOwnerClick={onOpenUser}
            />
          ))}
        </div>
      )}

      {/* Resource detail modal */}
      {selected && (
        <ResourceDetailModal
          resource={selected}
          onClose={() => setSelected(null)}
          onDownload={handleDownload}
          canDelete={isOwn(selected)}
          onDelete={handleDelete}
          onOpenUser={onOpenUser}
        />
      )}
    </div>
  );
}

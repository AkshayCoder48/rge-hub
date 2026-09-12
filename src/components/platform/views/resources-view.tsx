'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Resource, ResourceType, XmlSource } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { useToast } from '@/hooks/use-toast';
import {
  Image as ImageIcon,
  Film,
  FileCode,
  Upload,
  Search,
  PackageOpen,
  Crown,
} from 'lucide-react';

interface ResourcesViewProps {
  type: ResourceType;
  onUpload: () => void;
}

export function ResourcesView({ type, onUpload }: ResourcesViewProps) {
  const { toast } = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [xmlSource, setXmlSource] = useState<XmlSource>('community');
  const [xmlTab, setXmlTab] = useState<'community' | 'admin'>('community');

  const isXml = type === 'xml';

  const typeIcon = type === 'image' ? ImageIcon : type === 'clip' ? Film : FileCode;
  const TypeIcon = typeIcon;
  const accent = type === 'image' ? 'violet' : type === 'clip' ? 'cyan' : 'emerald';
  const accentMap: Record<string, { text: string; bg: string; border: string; from: string; to: string }> = {
    violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', from: 'from-violet-500', to: 'to-cyan-500' },
    cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', from: 'from-cyan-500', to: 'to-violet-500' },
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', from: 'from-emerald-500', to: 'to-cyan-500' },
  };
  const ac = accentMap[accent];

  const typeLabel = type === 'image' ? 'Images' : type === 'clip' ? 'Clips' : 'XMLs';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('type', type);
        params.set('published', 'all');
        if (isXml) params.set('xmlSource', xmlSource);
        const res = await fetch(`/api/resources/list?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) setResources(data.resources || []);
          else {
            setError(data.error || 'Failed to load resources');
            if (res.status === 403) {
              setResources([]);
              setError(null);
              toast({
                title: 'Access restricted',
                description: 'Admin XMLs require administrator privileges.',
              });
            }
          }
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
  }, [type, xmlSource, isXml, toast]);

  // Keep xmlSource state synced with tab state
  useEffect(() => {
    setXmlSource(xmlTab);
  }, [xmlTab]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 relative overflow-hidden">
        <div className={`absolute -top-20 -right-20 w-56 h-56 rounded-full ${ac.bg} blur-3xl pointer-events-none`} />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl ${ac.bg} ${ac.border} border flex items-center justify-center`}>
              <TypeIcon className={`w-6 h-6 ${ac.text}`} />
            </div>
            <div>
              <h1 className="font-serif-display text-2xl text-white leading-tight">{typeLabel} Library</h1>
              <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 mt-1">
                {filtered.length} {filtered.length === 1 ? 'resource' : 'resources'} available
              </p>
            </div>
          </div>
          <button
            onClick={onUpload}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r ${ac.from} ${ac.to} text-white text-sm font-medium hover:opacity-90 transition-all duration-300 ease-snap shadow-[0_0_20px_-8px_rgba(139,92,246,0.6)]`}
          >
            <Upload className="w-4 h-4" /> Upload {type === 'image' ? 'Image' : type === 'clip' ? 'Clip' : 'XML'}
          </button>
        </div>
      </div>

      {/* XML tabs */}
      {isXml && (
        <div className="flex items-center gap-2 p-1 rounded-2xl bg-white/[0.02] border border-white/5 w-fit">
          <button
            onClick={() => setXmlTab('community')}
            className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 ease-snap ${
              xmlTab === 'community'
                ? 'bg-white/[0.06] text-white border border-emerald-500/20'
                : 'text-neutral-500 hover:text-white'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 inline mr-1.5 text-emerald-400" />
            Community XMLs
          </button>
          <button
            onClick={() => setXmlTab('admin')}
            className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 ease-snap ${
              xmlTab === 'admin'
                ? 'bg-white/[0.06] text-white border border-violet-500/20'
                : 'text-neutral-500 hover:text-white'
            }`}
          >
            <Crown className="w-3.5 h-3.5 inline mr-1.5 text-violet-400" />
            Admin XMLs
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${typeLabel.toLowerCase()} by title, tag, or creator...`}
          className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/[0.02] border border-white/5 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-violet-500/30 focus:bg-white/[0.04] transition-all duration-300"
        />
      </div>

      {/* Grid */}
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
          <div className={`w-14 h-14 rounded-2xl ${ac.bg} ${ac.border} border flex items-center justify-center mx-auto mb-4`}>
            <PackageOpen className={`w-7 h-7 ${ac.text}`} />
          </div>
          <h3 className="font-serif-display text-lg text-white mb-1">
            {search ? 'No matches found' : `No ${typeLabel.toLowerCase()} yet`}
          </h3>
          <p className="text-sm text-neutral-500 mb-5 max-w-md mx-auto">
            {search
              ? `Try adjusting your search terms.`
              : `Be the first to upload a${type === 'image' ? 'n' : ''} ${type === 'image' ? 'image' : type === 'clip' ? 'clip' : 'XML'} to the library.`}
          </p>
          {!search && (
            <button
              onClick={onUpload}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r ${ac.from} ${ac.to} text-white text-sm font-medium hover:opacity-90 transition-all duration-300`}
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
              onDownload={() => handleDownload(r)}
              showOwner
            />
          ))}
        </div>
      )}
    </div>
  );
}

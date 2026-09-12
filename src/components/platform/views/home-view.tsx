'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Resource } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
import type { ViewKey } from '../platform-app';
import { useToast } from '@/hooks/use-toast';
import {
  Zap,
  Image as ImageIcon,
  Film,
  FileCode,
  ArrowRight,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

interface HomeViewProps {
  onNavigate: (v: ViewKey) => void;
  onUpload: (type: 'image' | 'clip' | 'xml') => void;
}

export function HomeView({ onNavigate, onUpload }: HomeViewProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [recent, setRecent] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Resource | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/community/feed?limit=4');
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) setRecent(data.resources || []);
          else setError(data.error || 'Failed to load recent resources');
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

  const displayName = user?.displayName || 'Editor';

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const quickActions = [
    {
      label: 'Speed Ramp Studio',
      description: 'Create V-shaped reverse speed ramp clips',
      icon: Zap,
      accent: 'violet',
      onClick: () => onNavigate('studio'),
    },
    {
      label: 'Upload Image',
      description: 'Add reference or background images',
      icon: ImageIcon,
      accent: 'violet',
      onClick: () => onUpload('image'),
    },
    {
      label: 'Upload Clip',
      description: 'Share video clips with the community',
      icon: Film,
      accent: 'cyan',
      onClick: () => onUpload('clip'),
    },
    {
      label: 'Upload XML',
      description: 'Publish timeline XML presets',
      icon: FileCode,
      accent: 'emerald',
      onClick: () => onUpload('xml'),
    },
  ];

  const accentMap: Record<string, { text: string; bg: string; border: string; glow: string }> = {
    violet: {
      text: 'text-violet-400',
      bg: 'bg-violet-500/10',
      border: 'border-violet-500/20',
      glow: 'group-hover:shadow-[0_0_30px_-8px_rgba(139,92,246,0.5)]',
    },
    cyan: {
      text: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/20',
      glow: 'group-hover:shadow-[0_0_30px_-8px_rgba(6,182,212,0.5)]',
    },
    emerald: {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      glow: 'group-hover:shadow-[0_0_30px_-8px_rgba(16,185,129,0.5)]',
    },
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 lg:p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/5 mb-5">
            <Sparkles className="w-3 h-3 text-violet-400" />
            <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-400">
              RailGuyEdits Platform
            </span>
          </div>
          <h1 className="font-serif-display text-3xl md:text-4xl lg:text-5xl text-white leading-tight">
            Welcome back, <span className="text-shimmer">{displayName}</span>
          </h1>
          <p className="mt-3 text-sm text-neutral-400 max-w-2xl">
            Your creative workspace for speed ramp clips, editing assets, and timeline XMLs.
            Jump into the studio or upload something new for the community.
          </p>
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-serif-display text-xl text-white">Quick actions</h2>
            <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 mt-1">
              Get started
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action) => {
            const accent = accentMap[action.accent];
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                className={`group text-left rounded-3xl border border-white/5 bg-white/[0.02] p-5 hover:-translate-y-1 hover:bg-white/[0.04] transition-all duration-300 ease-snap ${accent.glow}`}
              >
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-4 ${accent.bg} ${accent.border} border`}>
                  <Icon className={`w-5 h-5 ${accent.text}`} />
                </div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-medium text-white">{action.label}</h3>
                  <ArrowRight className={`w-4 h-4 ${accent.text} opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300`} />
                </div>
                <p className="text-xs text-neutral-500 leading-relaxed">{action.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recently added */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-serif-display text-xl text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              Recently added
            </h2>
            <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 mt-1">
              Latest from the community
            </p>
          </div>
          <button
            onClick={() => onNavigate('community')}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition-all duration-300"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 text-center">
            <p className="text-sm text-neutral-500">{error}</p>
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 text-center">
            <Sparkles className="w-8 h-8 text-neutral-700 mx-auto mb-3" />
            <p className="text-sm text-neutral-400">No community resources yet.</p>
            <p className="text-xs text-neutral-600 mt-1">Be the first to upload!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {recent.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                onClick={() => setSelected(r)}
                onDownload={() => handleDownload(r)}
                showOwner
              />
            ))}
          </div>
        )}
      </section>

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

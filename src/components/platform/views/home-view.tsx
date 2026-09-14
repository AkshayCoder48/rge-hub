'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useResourceStore } from '@/lib/resource-store';
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
  const allResources = useResourceStore((s) => s.allResources);
  const loaded = useResourceStore((s) => s.loaded);
  const [selected, setSelected] = useState<Resource | null>(null);

  const displayName = user?.displayName || 'Editor';

  // Show 6 most recent public resources
  const recent = allResources.slice(0, 6);

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
      onClick: () => onNavigate('studio'),
    },
    {
      label: 'Upload Image',
      description: 'Add reference or background images',
      icon: ImageIcon,
      onClick: () => onUpload('image'),
    },
    {
      label: 'Upload Clip',
      description: 'Share video clips with the community',
      icon: Film,
      onClick: () => onUpload('clip'),
    },
    {
      label: 'Upload XML',
      description: 'Publish timeline XML presets',
      icon: FileCode,
      onClick: () => onUpload('xml'),
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-8 lg:p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/10 mb-5">
            <Sparkles className="w-3 h-3 text-[#ef233c]" />
            <span className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500">
              RailGuyEdits Platform
            </span>
          </div>
          <h1 className="font-manrope font-semibold text-3xl md:text-4xl lg:text-5xl text-white leading-tight">
            Welcome back, <span className="text-[#ef233c]">{displayName}</span>
          </h1>
          <p className="mt-3 font-inter text-sm text-zinc-400 max-w-2xl">
            Your creative workspace for speed ramp clips, editing assets, and timeline presets.
            Jump into the studio or upload something new for the community.
          </p>
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-manrope font-semibold text-xl text-white">Quick actions</h2>
            <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
              Get started
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                className="group text-left rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-5 hover:-translate-y-1 hover:border-[#ef233c]/30 hover:bg-black/80 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-[#ef233c]/10 border border-[#ef233c]/20">
                  <Icon className="w-5 h-5 text-[#ef233c]" />
                </div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-manrope text-sm font-medium text-white">{action.label}</h3>
                  <ArrowRight className="w-4 h-4 text-[#ef233c] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                </div>
                <p className="font-inter text-xs text-zinc-500 leading-relaxed">{action.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recently added */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-manrope font-semibold text-xl text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#ef233c]" />
              Recently added
            </h2>
            <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mt-1">
              Latest from the community
            </p>
          </div>
          <button
            onClick={() => onNavigate('community')}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-all duration-300"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>

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
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-8 text-center">
            <Sparkles className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="font-inter text-sm text-zinc-400">No community resources yet.</p>
            <p className="font-inter text-xs text-zinc-600 mt-1">Be the first to upload!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

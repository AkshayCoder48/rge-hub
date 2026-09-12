'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Resource, ResourceType } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { useToast } from '@/hooks/use-toast';
import {
  Image as ImageIcon,
  Film,
  FileCode,
  Download,
  Trash2,
  Calendar,
  User as UserIcon,
  Loader2,
  PackageOpen,
} from 'lucide-react';

type TabKey = ResourceType;

export function ProfileView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<{
    userId: string;
    username: string;
    displayName: string;
    avatar?: string;
    bio?: string;
    createdAt: string;
  } | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('image');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.username) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/profile/${encodeURIComponent(user.username)}`);
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) {
            setProfile(data.profile);
            setResources(data.resources || []);
          } else {
            setError(data.error || 'Failed to load profile');
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
  }, [user?.username]);

  const counts = useMemo(
    () => ({
      image: resources.filter((r) => r.type === 'image').length,
      clip: resources.filter((r) => r.type === 'clip').length,
      xml: resources.filter((r) => r.type === 'xml').length,
    }),
    [resources]
  );

  const filtered = useMemo(
    () => resources.filter((r) => r.type === tab),
    [resources, tab]
  );

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const handleDelete = async (r: Resource) => {
    if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    setDeletingId(r.id);
    try {
      const params = new URLSearchParams();
      params.set('type', r.type);
      if (r.xmlSource) params.set('xmlSource', r.xmlSource);
      const res = await fetch(`/api/resources/${r.id}?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        setResources((prev) => prev.filter((x) => x.id !== r.id));
        toast({ title: 'Resource deleted', description: r.title });
      } else {
        toast({ title: 'Delete failed', description: data.error || 'Unknown error' });
      }
    } catch {
      toast({ title: 'Delete failed', description: 'Network error' });
    } finally {
      setDeletingId(null);
    }
  };

  const tabs: { key: TabKey; label: string; icon: typeof ImageIcon; count: number; color: string }[] = [
    { key: 'image', label: 'Images', icon: ImageIcon, count: counts.image, color: 'text-violet-400' },
    { key: 'clip', label: 'Clips', icon: Film, count: counts.clip, color: 'text-cyan-400' },
    { key: 'xml', label: 'XMLs', icon: FileCode, count: counts.xml, color: 'text-emerald-400' },
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 text-center">
        <p className="text-sm text-neutral-500">{error || 'Profile not found'}</p>
      </div>
    );
  }

  const initials = profile.displayName
    .split(' ')
    .map((s) => s.charAt(0))
    .join('')
    .substring(0, 2)
    .toUpperCase();
  const joinDate = new Date(profile.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-6">
          {/* Avatar */}
          <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-3xl bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center text-2xl font-serif-display text-white overflow-hidden shrink-0">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.displayName} className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className="font-serif-display text-2xl lg:text-3xl text-white leading-tight">
              {profile.displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-mono-display text-neutral-500">
              <span className="flex items-center gap-1.5">
                <UserIcon className="w-3 h-3" />@{profile.username}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Joined {joinDate}
              </span>
            </div>
            {profile.bio && (
              <p className="mt-3 text-sm text-neutral-400 max-w-2xl leading-relaxed">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="relative grid grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/5">
          <StatBlock label="Images" value={counts.image} accent="violet" icon={ImageIcon} />
          <StatBlock label="Clips" value={counts.clip} accent="cyan" icon={Film} />
          <StatBlock label="XMLs" value={counts.xml} accent="emerald" icon={FileCode} />
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-2xl bg-white/[0.02] border border-white/5 w-fit">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 ease-snap ${
                isActive
                  ? 'bg-white/[0.06] text-white border border-white/10'
                  : 'text-neutral-500 hover:text-white'
              }`}
            >
              <TabIcon className={`w-3.5 h-3.5 ${isActive ? t.color : ''}`} />
              {t.label}
              <span className={`text-[9px] font-mono-display px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-neutral-600'}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Resources grid */}
      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-7 h-7 text-neutral-500" />
          </div>
          <h3 className="font-serif-display text-lg text-white mb-1">No {tab}s yet</h3>
          <p className="text-sm text-neutral-500">Use the upload button in the sidebar to add one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <div key={r.id} className="relative group">
              {!r.published && (
                <div className="absolute top-2 right-2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 backdrop-blur-sm border border-amber-500/30">
                  <span className="text-[9px] font-mono-display uppercase tracking-wider text-amber-300">Draft</span>
                </div>
              )}
              <ResourceCard
                resource={r}
                onDownload={() => handleDownload(r)}
                showOwner={false}
              />
              {/* Owner action buttons */}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => handleDownload(r)}
                  disabled={!r.downloadUrl}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] font-mono-display text-neutral-300 hover:text-white hover:bg-white/[0.04] transition-all duration-300 ease-snap disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  disabled={deletingId === r.id}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/5 border border-red-500/10 text-[11px] font-mono-display text-red-400/80 hover:text-red-300 hover:bg-red-500/10 transition-all duration-300 ease-snap disabled:opacity-40"
                >
                  {deletingId === r.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: number;
  accent: 'violet' | 'cyan' | 'emerald';
  icon: typeof ImageIcon;
}) {
  const colorMap = {
    violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
    cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  };
  const c = colorMap[accent];
  return (
    <div className={`rounded-2xl ${c.bg} ${c.border} border p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${c.text}`} />
      </div>
      <div className="font-serif-display text-2xl text-white">{value}</div>
    </div>
  );
}

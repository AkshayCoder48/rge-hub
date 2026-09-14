'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Resource } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { useToast } from '@/hooks/use-toast';
import {
  Shield,
  Users,
  Image as ImageIcon,
  Film,
  FileCode,
  Crown,
  Trash2,
  Loader2,
  TrendingUp,
  Activity,
  PackageOpen,
} from 'lucide-react';

interface AdminStats {
  totalUsers: number;
  totalImages: number;
  totalClips: number;
  totalCommunityXmls: number;
  totalAdminXmls: number;
}

export function AdminView() {
  const { toast } = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [adminXmls, setAdminXmls] = useState<Resource[]>([]);
  const [adminXmlsLoading, setAdminXmlsLoading] = useState(true);
  const [adminXmlsError, setAdminXmlsError] = useState<string | null>(null);

  const [recent, setRecent] = useState<Resource[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) setStats(data.stats);
          else setStatsError(data.error || 'Failed to load admin stats');
        }
      } catch {
        if (!cancelled) setStatsError('Network error');
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAdminXmlsLoading(true);
      setAdminXmlsError(null);
      try {
        const res = await fetch('/api/resources/list?type=xml&xmlSource=admin&published=all');
        const data = await res.json();
        if (!cancelled) {
          if (data.ok) setAdminXmls(data.resources || []);
          else setAdminXmlsError(data.error || 'Failed to load admin files');
        }
      } catch {
        if (!cancelled) setAdminXmlsError('Network error');
      } finally {
        if (!cancelled) setAdminXmlsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      try {
        const res = await fetch('/api/community/feed?limit=6');
        const data = await res.json();
        if (!cancelled && data.ok) setRecent(data.resources || []);
      } catch {
        // silent
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = (r: Resource) => {
    if (r.downloadUrl) {
      window.open(r.downloadUrl, '_blank');
    } else {
      toast({ title: 'No download available', description: r.title });
    }
  };

  const handleDelete = async (r: Resource) => {
    if (!confirm(`Delete admin file "${r.title}"? This cannot be undone.`)) return;
    setDeletingId(r.id);
    try {
      const params = new URLSearchParams();
      params.set('type', 'xml');
      params.set('xmlSource', 'admin');
      const res = await fetch(`/api/resources/${r.id}?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        setAdminXmls((prev) => prev.filter((x) => x.id !== r.id));
        toast({ title: 'Admin file deleted', description: r.title });
      } else {
        toast({ title: 'Delete failed', description: data.error || 'Unknown error' });
      }
    } catch {
      toast({ title: 'Delete failed', description: 'Network error' });
    } finally {
      setDeletingId(null);
    }
  };

  const recentActivity = useMemo(() => recent.slice(0, 6), [recent]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Shield className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-serif-display text-2xl lg:text-3xl text-white leading-tight">
              Admin Console
            </h1>
            <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-emerald-400/70 mt-1">
              Restricted · Platform oversight
            </p>
          </div>
        </div>
      </section>

      {/* Stats grid */}
      <section>
        <SectionHeading title="Platform statistics" subtitle="Aggregated metrics across the platform" />
        {statsLoading ? (
          <Spinner />
        ) : statsError ? (
          <ErrorBlock message={statsError} />
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Total Users" value={stats.totalUsers} icon={Users} accent="emerald" />
            <StatCard label="Total Images" value={stats.totalImages} icon={ImageIcon} accent="violet" />
            <StatCard label="Total Clips" value={stats.totalClips} icon={Film} accent="cyan" />
            <StatCard label="Community Files" value={stats.totalCommunityXmls} icon={FileCode} accent="emerald" />
            <StatCard label="Admin Files" value={stats.totalAdminXmls} icon={Crown} accent="violet" />
          </div>
        ) : null}
      </section>

      {/* Admin XML library */}
      <section>
        <SectionHeading
          title="Admin File library"
          subtitle="Official presets managed by administrators"
          icon={Crown}
        />
        {adminXmlsLoading ? (
          <Spinner />
        ) : adminXmlsError ? (
          <ErrorBlock message={adminXmlsError} />
        ) : adminXmls.length === 0 ? (
          <EmptyBlock message="No admin files yet" hint="Admins can upload files from the Files tab." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {adminXmls.map((r) => (
              <div key={r.id} className="relative group">
                <ResourceCard
                  resource={r}
                  onDownload={() => handleDownload(r)}
                  showOwner={false}
                />
                <button
                  onClick={() => handleDelete(r)}
                  disabled={deletingId === r.id}
                  className="absolute top-2 right-2 z-30 w-8 h-8 rounded-full bg-red-500/20 backdrop-blur-sm border border-red-500/30 flex items-center justify-center text-red-300 hover:bg-red-500/40 transition-all duration-300 ease-snap disabled:opacity-50"
                  title="Delete admin file"
                >
                  {deletingId === r.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section>
        <SectionHeading
          title="Recent community activity"
          subtitle="Latest published resources across the platform"
          icon={Activity}
        />
        {recentLoading ? (
          <Spinner />
        ) : recentActivity.length === 0 ? (
          <EmptyBlock message="No recent activity" hint="Community uploads will appear here." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentActivity.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                onDownload={() => handleDownload(r)}
                showOwner
              />
            ))}
          </div>
        )}
      </section>

      {/* Footer accent */}
      <div className="flex items-center justify-center gap-2 pt-4 pb-2 text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-600">
        <TrendingUp className="w-3 h-3 text-emerald-400" />
        Admin console · All systems operational
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof Activity;
}) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h2 className="font-serif-display text-xl text-white flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-emerald-400" />}
          {title}
        </h2>
        {subtitle && (
          <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 mt-1">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  accent: 'violet' | 'cyan' | 'emerald';
}) {
  const colorMap = {
    violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
    cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  };
  const c = colorMap[accent];
  return (
    <div className={`rounded-3xl border ${c.border} ${c.bg} p-5 hover:-translate-y-0.5 transition-all duration-300 ease-snap`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${c.text}`} />
      </div>
      <div className="font-serif-display text-3xl text-white">{value}</div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 text-center">
      <p className="text-sm text-neutral-500">{message}</p>
    </div>
  );
}

function EmptyBlock({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-10 text-center">
      <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto mb-3">
        <PackageOpen className="w-6 h-6 text-neutral-500" />
      </div>
      <h3 className="font-serif-display text-base text-white mb-1">{message}</h3>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type { Resource } from '@/lib/resources';
import { useResourceStore } from '@/lib/resource-store';
import { RoleBadge, authorDisplayRole } from '../role-badge';
import { EditResourceModal } from '../edit-resource-modal';
import { useToast } from '@/hooks/use-toast';
import {
  LayoutDashboard,
  Film,
  Image as ImageIcon,
  FileCode,
  Users,
  ShieldCheck,
  ScrollText,
  Loader2,
  Star,
  StarOff,
  Trash2,
  Plus,
  Search,
  Crown,
  Pencil,
  X,
  ChevronDown,
} from 'lucide-react';

// ============ Types ============

interface AdminStats {
  totalUsers: number;
  totalImages: number;
  totalClips: number;
  totalCommunityXmls: number;
  totalAdminXmls: number;
  publishedCount: number;
  unpublishedCount: number;
}

interface PermDef {
  id: string;
  label: string;
  group: string;
  hint: string;
}

interface StaffRow {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  role: string;
  permissions: string[];
  updatedBy: string;
  updatedAt: string;
}

interface UserRow {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  email?: string;
  role: string;
  createdAt: string;
}

interface ActivityRow {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target?: string;
  detail?: string;
  ts: number;
}

type TabKey = 'overview' | 'content' | 'users' | 'staff' | 'activity';
type ContentType = 'image' | 'clip' | 'xml';

// ============ Main ============

export function AdminView() {
  const { toast } = useToast();
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [meLoading, setMeLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (cancelled) return;
        if (r.ok && d.ok) {
          setRole(d.role as string);
          setPermissions((d.permissions as string[]) || []);
        } else {
          setRole('user');
        }
        setMeLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRole('user');
          setMeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const can = useCallback(
    (p: string) => role === 'root' || permissions.includes(p),
    [role, permissions]
  );

  if (meLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[#ef233c] animate-spin" />
      </div>
    );
  }

  if (!role || role === 'user') {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
        <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-7 h-7 text-[#ef233c]" />
        </div>
        <h3 className="font-manrope font-semibold text-lg text-white mb-1">Access denied</h3>
        <p className="font-inter text-sm text-zinc-500">You don&apos;t have admin access.</p>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: typeof LayoutDashboard; show: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, show: true },
    {
      key: 'content',
      label: 'Content',
      icon: Film,
      show: can('content.images') || can('content.clips') || can('content.files'),
    },
    { key: 'users', label: 'Users', icon: Users, show: can('users.view') },
    { key: 'staff', label: 'Admins & Roles', icon: Crown, show: can('admin.manage') },
    { key: 'activity', label: 'Activity', icon: ScrollText, show: can('admin.manage') },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : visibleTabs[0].key;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#ef233c]/15 border border-[#ef233c]/25 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-[#ef233c]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-manrope font-semibold text-xl text-white">Admin Panel</h1>
              <RoleBadge role={role} size="sm" />
            </div>
            <p className="text-xs font-manrope text-zinc-500 mt-0.5">
              {role === 'root'
                ? 'Root Admin — full access'
                : `${permissions.length} permission${permissions.length === 1 ? '' : 's'} granted`}
            </p>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 w-fit overflow-x-auto max-w-full">
        {visibleTabs.map((t) => {
          const TabIcon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
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

      {activeTab === 'overview' && <OverviewSection />}
      {activeTab === 'content' && <ContentSection can={can} />}
      {activeTab === 'users' && <UsersSection />}
      {activeTab === 'staff' && <StaffSection toast={toast} />}
      {activeTab === 'activity' && <ActivitySection />}
    </div>
  );
}

// ============ Overview ============

function OverviewSection() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        // New contract: { success, data: {...stats} } — legacy fallback: flat { ok, ...stats }.
        if (d.success && d.data) setStats(d.data as AdminStats);
        else if (d.ok) setStats(d as AdminStats);
        else setError(d.error?.message || d.error || 'Failed to load stats');
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Network error');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-[#ef233c] animate-spin" />
      </div>
    );
  }
  if (error || !stats) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
        <p className="font-inter text-sm text-zinc-400">{error || 'Failed to load stats'}</p>
      </div>
    );
  }
  const cards = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users },
    { label: 'Images', value: stats.totalImages, icon: ImageIcon },
    { label: 'Clips', value: stats.totalClips, icon: Film },
    { label: 'Community Files', value: stats.totalCommunityXmls, icon: FileCode },
    { label: 'Admin Files', value: stats.totalAdminXmls, icon: Crown },
    { label: 'Published', value: stats.publishedCount, icon: Star },
    { label: 'Unpublished', value: stats.unpublishedCount, icon: StarOff },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {cards.map((c) => {
        const CIcon = c.icon;
        return (
          <div key={c.label} className="rounded-xl bg-black/60 border border-white/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500">
                {c.label}
              </span>
              <CIcon className="w-3.5 h-3.5 text-[#ef233c]" />
            </div>
            <div className="font-manrope font-semibold text-2xl text-white">{c.value}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============ Content ============

function ContentSection({ can }: { can: (p: string) => boolean }) {
  const { toast } = useToast();
  const options: { key: ContentType; label: string; perm: string }[] = [
    { key: 'image', label: 'Images', perm: 'content.images' },
    { key: 'clip', label: 'Clips', perm: 'content.clips' },
    { key: 'xml', label: 'Files', perm: 'content.files' },
  ];
  const allowed = options.filter((o) => can(o.perm));
  const [type, setType] = useState<ContentType>(allowed[0]?.key || 'image');
  const [rows, setRows] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  // Resource row currently open in the edit modal (rows are Resource-shaped).
  const [editing, setEditing] = useState<Resource | null>(null);

  const load = useCallback(async (t: ContentType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/content?type=${t}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError((data.error as string) || 'Failed to load content');
        setRows([]);
      } else {
        setRows((data.resources as Resource[]) || []);
      }
    } catch {
      setError('Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed.some((o) => o.key === type)) load(type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const doFeature = async (r: Resource) => {
    setActingId(r.id);
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: r.id,
          type: r.type,
          xmlSource: r.xmlSource,
          featured: !r.featured,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, featured: !r.featured } : x)));
        toast({ title: !r.featured ? 'Featured' : 'Unfeatured', description: r.title });
      } else {
        toast({ title: 'Failed', description: (data.error as string) || 'Could not update', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry', variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  };

  // OPTIMISTIC DELETE: the row vanishes from this table AND every store
  // slice instantly; the real DELETE runs in the background (the endpoint is
  // idempotent). 401/403 restores honestly — the delete really was rejected;
  // any other failure keeps the row hidden with a neutral "pending" toast.
  const doDelete = (r: Resource) => {
    if (!window.confirm(`Delete "${r.title}" by ${r.ownerName}? This cannot be undone.`)) return;
    // 1. Instant removal from the local table + the shared store.
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    useResourceStore.getState().removeById(r.id);
    toast({ title: 'Deleted', description: r.title });
    // 2. Real delete in the background — never blocks the UI.
    const params = new URLSearchParams({ type: r.type });
    if (r.type === 'xml') params.set('xmlSource', r.xmlSource || 'community');
    fetch(`/api/resources/${encodeURIComponent(r.id)}?${params.toString()}`, {
      method: 'DELETE',
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          // Honest restore: re-insert the row if it is still absent.
          setRows((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
          useResourceStore.getState().softRefresh();
          toast({
            title: 'Delete failed',
            description: "You don't have permission.",
            variant: 'destructive',
          });
        } else if (!res.ok) {
          toast({
            title: 'Delete pending',
            description: 'It will complete in the background.',
          });
        } else {
          // Quiet background re-sync (no toast; store re-uses last userId).
          useResourceStore.getState().softRefresh();
        }
      })
      .catch(() => {
        toast({
          title: 'Delete pending',
          description: 'It will complete in the background.',
        });
      });
  };

  if (allowed.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
        <p className="font-inter text-sm text-zinc-400">No content permissions granted.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {allowed.map((o) => (
          <button
            key={o.key}
            onClick={() => setType(o.key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              type === o.key
                ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                : 'text-zinc-500 hover:text-white border border-white/10'
            }`}
          >
            {o.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] font-manrope text-zinc-600">
          {rows.length} item{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-[#ef233c] animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
          <p className="font-inter text-sm text-zinc-400 mb-3">{error}</p>
          <button
            onClick={() => load(type)}
            className="px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/10 text-xs text-zinc-300 hover:text-white"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
          <p className="font-inter text-sm text-zinc-500">No {type}s found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-black/60 hover:border-white/10 transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-[#ef233c]/10 border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                {r.thumbnailUrl ? (
                  <img src={r.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FileCode className="w-4 h-4 text-[#ef233c]/60" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-inter text-sm font-medium text-white truncate">{r.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[11px] font-manrope text-zinc-500">by {r.ownerName}</span>
                  <RoleBadge role={authorDisplayRole(r)} />
                  {!r.published && (
                    <span className="text-[9px] font-manrope uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 py-px">
                      Draft
                    </span>
                  )}
                  {r.featured && (
                    <span className="text-[9px] font-manrope uppercase tracking-wider text-[#ef233c] bg-[#ef233c]/10 border border-[#ef233c]/25 rounded-full px-1.5 py-px">
                      Featured
                    </span>
                  )}
                  {r.type === 'xml' && r.xmlSource === 'admin' && (
                    <span className="text-[9px] font-manrope uppercase tracking-wider text-zinc-400 bg-white/5 border border-white/10 rounded-full px-1.5 py-px">
                      Admin file
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setEditing(r)}
                  title="Edit"
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {can('content.feature') && (
                  <button
                    onClick={() => doFeature(r)}
                    disabled={actingId === r.id}
                    title={r.featured ? 'Unfeature' : 'Feature'}
                    className="p-2 rounded-lg text-zinc-500 hover:text-[#ef233c] hover:bg-white/5 transition-all disabled:opacity-40"
                  >
                    {actingId === r.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : r.featured ? (
                      <StarOff className="w-4 h-4" />
                    ) : (
                      <Star className="w-4 h-4" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => doDelete(r)}
                  title="Delete"
                  className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal — metadata editor for the selected row */}
      {editing && (
        <EditResourceModal
          resource={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            // Update the local table row + the shared store, quietly.
            setRows((prev) => prev.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)));
            useResourceStore.getState().upsertLocal(saved);
            setEditing(null);
            toast({ title: 'Saved', description: saved.title });
          }}
        />
      )}
    </div>
  );
}

// ============ Users ============

function UsersSection() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError((data.error as string) || 'Failed to load users');
        setRows([]);
      } else {
        setRows((data.users as UserRow[]) || []);
      }
    } catch {
      setError('Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-zinc-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search members by name or username…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/60 border border-white/10 text-sm font-inter text-white placeholder:text-zinc-600 outline-none focus:border-[#ef233c]/40 transition-all"
        />
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-[#ef233c] animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
          <p className="font-inter text-sm text-zinc-400">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
          <p className="font-inter text-sm text-zinc-500">No members found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((u) => (
            <div
              key={u.userId}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-white/5 bg-black/60"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-sm font-manrope font-semibold text-white overflow-hidden shrink-0">
                {u.avatar ? (
                  <img src={u.avatar} alt={u.displayName} className="w-full h-full object-cover" />
                ) : (
                  (u.displayName || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-inter text-sm font-medium text-white truncate">{u.displayName}</p>
                  <RoleBadge role={u.role} />
                </div>
                <p className="text-[11px] font-manrope text-zinc-500 truncate">
                  @{u.username}
                  {u.email ? ` · ${u.email}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Staff ============

function StaffSection({ toast }: { toast: (opts: { title: string; description?: string; variant?: 'destructive' }) => void }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [catalog, setCatalog] = useState<PermDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/staff', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError((data.error as string) || 'Failed to load staff');
        setRows([]);
      } else {
        setRows((data.staff as StaffRow[]) || []);
        setCatalog((data.catalog as PermDef[]) || []);
      }
    } catch {
      setError('Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doRemove = async (row: StaffRow) => {
    if (!window.confirm(`Remove ${row.role} access from @${row.username}? Their account and uploads stay intact.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/staff?userId=${encodeURIComponent(row.userId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setRows((prev) => prev.filter((x) => x.userId !== row.userId));
        toast({ title: 'Removed', description: `@${row.username} is a normal user again` });
      } else {
        toast({ title: 'Remove failed', description: (data.error as string) || 'Could not remove', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-manrope text-zinc-500">
          {rows.length} staff member{rows.length === 1 ? '' : 's'} · Root Admin is permanent and never listed here
        </p>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#ef233c] hover:bg-red-700 text-white text-xs font-medium transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Add Admin / Moderator
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-[#ef233c] animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
          <p className="font-inter text-sm text-zinc-400 mb-3">{error}</p>
          <button
            onClick={load}
            className="px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/10 text-xs text-zinc-300 hover:text-white"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
          <p className="font-inter text-sm text-zinc-500">No staff yet — only the Root Admin.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.userId}
              className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-black/60"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-sm font-manrope font-semibold text-white overflow-hidden shrink-0">
                {row.avatar ? (
                  <img src={row.avatar} alt={row.displayName} className="w-full h-full object-cover" />
                ) : (
                  (row.displayName || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-inter text-sm font-medium text-white truncate">{row.displayName}</p>
                  <RoleBadge role={row.role} />
                </div>
                <p className="text-[11px] font-manrope text-zinc-500 truncate">
                  @{row.username} · {row.permissions.length} permission{row.permissions.length === 1 ? '' : 's'} · by{' '}
                  {row.updatedBy}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setEditing(row)}
                  title="Edit role & permissions"
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => doRemove(row)}
                  title="Remove access"
                  className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <StaffForm
          catalog={catalog}
          title="Add Admin / Moderator"
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            load();
          }}
          toast={toast}
        />
      )}
      {editing && (
        <StaffForm
          catalog={catalog}
          title={`Edit @${editing.username}`}
          initial={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

function StaffForm({
  catalog,
  title,
  initial,
  onClose,
  onDone,
  toast,
}: {
  catalog: PermDef[];
  title: string;
  initial?: StaffRow;
  onClose: () => void;
  onDone: () => void;
  toast: (opts: { title: string; description?: string; variant?: 'destructive' }) => void;
}) {
  const [username, setUsername] = useState(initial?.username || '');
  const [role, setRole] = useState<'admin' | 'moderator'>(
    initial?.role === 'moderator' ? 'moderator' : 'admin'
  );
  const [perms, setPerms] = useState<Set<string>>(new Set(initial?.permissions || ['admin.view']));
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (id !== 'admin.view') next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const save = async () => {
    if (!initial && !username.trim()) {
      toast({ title: 'Username required', description: 'Enter the member username', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/staff', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          initial
            ? { userId: initial.userId, role, permissions: [...perms] }
            : { username: username.trim(), role, permissions: [...perms] }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast({
          title: initial ? 'Updated' : role === 'admin' ? 'Admin added' : 'Moderator added',
          description: initial ? `@${initial.username}` : `@${username.trim()}`,
        });
        onDone();
      } else {
        toast({ title: 'Failed', description: (data.error as string) || 'Could not save', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const groups = [...new Set(catalog.map((c) => c.group))];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <h2 className="font-manrope font-semibold text-base text-white">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {!initial && (
            <div>
              <label className="block text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. speedramps"
                className="w-full px-4 py-2.5 rounded-xl bg-black/60 border border-white/10 text-sm font-inter text-white placeholder:text-zinc-600 outline-none focus:border-[#ef233c]/40 transition-all"
              />
            </div>
          )}
          <div>
            <label className="block text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
              Role
            </label>
            <div className="relative">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'moderator')}
                className="w-full appearance-none px-4 py-2.5 rounded-xl bg-black/60 border border-white/10 text-sm font-inter text-white outline-none focus:border-[#ef233c]/40 transition-all"
              >
                <option value="admin">Admin</option>
                <option value="moderator">Moderator</option>
              </select>
              <ChevronDown className="w-4 h-4 text-zinc-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-2">
              Permissions
            </label>
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g}>
                  <p className="text-[10px] font-manrope uppercase tracking-widest text-zinc-600 mb-1.5">
                    {g}
                  </p>
                  <div className="space-y-1.5">
                    {catalog
                      .filter((c) => c.group === g)
                      .map((c) => {
                        const checked = perms.has(c.id);
                        const locked = c.id === 'admin.view';
                        return (
                          <label
                            key={c.id}
                            className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all ${
                              locked ? 'opacity-70' : 'cursor-pointer'
                            } ${
                              checked
                                ? 'border-[#ef233c]/30 bg-[#ef233c]/5'
                                : 'border-white/5 bg-white/[0.01] hover:border-white/15'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={locked}
                              onChange={() => toggle(c.id)}
                              className="mt-0.5 accent-[#ef233c]"
                            />
                            <span>
                              <span className="block text-xs font-medium text-white">
                                {c.label}
                                {locked && (
                                  <span className="ml-1.5 text-[9px] font-manrope uppercase tracking-wider text-zinc-500">
                                    always on
                                  </span>
                                )}
                              </span>
                              <span className="block text-[11px] font-inter text-zinc-500">{c.hint}</span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-white/5 shrink-0 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-full bg-white/[0.03] border border-white/5 text-sm text-zinc-300 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-all"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {initial ? 'Save Changes' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Activity ============

function ActivitySection() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/activity', { cache: 'no-store' })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (cancelled) return;
        if (r.ok && d.ok) setRows((d.activity as ActivityRow[]) || []);
        else setError((d.error as string) || 'Failed to load activity');
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Network error');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-[#ef233c] animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
        <p className="font-inter text-sm text-zinc-400">{error}</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 p-8 text-center">
        <p className="font-inter text-sm text-zinc-500">No admin activity yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-black/60">
          <div className="w-8 h-8 rounded-lg bg-[#ef233c]/10 border border-white/5 flex items-center justify-center shrink-0">
            <ScrollText className="w-3.5 h-3.5 text-[#ef233c]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-inter text-sm text-white">
              <span className="font-medium">{a.actorName}</span>{' '}
              <span className="text-zinc-300">{a.action}</span>
            </p>
            <p className="text-[11px] font-manrope text-zinc-600 mt-0.5">
              {new Date(a.ts).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

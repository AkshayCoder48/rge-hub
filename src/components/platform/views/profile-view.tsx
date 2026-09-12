'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Resource, ResourceType } from '@/lib/resources';
import { ResourceCard } from '../resource-card';
import { ResourceDetailModal } from '../resource-detail-modal';
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
  Pencil,
  X,
  Upload,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

type TabKey = ResourceType;

interface ProfileData {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  createdAt: string;
}

type FetchState = 'loading' | 'not-found' | 'error' | 'ready';

export function ProfileView() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [tab, setTab] = useState<TabKey>('image');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [selected, setSelected] = useState<Resource | null>(null);

  const fetchProfile = useCallback(async (username: string) => {
    setFetchState('loading');
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.ok) {
        setProfile(data.profile);
        setResources(data.resources || []);
        setFetchState('ready');
      } else if (data.error === 'User not found') {
        setFetchState('not-found');
      } else {
        setFetchState('error');
      }
    } catch {
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    if (!user?.username) return;
    fetchProfile(user.username);
  }, [user?.username, fetchProfile, profileVersion]);

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

  const handleDownload = useCallback(
    (r: Resource) => {
      if (r.downloadUrl) {
        window.open(r.downloadUrl, '_blank');
      } else {
        toast({ title: 'No download available', description: r.title });
      }
    },
    [toast]
  );

  const handleDelete = useCallback(
    async (r: Resource) => {
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
    },
    [toast]
  );

  const handleEditSaved = useCallback(() => {
    // Re-fetch profile and refresh auth context in parallel
    setProfileVersion((v) => v + 1);
    refresh();
  }, [refresh]);

  const tabs: {
    key: TabKey;
    label: string;
    icon: typeof ImageIcon;
    count: number;
    color: string;
  }[] = [
    { key: 'image', label: 'Images', icon: ImageIcon, count: counts.image, color: 'text-violet-400' },
    { key: 'clip', label: 'Clips', icon: Film, count: counts.clip, color: 'text-cyan-400' },
    { key: 'xml', label: 'XMLs', icon: FileCode, count: counts.xml, color: 'text-emerald-400' },
  ];

  // --- Loading state ---
  if (fetchState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
        <p className="text-sm text-neutral-500">Loading profile...</p>
      </div>
    );
  }

  // --- Error state (network / server) ---
  if (fetchState === 'error') {
    return (
      <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <h3 className="font-serif-display text-lg text-white mb-1">Unable to load profile</h3>
        <p className="text-sm text-neutral-500 mb-6">
          Unable to load profile right now. Please try again.
        </p>
        <button
          onClick={() => user?.username && fetchProfile(user.username)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-medium hover:from-violet-400 hover:to-cyan-400 transition-all duration-300 ease-snap"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  // --- Not found state (explicit 404 from API) ---
  if (fetchState === 'not-found' || !profile) {
    return (
      <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto mb-4">
          <UserIcon className="w-7 h-7 text-neutral-500" />
        </div>
        <h3 className="font-serif-display text-lg text-white mb-1">User not found</h3>
        <p className="text-sm text-neutral-500">This profile does not exist.</p>
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

  // Viewing own profile: user.username === profile.username (always true here since we fetch by user.username)
  const isOwnProfile = !!user && user.username === profile.username;

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-6">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center text-2xl font-serif-display text-white overflow-hidden shrink-0">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.displayName} className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="font-serif-display text-2xl lg:text-3xl text-white leading-tight truncate">
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
              </div>

              {isOwnProfile && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs font-mono-display text-neutral-300 hover:text-white hover:bg-white/[0.06] hover:border-violet-500/30 transition-all duration-300 ease-snap"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit Profile
                </button>
              )}
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
              <span
                className={`text-[9px] font-mono-display px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-neutral-600'
                }`}
              >
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
                  <span className="text-[9px] font-mono-display uppercase tracking-wider text-amber-300">
                    Draft
                  </span>
                </div>
              )}
              <ResourceCard
                resource={r}
                onClick={() => setSelected(r)}
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

      {/* Edit Profile Modal */}
      {editOpen && isOwnProfile && profile && (
        <EditProfileModal
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            handleEditSaved();
          }}
        />
      )}

      {/* Resource detail modal — own profile: allow delete */}
      {selected && (
        <ResourceDetailModal
          resource={selected}
          onClose={() => setSelected(null)}
          onDownload={handleDownload}
          canDelete={isOwnProfile}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ============ Edit Profile Modal ============

interface EditProfileModalProps {
  profile: ProfileData;
  onClose: () => void;
  onSaved: () => void;
}

function EditProfileModal({ profile, onClose, onSaved }: EditProfileModalProps) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatar || null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URL when unmounting / changing file
  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Invalid file', description: 'Please select an image file', variant: 'destructive' });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: 'File too large', description: 'Image must be under 10MB', variant: 'destructive' });
        return;
      }
      // Revoke any previous blob URL
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview);
      }
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    },
    [avatarPreview, toast]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const trimmedDisplay = displayName.trim();
      const trimmedUsername = username.trim().toLowerCase();
      const trimmedBio = bio;

      if (!trimmedDisplay) {
        toast({ title: 'Display name required', variant: 'destructive' });
        setSaving(false);
        return;
      }
      if (!/^[a-z0-9_]{3,20}$/.test(trimmedUsername)) {
        toast({
          title: 'Invalid username',
          description: '3-20 chars: lowercase letters, numbers, underscores',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }

      // 1. Upload avatar if changed
      let newAvatarUrl: string | undefined;
      if (avatarFile) {
        const formData = new FormData();
        formData.append('file', avatarFile);
        const avatarRes = await fetch('/api/profile/avatar', {
          method: 'POST',
          body: formData,
        });
        const avatarData = await avatarRes.json();
        if (!avatarData.ok) {
          throw new Error(avatarData.error || 'Avatar upload failed');
        }
        newAvatarUrl = avatarData.avatarUrl;
      }

      // 2. Build PATCH body with only changed fields
      const patchBody: { displayName?: string; bio?: string; username?: string; avatar?: string } = {};
      if (trimmedDisplay !== profile.displayName) patchBody.displayName = trimmedDisplay;
      if (trimmedBio !== profile.bio) patchBody.bio = trimmedBio;
      if (trimmedUsername !== profile.username.toLowerCase()) patchBody.username = trimmedUsername;
      if (newAvatarUrl !== undefined) patchBody.avatar = newAvatarUrl;

      // 3. PATCH if any field changed
      if (Object.keys(patchBody).length > 0) {
        const updateRes = await fetch('/api/profile/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
        const updateData = await updateRes.json();
        if (!updateData.ok) {
          throw new Error(updateData.error || 'Profile update failed');
        }
      }

      toast({ title: 'Profile updated', description: 'Your changes have been saved' });
      onSaved();
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [displayName, username, bio, avatarFile, profile, toast, onSaved]);

  const initials = profile.displayName
    .split(' ')
    .map((s) => s.charAt(0))
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg glass rounded-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="font-serif-display text-lg text-white">Edit Profile</h2>
              <p className="text-[10px] font-mono-display uppercase tracking-wider text-neutral-500">
                Update your public profile
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Avatar uploader */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center text-xl font-serif-display text-white overflow-hidden shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs font-mono-display text-neutral-300 hover:text-white hover:bg-white/[0.06] transition-all duration-300 ease-snap"
              >
                <Upload className="w-3.5 h-3.5" />
                {avatarFile ? 'Change image' : 'Upload avatar'}
              </button>
              {avatarFile && (
                <button
                  onClick={() => {
                    if (avatarPreview && avatarPreview.startsWith('blob:')) {
                      URL.revokeObjectURL(avatarPreview);
                    }
                    setAvatarFile(null);
                    setAvatarPreview(profile.avatar || null);
                  }}
                  className="ml-2 text-xs text-neutral-500 hover:text-white transition-colors"
                >
                  Remove
                </button>
              )}
              <p className="text-[10px] font-mono-display text-neutral-600 mt-1.5">
                PNG/JPG up to 10MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-white focus:border-violet-500/30 focus:outline-none transition-colors"
            />
          </div>

          {/* Username */}
          <div>
            <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">
              Username
            </label>
            <div className="flex items-center rounded-xl bg-white/[0.03] border border-white/5 focus-within:border-violet-500/30 transition-colors">
              <span className="pl-3 text-sm text-neutral-500 font-mono-display">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                maxLength={20}
                className="flex-1 px-1.5 py-2 bg-transparent text-sm text-white font-mono-display focus:outline-none"
              />
            </div>
            <p className="text-[10px] font-mono-display text-neutral-600 mt-1.5">
              3-20 chars: lowercase letters, numbers, underscores
            </p>
          </div>

          {/* Bio */}
          <div>
            <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Tell the community about yourself..."
              className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 resize-none focus:border-violet-500/30 focus:outline-none transition-colors"
            />
            <p className="text-[10px] font-mono-display text-neutral-600 mt-1.5 text-right">
              {bio.length}/300
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-all duration-300 ease-snap disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-medium hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Stat Block ============

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
        <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500">
          {label}
        </span>
        <Icon className={`w-3.5 h-3.5 ${c.text}`} />
      </div>
      <div className="font-serif-display text-2xl text-white">{value}</div>
    </div>
  );
}

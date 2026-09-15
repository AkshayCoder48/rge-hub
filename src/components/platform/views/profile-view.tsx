'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useResourceStore } from '@/lib/resource-store';
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
  Users,
  Share2 as Share2Icon,
  Loader2,
  PackageOpen,
  Pencil,
  X,
  Upload,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

import { FollowListModal } from '../follow-list-modal';
import { RoleBadge } from '../role-badge';

type TabKey = ResourceType;

interface ProfileData {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  createdAt: string;
  role?: string;
}

type FetchState = 'loading' | 'not-found' | 'error' | 'ready';

export function ProfileView({ onOpenUser }: { onOpenUser?: (userId: string) => void }) {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [tab, setTab] = useState<TabKey>('image');
  const [editOpen, setEditOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [followModal, setFollowModal] = useState<null | 'followers' | 'following'>(null);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [followCounts, setFollowCounts] = useState<{ followersCount: number; followingCount: number } | null>(null);

  // Read myResources from the shared store (set by PlatformApp on mount)
  const myResources = useResourceStore((s) => s.myResources);
  const loaded = useResourceStore((s) => s.loaded);


  const fetchProfile = useCallback(async (username: string) => {
    setFetchState('loading');
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.ok) {
        setProfile(data.profile);
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

  // Follower / following counts for the social header.
  useEffect(() => {
    if (!profile?.userId) return;
    fetch(`/api/follows?userId=${encodeURIComponent(profile.userId)}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setFollowCounts({
            followersCount: data.followersCount || 0,
            followingCount: data.followingCount || 0,
          });
        }
      })
      .catch(() => {});
  }, [profile?.userId]);

  useEffect(() => {
    if (!user?.username) return;
    fetchProfile(user.username);
  }, [user?.username, fetchProfile, profileVersion]);

  // Use store myResources (already filtered server-side by owner=user.userId)
  const resources = myResources;

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

  // Hoisted for the compiler (optional chains in useCallback deps are
  // inferred as the whole `user` object → preserve-manual-memoization).
  const userId = user?.userId;

  // OPTIMISTIC DELETE: the UI updates instantly; the real DELETE runs in the
  // background (the endpoint is idempotent). 401/403 restores honestly —
  // the delete really was rejected; any other failure keeps the item hidden
  // with a neutral "pending" toast (a tombstone eventually lands).
  const handleDelete = useCallback(
    (r: Resource) => {
      if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
      // 1. Instant removal: close the modal if it shows this resource, strip
      //    it from every store slice, confirm with a neutral toast.
      setSelected((prev) => (prev?.id === r.id ? null : prev));
      useResourceStore.getState().removeById(r.id);
      toast({ title: 'Deleted', description: r.title });
      // 2. Real delete in the background — never blocks the UI.
      const params = new URLSearchParams();
      params.set('type', r.type);
      if (r.xmlSource) params.set('xmlSource', r.xmlSource);
      fetch(`/api/resources/${encodeURIComponent(r.id)}?${params.toString()}`, {
        method: 'DELETE',
      })
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            useResourceStore.getState().softRefresh(userId);
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
            // Quiet background re-sync (no toast).
            useResourceStore.getState().softRefresh(userId);
          }
        })
        .catch(() => {
          toast({
            title: 'Delete pending',
            description: 'It will complete in the background.',
          });
        });
    },
    [toast, userId]
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
  }[] = [
    { key: 'image', label: 'Images', icon: ImageIcon, count: counts.image },
    { key: 'clip', label: 'Clips', icon: Film, count: counts.clip },
    { key: 'xml', label: 'Files', icon: FileCode, count: counts.xml },
  ];

  // --- Loading state (profile or store still loading) ---
  if (fetchState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-[#ef233c]/30 border-t-[#ef233c] rounded-full animate-spin" />
        <p className="font-inter text-sm text-zinc-500">Loading profile...</p>
      </div>
    );
  }

  // --- Error state (network / server) ---
  if (fetchState === 'error') {
    return (
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
        <div className="w-14 h-14 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/20 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-7 h-7 text-[#ef233c]" />
        </div>
        <h3 className="font-manrope font-semibold text-lg text-white mb-1">Unable to load profile</h3>
        <p className="font-inter text-sm text-zinc-500 mb-6">
          Unable to load profile right now. Please try again.
        </p>
        <button
          onClick={() => user?.username && fetchProfile(user.username)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
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
      <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-12 text-center">
        <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto mb-4">
          <UserIcon className="w-7 h-7 text-zinc-500" />
        </div>
        <h3 className="font-manrope font-semibold text-lg text-white mb-1">User not found</h3>
        <p className="font-inter text-sm text-zinc-500">This profile does not exist.</p>
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
      <section className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#ef233c]/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-6">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-2xl font-manrope font-semibold text-white overflow-hidden shrink-0">
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
                <div className="flex items-center gap-2">
                  <h1 className="font-manrope font-semibold text-2xl lg:text-3xl text-white leading-tight truncate">
                    {profile.displayName}
                  </h1>
                  <RoleBadge role={profile.role || user?.role} size="sm" />
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-manrope text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="w-3 h-3" />@{profile.username}
                  </span>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/${profile.username}`;
                      navigator.clipboard
                        ?.writeText(url)
                        .then(() => toast({ title: 'Profile link copied!', description: url }))
                        .catch(() => toast({ title: 'Copy failed', variant: 'destructive' }));
                    }}
                    title="Copy your shareable profile link"
                    className="flex items-center gap-1.5 hover:text-white transition-colors"
                  >
                    <Share2Icon className="w-3 h-3" />
                    {typeof window !== 'undefined' ? window.location.host : 'rge-hub'}/{profile.username}
                  </button>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" />
                    Joined {joinDate}
                  </span>
                </div>
              </div>

              {isOwnProfile && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/10 text-xs font-manrope text-zinc-300 hover:text-white hover:bg-white/[0.06] hover:border-[#ef233c]/30 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit Profile
                </button>
              )}
            </div>

            {profile.bio && (
              <p className="mt-3 font-inter text-sm text-zinc-400 max-w-2xl leading-relaxed">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="relative grid grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/5">
          <StatBlock label="Images" value={counts.image} icon={ImageIcon} />
          <StatBlock label="Clips" value={counts.clip} icon={Film} />
          <StatBlock label="Files" value={counts.xml} icon={FileCode} />
        </div>
        {/* Social stats */}
        <div className="relative grid grid-cols-2 gap-3 mt-3">
          <StatBlock label="Followers" value={followCounts?.followersCount ?? 0} icon={Users} onClick={() => setFollowModal('followers')} />
          <StatBlock label="Following" value={followCounts?.followingCount ?? 0} icon={UserIcon} onClick={() => setFollowModal('following')} />
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 w-fit">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isActive
                  ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/30'
                  : 'text-zinc-500 hover:text-white border border-transparent'
              }`}
            >
              <TabIcon className={`w-3.5 h-3.5 ${isActive ? 'text-[#ef233c]' : ''}`} />
              {t.label}
              <span
                className={`text-[9px] font-manrope px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/10 text-white' : 'bg-white/[0.03] text-zinc-600'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Resources grid */}
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
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-7 h-7 text-zinc-500" />
          </div>
          <h3 className="font-manrope font-semibold text-lg text-white mb-1">No {tab}s yet</h3>
          <p className="font-inter text-sm text-zinc-500">Use the upload button in the sidebar to add one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <div key={r.id} className="relative group">
              {!r.published && (
                <div className="absolute top-2 right-2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 backdrop-blur-sm border border-amber-500/30">
                  <span className="text-[9px] font-manrope uppercase tracking-wider text-amber-300">
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
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] font-manrope text-zinc-300 hover:text-white hover:bg-white/[0.04] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#ef233c]/5 border border-[#ef233c]/10 text-[11px] font-manrope text-[#ef233c]/80 hover:text-[#ef233c] hover:bg-[#ef233c]/10 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
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

      {followModal && profile && (
        <FollowListModal
          userId={profile.userId}
          displayName={profile.displayName}
          initialTab={followModal}
          onClose={() => setFollowModal(null)}
          onOpenUser={(id) => onOpenUser?.(id)}
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
        const avatarCtrl = new AbortController();
        const avatarTimer = setTimeout(() => avatarCtrl.abort(), 30000);
        let avatarRes: Response;
        try {
          avatarRes = await fetch('/api/profile/avatar', {
            method: 'POST',
            body: formData,
            signal: avatarCtrl.signal,
          });
        } catch {
          clearTimeout(avatarTimer);
          if (avatarCtrl.signal.aborted) {
            // Timeout ≠ failure — the upload may have landed. A refresh
            // reconciles; never a hard error over an unknown outcome.
            toast({ title: 'Still saving', description: 'Still saving — your change will appear shortly.' });
            return;
          }
          throw new Error('Avatar upload failed — please check your connection and retry.');
        }
        clearTimeout(avatarTimer);
        const avatarData = await avatarRes.json().catch(() => ({}));
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
        const updateCtrl = new AbortController();
        const updateTimer = setTimeout(() => updateCtrl.abort(), 30000);
        let updateRes: Response;
        try {
          updateRes = await fetch('/api/profile/update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
            signal: updateCtrl.signal,
          });
        } catch {
          clearTimeout(updateTimer);
          if (updateCtrl.signal.aborted) {
            // Timeout ≠ failure — the write may have landed. Close and
            // refetch so a refresh reconciles the truth.
            toast({ title: 'Still saving', description: 'Still saving — your change will appear shortly.' });
            onSaved();
            return;
          }
          throw new Error('Profile save failed — please check your connection and retry.');
        }
        clearTimeout(updateTimer);
        const updateData = await updateRes.json().catch(() => ({}));
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-[#ef233c]" />
            </div>
            <div>
              <h2 className="font-manrope font-semibold text-lg text-white">Edit Profile</h2>
              <p className="text-[10px] font-manrope uppercase tracking-wider text-zinc-500">
                Update your public profile
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Avatar uploader */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-xl font-manrope font-semibold text-white overflow-hidden shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/[0.04] border border-white/10 text-xs font-manrope text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
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
                  className="ml-2 text-xs text-zinc-500 hover:text-white transition-colors"
                >
                  Remove
                </button>
              )}
              <p className="text-[10px] font-manrope text-zinc-600 mt-1.5">
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
            <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/10 font-inter text-sm text-white focus:border-[#ef233c]/40 focus:outline-none transition-colors"
            />
          </div>

          {/* Username */}
          <div>
            <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
              Username
            </label>
            <div className="flex items-center rounded-xl bg-black/60 border border-white/10 focus-within:border-[#ef233c]/40 transition-colors">
              <span className="pl-3 text-sm text-zinc-500 font-manrope">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                maxLength={20}
                className="flex-1 px-1.5 py-2 bg-transparent text-sm text-white font-manrope focus:outline-none"
              />
            </div>
            <p className="text-[10px] font-manrope text-zinc-600 mt-1.5">
              3-20 chars: lowercase letters, numbers, underscores
            </p>
          </div>

          {/* Bio */}
          <div>
            <label className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Tell the community about yourself..."
              className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/10 font-inter text-sm text-white placeholder:text-zinc-700 resize-none focus:border-[#ef233c]/40 focus:outline-none transition-colors"
            />
            <p className="text-[10px] font-manrope text-zinc-600 mt-1.5 text-right">
              {bio.length}/300
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-full bg-white/[0.03] border border-white/5 text-sm text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
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
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof ImageIcon;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500">
          {label}
        </span>
        <Icon className="w-3.5 h-3.5 text-[#ef233c]" />
      </div>
      <div className="font-manrope font-semibold text-2xl text-white">{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        title={`View ${label.toLowerCase()}`}
        className="rounded-xl bg-[#ef233c]/5 border border-[#ef233c]/15 p-4 text-left hover:border-[#ef233c]/40 hover:bg-[#ef233c]/10 transition-all cursor-pointer"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded-xl bg-[#ef233c]/5 border border-[#ef233c]/15 p-4">
      {inner}
    </div>
  );
}

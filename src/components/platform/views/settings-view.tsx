'use client';

/**
 * Settings view (sidebar → Settings).
 *
 * Sections:
 *   Account     — inline edit of displayName / username / bio / avatar
 *                 (PATCH /api/profile/update, only-changed fields) with
 *                 email + "Member since" shown read-only.
 *   Security    — change password (OTP purpose=password_reset → verify →
 *                 resetToken → /api/auth/reset-password) and API key reveal
 *                 (GET /api/account/details).
 *   Preferences — localStorage-backed toggles (autoplay, confirm-before-
 *                 delete, reduced motion) applied instantly.
 *   Sign out    — ends the session.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { usePreferences } from '@/lib/preferences';
import { api, newIdempotencyKey, TIMEOUTS, type ApiError } from '@/lib/api-client';
import { Switch } from '@/components/ui/switch';
import { useAgentStore } from '@/lib/agent-store';
import { maskApiKey, isConfigured } from '@/lib/agent/config';
import type { AgentConfig } from '@/lib/agent/types';
import {
  User as UserIcon,
  ShieldCheck,
  KeyRound,
  Loader2,
  Pencil,
  Upload,
  Copy,
  LogOut,
  RefreshCw,
  AlertCircle,
  SlidersHorizontal,
  Bot,
  FlaskConical,
  Trash2,
  TriangleAlert,
  ArrowRight,
} from 'lucide-react';

// ============ Shared bits ============

/** Class constants (Red Noir) — inputs / buttons / labels match the spec. */
const INPUT_CLS =
  'w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:border-[#ef233c] focus:outline-none transition-colors';
const LABEL_CLS =
  'text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5';
const PRIMARY_BTN_CLS =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white font-bold text-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:pointer-events-none';

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof UserIcon;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[#ef233c]" />
        </div>
        <div className="min-w-0">
          <h2 className="font-manrope font-semibold text-base text-white">{title}</h2>
          <p className="text-[11px] font-inter text-zinc-500 truncate">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honest copy for a lost connection — no claims about future success. */
const CONNECTION_PROBLEM =
  "Couldn't reach the server — check your connection and try again.";

// ============ OTP contracts (mirrors auth-screen.tsx) ============

/** POST /api/auth/otp/send success payload. */
interface OtpSendData {
  message: string;
  alreadySent: boolean;
  /** Server-issued reference for the code in flight — required to verify. */
  otpRef: string;
  expiresInMs: number;
  purpose: 'registration' | 'password_reset';
}

/** POST /api/auth/otp/verify success payload. */
interface OtpVerifyData {
  verified: boolean;
  purpose: 'registration' | 'password_reset';
  /** Signed token authorizing /api/auth/reset-password. */
  resetToken?: string;
}

/** Extra fields the OTP endpoints attach to error bodies. */
type OtpError = ApiError & { otpRef?: string; remainingAttempts?: number };

// ============ Profile shape ============

interface SettingsProfile {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  bio?: string;
  avatar?: string;
  createdAt: string;
}

// ============ Main view ============

interface SettingsViewProps {
  onOpenSelfProfile?: () => void;
  /** Opens the in-app Public API + MCP documentation (Developers → API Docs). */
  onOpenApiDocs?: () => void;
}

export function SettingsView({ onOpenSelfProfile, onOpenApiDocs }: SettingsViewProps) {
  const { user, refresh, logout } = useAuth();

  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [fetchState, setFetchState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [profileVersion, setProfileVersion] = useState(0);

  const username = user?.username;

  // Fetch the signed-in user's profile (same endpoint as the profile view).
  useEffect(() => {
    let cancelled = false;
    if (!username) {
      return () => {
        cancelled = true;
      };
    }
    // Deferred (queueMicrotask) — no setState synchronously in the effect body.
    queueMicrotask(() => {
      if (cancelled) return;
      // Stale-while-revalidate: once the form is showing data, a background
      // re-fetch (post-save reconcile) never flashes the spinner — only the
      // FIRST load does.
      setFetchState((s) => (s === 'ready' ? 'ready' : 'loading'));
      fetch(`/api/profile/${encodeURIComponent(username)}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data.ok && data.profile) {
            setProfile(data.profile as SettingsProfile);
            setFetchState('ready');
          } else {
            // Keep showing what we have (post-save reconcile); only a cold
            // load turns into the error state.
            setFetchState((s) => (s === 'ready' ? 'ready' : 'error'));
          }
        })
        .catch(() => {
          if (!cancelled) setFetchState((s) => (s === 'ready' ? 'ready' : 'error'));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [username, profileVersion]);

  /** After an account save: overlay the locally-known values, re-fetch + refresh auth. */
  const handleAccountSaved = useCallback(
    (overlay: { displayName?: string; username?: string; bio?: string; avatar?: string }) => {
      setProfile((p) => (p ? { ...p, ...overlay } : p));
      setProfileVersion((v) => v + 1); // re-fetch in the background to reconcile
      refresh();
    },
    [refresh]
  );

  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ============ Account ============ */}
      <SectionCard
        icon={UserIcon}
        title="Account"
        subtitle="Your public profile and account details"
      >
        {fetchState === 'loading' ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-[#ef233c]/30 border-t-[#ef233c] rounded-full animate-spin" />
          </div>
        ) : fetchState === 'error' || !profile ? (
          <div className="text-center py-6 space-y-3">
            <p className="font-inter text-sm text-zinc-500">
              Couldn&apos;t load your profile right now.
            </p>
            <button
              onClick={() => setProfileVersion((v) => v + 1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : (
          <AccountSection
            key={`account-${profileVersion}-${profile.userId}`}
            profile={profile}
            memberSince={memberSince}
            onSaved={handleAccountSaved}
            onOpenSelfProfile={onOpenSelfProfile}
          />
        )}
      </SectionCard>

      {/* ============ Security: change password ============ */}
      <SectionCard
        icon={KeyRound}
        title="Change password"
        subtitle="Verify with a code sent to your email"
      >
        <ChangePasswordCard
          email={fetchState === 'ready' ? profile?.email : undefined}
          onPasswordChanged={refresh}
        />
      </SectionCard>

      {/* ============ Security: API key ============ */}
      <SectionCard icon={ShieldCheck} title="API key" subtitle="Programmatic access to your account">
        <ApiKeyCard onOpenApiDocs={onOpenApiDocs} />
      </SectionCard>

      {/* ============ AI Agent ============ */}
      <SectionCard
        icon={Bot}
        title="AI Agent"
        subtitle="The brain behind RGE Agent — built-in or any OpenAI-compatible API"
      >
        <AgentConfigCard />
      </SectionCard>

      {/* ============ Preferences ============ */}
      <SectionCard
        icon={SlidersHorizontal}
        title="Preferences"
        subtitle="Applied instantly — stored on this device"
      >
        <PreferencesCard />
      </SectionCard>

      {/* ============ Sign out ============ */}
      <SignOutCard logout={logout} />

      {/* ============ Danger zone: delete account ============ */}
      <DangerZoneCard logout={logout} />
    </div>
  );
}

// ============ Account section ============

function AccountSection({
  profile,
  memberSince,
  onSaved,
  onOpenSelfProfile,
}: {
  profile: SettingsProfile;
  memberSince: string | null;
  onSaved: (overlay: {
    displayName?: string;
    username?: string;
    bio?: string;
    avatar?: string;
  }) => void;
  onOpenSelfProfile?: () => void;
}) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatar || null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URL when unmounting / changing file (EditProfileModal pattern).
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
            // Timeout ≠ failure — the write may have landed. Overlay + refetch
            // so a refresh reconciles the truth.
            toast({ title: 'Still saving', description: 'Still saving — your change will appear shortly.' });
            onSaved(patchBody);
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
      onSaved(patchBody);
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
    <div className="space-y-5">
      {/* Avatar uploader */}
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ef233c]/30 to-zinc-800 border border-white/10 flex items-center justify-center text-xl font-manrope font-semibold text-white overflow-hidden shrink-0">
          {avatarPreview ? (
            <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1 min-w-0">
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
          <p className="text-[10px] font-manrope text-zinc-600 mt-1.5">PNG/JPG up to 10MB</p>
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
        <label className={LABEL_CLS}>Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
          className={INPUT_CLS}
        />
      </div>

      {/* Username */}
      <div>
        <label className={LABEL_CLS}>Username</label>
        <div className="flex items-center rounded-xl bg-white/5 border border-white/10 focus-within:border-[#ef233c] transition-colors">
          <span className="pl-4 text-sm text-zinc-500 font-manrope">@</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            maxLength={20}
            className="flex-1 px-1.5 py-3 bg-transparent text-sm text-white font-manrope focus:outline-none"
          />
        </div>
        <p className="text-[10px] font-manrope text-zinc-600 mt-1.5">
          3-20 chars: lowercase letters, numbers, underscores
        </p>
      </div>

      {/* Bio */}
      <div>
        <label className={LABEL_CLS}>Bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="Tell the community about yourself..."
          className={`${INPUT_CLS} resize-none`}
        />
        <p className="text-[10px] font-manrope text-zinc-600 mt-1.5 text-right">{bio.length}/300</p>
      </div>

      {/* Read-only account details */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-black/40 border border-white/5 min-w-0">
          <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1">Email</p>
          <p className="text-xs font-inter text-zinc-300 truncate">{profile.email || '—'}</p>
        </div>
        <div className="p-3 rounded-xl bg-black/40 border border-white/5">
          <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1">
            Member since
          </p>
          <p className="text-xs font-inter text-zinc-300">{memberSince || '—'}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`${PRIMARY_BTN_CLS} flex-1`}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </button>
        {onOpenSelfProfile && (
          <button
            onClick={onOpenSelfProfile}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.03] border border-white/5 text-sm text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            <Pencil className="w-3.5 h-3.5" /> View profile
          </button>
        )}
      </div>
    </div>
  );
}

// ============ Change password card ============

/**
 * Inline multi-step flow: idle → code-sent → verified (→ done = reset to
 * idle). Mirrors auth-screen's forgot-password flow: OTP send with 60s
 * resend countdown + one silent retry on a lost response, verify carrying
 * rotated otpRefs, then a single reset POST with the signed resetToken.
 */
function ChangePasswordCard({
  email,
  onPasswordChanged,
}: {
  email?: string;
  onPasswordChanged: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<'idle' | 'code-sent' | 'verified'>('idle');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [code, setCode] = useState('');
  const [otpRef, setOtpRef] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resendInSecs, setResendInSecs] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Live resend countdown (mirrors the 60s duplicate-send rate limit).
  useEffect(() => {
    if (resendInSecs <= 0) return;
    const t = setTimeout(() => setResendInSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [resendInSecs]);

  /** Back to a clean idle state (also used for the terminal 'done' outcome). */
  const resetFlow = useCallback(() => {
    setStep('idle');
    setCode('');
    setOtpRef(null);
    setResetToken(null);
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const handleSendCode = useCallback(async () => {
    if (!email || !email.includes('@')) {
      toast({
        title: 'No email on file',
        description: 'Your account has no email to send a code to.',
        variant: 'destructive',
      });
      return;
    }
    if (sending || resendInSecs > 0) return;
    setSending(true);
    // One idempotency key for this action — the silent retry reuses it so
    // the server replays instead of double-sending.
    const idempotencyKey = newIdempotencyKey();
    try {
      const request = () =>
        api<OtpSendData>('/api/auth/otp/send', {
          method: 'POST',
          body: { email, purpose: 'password_reset' },
          idempotencyKey,
          timeoutMs: TIMEOUTS.otpSend,
        });
      let res = await request();
      let retried = false;
      if (!res.success && (res.error?.code === 'REQUEST_TIMEOUT' || res.error?.code === 'NETWORK_ERROR')) {
        // Lost response — outcome unknown. ONE silent retry, same key.
        await sleep(1000);
        retried = true;
        res = await request();
      }
      if (res.success && res.data) {
        // otpRef is required for verification — keep it for the verify call.
        if (res.data.otpRef) setOtpRef(res.data.otpRef);
        setCode('');
        setStep('code-sent');
        toast({
          title: res.data.alreadySent ? 'Already sent' : 'Code sent',
          description: res.data.alreadySent
            ? 'That code is already in your inbox — enter it below'
            : 'Check your email for the 6-digit code',
        });
        setResendInSecs(60);
        return;
      }
      const err = res.error as OtpError | undefined;
      if (err?.code === 'RATE_LIMITED') {
        // Show the server message plus a live countdown; the button stays
        // disabled until the window clears.
        const secs = typeof err.retryAfterSecs === 'number' && err.retryAfterSecs > 0 ? err.retryAfterSecs : 60;
        setResendInSecs(Math.min(Math.ceil(secs), 300));
        if (retried) {
          // The rate limit proves our first (timed-out) send actually landed
          // — the code is in flight. Continue to the code step.
          setCode('');
          setStep('code-sent');
          toast({ title: 'Code sent', description: err.message });
        } else {
          toast({ title: 'Please wait', description: err.message });
        }
        return;
      }
      if (err?.code === 'REQUEST_TIMEOUT' || err?.code === 'NETWORK_ERROR') {
        toast({ title: 'Connection problem', description: CONNECTION_PROBLEM, variant: 'destructive' });
        return;
      }
      toast({ title: 'Failed', description: err?.message ?? 'Failed to send code', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  }, [email, sending, resendInSecs, toast]);

  const handleVerifyCode = useCallback(async () => {
    if (verifying) return;
    if (!code || code.length < 6) {
      toast({ title: 'Invalid code', description: 'Enter the 6-digit code', variant: 'destructive' });
      return;
    }
    setVerifying(true);
    const idempotencyKey = newIdempotencyKey();
    try {
      const request = () =>
        api<OtpVerifyData>('/api/auth/otp/verify', {
          method: 'POST',
          body: { email, code, purpose: 'password_reset', ...(otpRef ? { otpRef } : {}) },
          idempotencyKey,
          timeoutMs: TIMEOUTS.auth,
        });
      let res = await request();
      if (!res.success && (res.error?.code === 'REQUEST_TIMEOUT' || res.error?.code === 'NETWORK_ERROR')) {
        // Lost response — outcome unknown. ONE silent retry, same key.
        await sleep(1000);
        res = await request();
      }
      if (res.success && res.data?.verified) {
        if (!res.data.resetToken) {
          toast({
            title: 'Verification failed',
            description: 'No reset token issued — please try again.',
            variant: 'destructive',
          });
          return;
        }
        setOtpRef(null);
        setResetToken(res.data.resetToken);
        setStep('verified');
        toast({ title: 'Verified!', description: 'Enter your new password' });
        return;
      }
      const err = res.error as OtpError | undefined;
      // CRITICAL: wrong-code errors rotate the temp record — carry the NEW
      // otpRef into the next attempt (the attempt counter lives there).
      if (err?.otpRef) setOtpRef(err.otpRef);
      if (err?.code === 'REQUEST_TIMEOUT' || err?.code === 'NETWORK_ERROR') {
        toast({ title: 'Connection problem', description: CONNECTION_PROBLEM, variant: 'destructive' });
        return;
      }
      const left = err?.remainingAttempts;
      toast({
        title: 'Verification failed',
        description:
          left !== undefined
            ? `${err?.message ?? 'Invalid code'} — ${left} attempt${left === 1 ? '' : 's'} left`
            : (err?.message ?? 'Invalid code'),
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  }, [email, code, otpRef, verifying, toast]);

  const handleResetPassword = useCallback(async () => {
    if (resetting) return;
    if (!newPassword || newPassword.length < 6) {
      toast({ title: 'Weak password', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Mismatch', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (!resetToken) {
      // The signed token is required (10-min TTL) — re-verify a new code.
      toast({
        title: 'Session expired',
        description: 'Please verify a new code to reset your password',
        variant: 'destructive',
      });
      resetFlow();
      return;
    }
    setResetting(true);
    const idempotencyKey = newIdempotencyKey();
    try {
      const res = await api<{ status?: string; user?: unknown }>('/api/auth/reset-password', {
        method: 'POST',
        body: { email, password: newPassword, resetToken },
        idempotencyKey,
        timeoutMs: TIMEOUTS.auth,
      });
      if (res.success) {
        // The endpoint signs the user in — the shell session refreshes.
        toast({ title: 'Password updated', description: 'Your new password is active' });
        resetFlow();
        onPasswordChanged();
        return;
      }
      const err = res.error;
      if (err?.code === 'RESET_TOKEN_INVALID') {
        toast({ title: 'Reset failed', description: err.message, variant: 'destructive' });
        resetFlow();
        return;
      }
      toast({ title: 'Reset failed', description: err?.message ?? 'Failed to update password', variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  }, [email, newPassword, confirmPassword, resetToken, resetting, toast, resetFlow, onPasswordChanged]);

  if (step === 'idle') {
    return (
      <div className="space-y-4">
        <p className="font-inter text-sm text-zinc-400 leading-relaxed">
          We&apos;ll send a 6-digit verification code to your email (shown above)
          {email ? (
            <>
              {' '}
              — <span className="text-zinc-300">{email}</span>
            </>
          ) : null}
          .
        </p>
        <button
          onClick={handleSendCode}
          disabled={sending || resendInSecs > 0 || !email}
          className={PRIMARY_BTN_CLS}
        >
          {sending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Sending code…
            </>
          ) : (
            'Send code'
          )}
        </button>
        {resendInSecs > 0 && !sending && (
          <p className="text-[10px] font-manrope text-zinc-600 text-center">
            You can request a new code in {resendInSecs}s
          </p>
        )}
      </div>
    );
  }

  if (step === 'code-sent') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL_CLS}>Verification Code</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleVerifyCode();
            }}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-2xl text-center text-white font-manrope tracking-[0.5em] placeholder:text-zinc-700 focus:border-[#ef233c] focus:outline-none transition-all"
          />
        </div>
        <button onClick={handleVerifyCode} disabled={verifying} className={`${PRIMARY_BTN_CLS} w-full`}>
          {verifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
            </>
          ) : (
            'Verify'
          )}
        </button>
        <button
          onClick={handleSendCode}
          disabled={sending || verifying || resendInSecs > 0}
          className="w-full text-center text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-zinc-600"
        >
          {resendInSecs > 0
            ? `Didn't receive it? Resend available in ${resendInSecs}s`
            : "Didn't receive it? Resend code"}
        </button>
      </div>
    );
  }

  // step === 'verified'
  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLS}>New Password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 6 characters"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Confirm Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repeat your new password"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleResetPassword();
          }}
          className={INPUT_CLS}
        />
      </div>
      <button onClick={handleResetPassword} disabled={resetting} className={`${PRIMARY_BTN_CLS} w-full`}>
        {resetting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Updating…
          </>
        ) : (
          'Reset password'
        )}
      </button>
    </div>
  );
}

// ============ API key card ============

function ApiKeyCard({ onOpenApiDocs }: { onOpenApiDocs?: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const reveal = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await api<{ email?: string; apiKey?: string }>('/api/account/details', {
        timeoutMs: TIMEOUTS.normal,
      });
      if (res.success && res.data?.apiKey) {
        setApiKey(res.data.apiKey);
      } else {
        toast({
          title: 'Failed',
          description: res.error?.message ?? 'Could not load your API key',
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [loading, toast]);

  const copyKey = useCallback(() => {
    if (!apiKey) return;
    navigator.clipboard
      .writeText(apiKey)
      .then(() => toast({ title: 'Copied', description: 'API key copied to clipboard' }))
      .catch(() => toast({ title: 'Copy failed', description: 'Could not copy', variant: 'destructive' }));
  }, [apiKey, toast]);

  if (apiKey) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 p-3 rounded-xl bg-black/60 border border-white/10">
          <code className="flex-1 min-w-0 font-mono text-xs text-zinc-300 break-all">{apiKey}</code>
          <button
            onClick={copyKey}
            title="Copy API key"
            className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all shrink-0"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] font-inter text-zinc-500 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />
          This key grants full access to your account — keep it secret.
        </p>
        {onOpenApiDocs && (
          <button
            onClick={onOpenApiDocs}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#ef233c] hover:text-red-400 transition-colors"
          >
            Use this key with the Public API &amp; MCP <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-inter text-sm text-zinc-400">
        Your API key authenticates API calls on your behalf. Reveal it only when needed.
      </p>
      <button onClick={reveal} disabled={loading} className={PRIMARY_BTN_CLS}>
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </>
        ) : (
          'Reveal API key'
        )}
      </button>
      <p className="text-[11px] font-inter text-zinc-500 flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />
        This key grants full access to your account — keep it secret.
      </p>
      {onOpenApiDocs && (
        <button
          onClick={onOpenApiDocs}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#ef233c] hover:text-red-400 transition-colors"
        >
          Use this key with the Public API &amp; MCP <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ============ Preferences card ============

function PrefRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-manrope text-sm text-white">{label}</p>
        <p className="font-inter text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        className="data-[state=unchecked]:bg-white/10 data-[state=checked]:bg-[#ef233c] shrink-0"
      />
    </div>
  );
}

function PreferencesCard() {
  const autoplayVideos = usePreferences((s) => s.autoplayVideos);
  const confirmBeforeDelete = usePreferences((s) => s.confirmBeforeDelete);
  const reducedMotion = usePreferences((s) => s.reducedMotion);
  const setPreference = usePreferences((s) => s.setPreference);

  return (
    <div className="divide-y divide-white/5">
      <PrefRow
        label="Autoplay videos"
        description="Play clips automatically when opened"
        checked={autoplayVideos}
        onChange={(v) => setPreference('autoplayVideos', v)}
      />
      <PrefRow
        label="Confirm before delete"
        description="Ask for confirmation before deleting your uploads"
        checked={confirmBeforeDelete}
        onChange={(v) => setPreference('confirmBeforeDelete', v)}
      />
      <PrefRow
        label="Reduce motion"
        description="Disable animations and transitions"
        checked={reducedMotion}
        onChange={(v) => setPreference('reducedMotion', v)}
      />
    </div>
  );
}

// ============ AI Agent config ============

function AgentConfigCard() {
  const { toast } = useToast();
  // Provider config lives in the USER'S BROWSER (localStorage via the agent
  // store) — the server never stores chats or provider keys.
  const storedConfig = useAgentStore((s) => s.config);
  const saveConfig = useAgentStore((s) => s.saveConfig);
  const [provider, setProvider] = useState<'zai' | 'openai'>('zai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.6);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; models: string[] } | { ok: false; error: string } | null
  >(null);

  // Model auto-discovery state.
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [manualModel, setManualModel] = useState(false);
  const baseUrlTouched = useRef(false);

  useEffect(() => {
    const d = storedConfig;
    setProvider(d.provider || 'zai');
    setBaseUrl(d.baseUrl || '');
    setModel(d.model || '');
    setTemperature(typeof d.temperature === 'number' ? d.temperature : 0.6);
    setModels(Array.isArray(d.models) ? d.models : []);
    setManualModel(false);
  }, [storedConfig]);

  /** POST /api/agent/models — discover models from GET {base}/models. */
  const fetchModels = useCallback(
    async (opts?: { silent?: boolean }) => {
      const base = baseUrl.trim();
      if (!base || !/^https?:\/\//.test(base)) {
        if (!opts?.silent) setModelError('Enter the provider base URL first (e.g. https://api.example.com/v1).');
        return;
      }
      setFetchingModels(true);
      setModelError(null);
      try {
        const res = await fetch('/api/agent/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: base, apiKey: apiKey.trim() || storedConfig.apiKey || '' }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success || !body.data?.ok) {
          const err = body?.data?.error || body?.error?.message || `Discovery failed (HTTP ${res.status}).`;
          setModelError(err);
          setModels([]);
          return;
        }
        // Discovered models live in LOCAL state — they persist when the user
        // saves (calling saveConfig here would flip the form back to the
        // stored provider via the storedConfig sync effect).
        const list: string[] = Array.isArray(body.data.models) ? body.data.models : [];
        setModels(list);
        // keep the selected model only when it still exists; otherwise pick the first
        if (list.length > 0) {
          if (!model || !list.includes(model)) setModel(list[0]);
          setManualModel(false);
        }
      } catch (err) {
        setModelError(err instanceof Error ? err.message : 'Discovery failed.');
      } finally {
        setFetchingModels(false);
      }
    },
    [baseUrl, apiKey, storedConfig.apiKey, model]
  );

  const save = async () => {
    setSaving(true);
    try {
      const payload: Partial<AgentConfig> = { provider, model, temperature };
      if (provider === 'openai') {
        payload.baseUrl = baseUrl.trim();
        // Only update the key when the user typed a new one (masked echo keeps stored).
        if (apiKey.trim()) payload.apiKey = apiKey.trim();
        if (!apiKey.trim() && !storedConfig.apiKey) payload.apiKey = '';
        if (models.length > 0) payload.models = models;
      }
      saveConfig(payload);
      setApiKey('');
      toast({
        title: 'Agent settings saved',
        description:
          provider === 'zai'
            ? 'Using the built-in engine.'
            : 'Saved in this browser — the key never leaves your device except to run chats.',
      });
    } catch (err) {
      toast({
        title: 'Could not save agent settings',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first so the test exercises exactly what the agent runtime uses.
      await save();
      const payload: Partial<AgentConfig> = { provider, model, temperature };
      if (provider === 'openai') {
        payload.baseUrl = baseUrl.trim();
        payload.apiKey = apiKey.trim() || storedConfig.apiKey;
      }
      const res = await fetch('/api/agent/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (body?.success && body.data?.ok) {
        setTestResult({ ok: true, models: body.data.models || [] });
      } else {
        setTestResult({
          ok: false,
          error: body?.data?.error || body?.error?.message || 'Test failed',
        });
      }
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Provider */}
      <div>
        <label className={LABEL_CLS}>Provider</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setProvider('zai')}
            className={`px-4 py-3 rounded-xl border text-left transition-all duration-300 ${
              provider === 'zai'
                ? 'border-[#ef233c]/50 bg-[#ef233c]/10 text-white'
                : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:border-white/20'
            }`}
          >
            <div className="text-sm font-manrope font-semibold flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#ef233c]" /> Built-in engine
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">Zero setup — works out of the box</div>
          </button>
          <button
            onClick={() => setProvider('openai')}
            className={`px-4 py-3 rounded-xl border text-left transition-all duration-300 ${
              provider === 'openai'
                ? 'border-[#ef233c]/50 bg-[#ef233c]/10 text-white'
                : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white hover:border-white/20'
            }`}
          >
            <div className="text-sm font-manrope font-semibold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#ef233c]" /> OpenAI-compatible
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">Any /v1/chat/completions endpoint</div>
          </button>
        </div>
      </div>

      {provider === 'openai' && (
        <>
          <div>
            <label className={LABEL_CLS}>Base URL</label>
            <div className="flex items-center gap-2">
              <input
                className={INPUT_CLS}
                value={baseUrl}
                onChange={(e) => {
                  baseUrlTouched.current = true;
                  setBaseUrl(e.target.value);
                  setModelError(null);
                }}
                onBlur={() => {
                  // Refresh models when the base URL changes (spec: refresh on change).
                  if (baseUrlTouched.current && baseUrl.trim() && /^https?:\/\//.test(baseUrl.trim())) {
                    void fetchModels({ silent: true });
                  }
                  baseUrlTouched.current = false;
                }}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
              <button
                onClick={() => void fetchModels()}
                disabled={fetchingModels || !baseUrl.trim()}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-3 rounded-xl border border-white/15 text-zinc-300 hover:text-white hover:border-white/30 text-xs font-medium transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                title="Fetch the model list from {base URL}/models"
              >
                {fetchingModels ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {fetchingModels ? 'Fetching…' : 'Fetch models'}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-600">
              The models endpoint is derived automatically — trailing slashes and /v1 are
              normalized (never /v1/v1/models).
            </p>
          </div>
          <div>
            <label className={LABEL_CLS}>
              API key{' '}
              <span className="text-zinc-600 normal-case tracking-normal">
                (optional)
              </span>{' '}
              {storedConfig.apiKey && (
                <span className="text-zinc-600 normal-case tracking-normal">
                  (saved: {maskApiKey(storedConfig.apiKey)})
                </span>
              )}
            </label>
            <input
              className={INPUT_CLS}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={storedConfig.apiKey ? 'Leave empty to keep the saved key' : 'sk-… (leave empty for keyless providers)'}
              type="password"
              spellCheck={false}
            />
          </div>
        </>
      )}

      {/* Model picker */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLS}>
            Model{' '}
            {provider === 'zai' ? (
              <span className="text-zinc-600 normal-case tracking-normal">(optional)</span>
            ) : models.length > 0 && !manualModel ? (
              <span className="text-zinc-600 normal-case tracking-normal">({models.length} discovered)</span>
            ) : null}
          </label>
          {provider === 'openai' && models.length > 0 && !manualModel ? (
            <div className="space-y-1.5">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={INPUT_CLS + ' appearance-none cursor-pointer'}
                aria-label="Model"
              >
                {models.map((m) => (
                  <option key={m} value={m} className="bg-zinc-950">
                    {m}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setManualModel(true)}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Enter a model id manually instead
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <input
                className={INPUT_CLS}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={provider === 'zai' ? 'default' : models.length > 0 ? 'model id from the list' : 'gpt-4o-mini (or fetch models above)'}
                spellCheck={false}
              />
              {provider === 'openai' && models.length > 0 && (
                <button
                  onClick={() => setManualModel(false)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Back to the discovered list
                </button>
              )}
            </div>
          )}
        </div>
        <div>
          <label className={LABEL_CLS}>Temperature — {temperature.toFixed(1)}</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full mt-3 accent-[#ef233c]"
          />
        </div>
      </div>

      {/* Discovery feedback */}
      {provider === 'openai' && modelError && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-300">
          <span className="font-semibold">Could not fetch models.</span> {modelError}
        </div>
      )}
      {provider === 'openai' && !modelError && models.length > 0 && !fetchingModels && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-xs leading-relaxed text-emerald-300">
          <span className="font-semibold">{models.length} model{models.length === 1 ? '' : 's'} discovered.</span>{' '}
          Pick one above — the list refreshes whenever the base URL changes.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => save().catch(() => {})} disabled={saving} className={PRIMARY_BTN_CLS}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save agent settings'}
        </button>
        <button
          onClick={testConnection}
          disabled={testing || saving}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-white/15 text-zinc-300 hover:text-white hover:border-white/30 text-sm font-medium transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {isConfigured(storedConfig) && (
          <span className="text-[10px] text-emerald-400/80 font-manrope uppercase tracking-wider">
            ● Configured
          </span>
        )}
      </div>

      {testResult && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${
            testResult.ok
              ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
              : 'border-red-500/25 bg-red-500/5 text-red-300'
          }`}
        >
          {testResult.ok ? (
            <>
              <span className="font-semibold">Connection OK.</span>{' '}
              {testResult.models.length > 0
                ? `Available models: ${testResult.models.slice(0, 5).join(', ')}${
                    testResult.models.length > 5 ? '…' : ''
                  }`
                : 'The endpoint responded.'}
            </>
          ) : (
            <>
              <span className="font-semibold">Connection failed.</span> {testResult.error}
            </>
          )}
        </div>
      )}

      <p className="text-[10px] text-zinc-600 leading-relaxed">
        Chats and this configuration are stored in YOUR browser only (local
        storage) — they are never saved on the server. The agent uses your key
        to stream replies, run tools and edit your files; the key is never
        rendered in chats, tool output or errors.
      </p>
    </div>
  );
}

// ============ Sign out card ============

function SignOutCard({ logout }: { logout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const handleSignOut = useCallback(() => {
    if (busy) return;
    setBusy(true);
    logout()
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [busy, logout]);

  return (
    <section className="rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center shrink-0">
            <LogOut className="w-4 h-4 text-[#ef233c]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-manrope font-semibold text-base text-white">Sign out</h2>
            <p className="text-[11px] font-inter text-zinc-500">End your session on this device</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/10 text-sm text-zinc-300 hover:text-red-400 hover:border-[#ef233c]/30 hover:bg-[#ef233c]/5 font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          Sign out
        </button>
      </div>
    </section>
  );
}

// ============ Danger zone: delete account ============

/**
 * Permanently deletes the signed-in account (PRD §11–§16).
 *
 * Destructive + explicit: the user must type DELETE and confirm their
 * current password (re-authenticated server-side). The server identifies
 * the account from the session cookie ONLY. After the server accepts the
 * deletion the UI transitions to the signed-out state immediately —
 * metadata is gone; any oversized blob cleanup finishes engine-side.
 */
function DangerZoneCard({ logout }: { logout: () => Promise<void> }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const canConfirm = confirmText.trim() === 'DELETE' && password.length > 0 && !busy;

  const reset = useCallback(() => {
    setOpen(false);
    setConfirmText('');
    setPassword('');
    setBusy(false);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: { message?: string; code?: string } }
        | null;
      if (!res.ok || !data?.success) {
        const msg = data?.error?.message || 'Account deletion failed. Please try again.';
        toast({ title: 'Not deleted', description: msg, variant: 'destructive' });
        setBusy(false);
        return;
      }
      // Server accepted the deletion transition — clear this browser's
      // agent data (chats/config live in localStorage) and sign out.
      try {
        useAgentStore.persist.clearStorage();
      } catch {
        /* best-effort */
      }
      toast({ title: 'Account deleted', description: 'Your account and data have been removed.' });
      await logout();
      reset();
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the server. Check your connection and try again.',
        variant: 'destructive',
      });
      setBusy(false);
    }
  }, [canConfirm, password, toast, logout, reset]);

  return (
    <section className="rounded-2xl bg-black/60 backdrop-blur-xl border border-[#ef233c]/25 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center shrink-0">
            <TriangleAlert className="w-4 h-4 text-[#ef233c]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-manrope font-semibold text-base text-white">Danger zone</h2>
            <p className="text-[11px] font-inter text-zinc-500">
              Permanently delete your account, files, and all data
            </p>
          </div>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/40 text-sm text-red-300 hover:bg-[#ef233c]/20 hover:text-red-200 font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            <Trash2 className="w-4 h-4" /> Delete account
          </button>
        )}
      </div>

      {open && (
        <div className="mt-5 pt-5 border-t border-white/10 space-y-4">
          <p className="text-xs font-inter text-zinc-400 leading-relaxed">
            This <span className="text-red-300 font-semibold">cannot be undone</span>. It will
            permanently delete your account, profile, every image, clip, and XML you uploaded,
            your follows, your AI agent workspace, and your API key. Other users&apos; content is
            not affected.
          </p>
          <div>
            <label className={LABEL_CLS} htmlFor="del-confirm">
              Type <span className="text-red-300 font-semibold">DELETE</span> to confirm
            </label>
            <input
              id="del-confirm"
              className={INPUT_CLS}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="del-password">
              Your current password
            </label>
            <input
              id="del-password"
              type="password"
              className={INPUT_CLS}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={busy}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              disabled={!canConfirm}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#ef233c] text-sm text-white hover:bg-red-500 font-semibold transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              onClick={reset}
              disabled={busy}
              className="px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/10 text-sm text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

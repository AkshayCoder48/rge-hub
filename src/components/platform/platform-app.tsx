'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useResourceStore } from '@/lib/resource-store';
import { AuthScreen } from '@/components/platform/auth-screen';
import { Sidebar } from '@/components/platform/sidebar';
import { HomeView } from '@/components/platform/views/home-view';
import { ResourcesView } from '@/components/platform/views/resources-view';
import { CommunityView } from '@/components/platform/views/community-view';
import { ProfileView } from '@/components/platform/views/profile-view';
import { SpeedRampStudio } from '@/components/platform/views/speed-ramp-studio';
import { AdminView } from '@/components/platform/views/admin-view';
import { SearchView } from '@/components/platform/views/search-view';
import { UserView } from '@/components/platform/views/user-view';
import { UploadModal } from '@/components/platform/upload-modal';
import { Logo } from '@/components/logo';

export type ViewKey = 'home' | 'images' | 'clips' | 'xmls' | 'community' | 'profile' | 'studio' | 'admin' | 'search' | 'user';

export function PlatformApp() {
  const { user, status, loading, refresh } = useAuth();
  const [view, setView] = useState<ViewKey>('home');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<'image' | 'clip' | 'xml'>('image');
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[] | undefined>(undefined);
  const [uploadVersion, setUploadVersion] = useState(0);

  // Prefetch everything in ONE request (public + mine) for fast startup
  const fetchAll = useResourceStore((s) => s.fetchAll);

  useEffect(() => {
    if (user) {
      fetchAll(user.userId);
    }
  }, [user, fetchAll]);

  const navigate = useCallback(
    (v: ViewKey) => {
      // Admin view is only reachable with a verified admin session.
      if (v === 'admin' && !user?.isAdmin && (!user?.role || user.role === 'user')) return;
      setView(v);
    },
    [user?.isAdmin, user?.role]
  );

  const openUpload = useCallback((type: 'image' | 'clip' | 'xml') => {
    setUploadType(type);
    setUploadOpen(true);
  }, []);

  // Open the uploader with files already queued (studio publish).
  const openUploadWithFiles = useCallback((type: 'image' | 'clip' | 'xml', files: File[]) => {
    setUploadType(type);
    setUploadInitialFiles(files);
    setUploadOpen(true);
  }, []);

  // Open another creator's public profile (from cards, search, modals).
  const openUser = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setView('user');
  }, []);

  // Show spinner while auth is being checked
  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
        {/* Red Noir background */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-[#1a0505] to-black" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center space-y-4">
          <div className="w-10 h-10 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs font-manrope uppercase tracking-widest text-zinc-500">Loading session…</p>
        </div>
      </div>
    );
  }

  // Bounded retries exhausted — terminal error with a manual retry (never a
  // false "please log in" over an unknown outcome).
  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
        {/* Red Noir background */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-[#1a0505] to-black" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center space-y-4 px-6">
          <div className="w-10 h-10 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/30 flex items-center justify-center mx-auto">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#ef233c]" aria-hidden="true">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-manrope font-semibold text-white">Couldn&apos;t load your session</p>
            <p className="text-xs text-zinc-500 font-inter">The server didn&apos;t respond after several tries. Check your connection.</p>
          </div>
          <button
            onClick={() => refresh()}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black relative">
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex relative">
      {/* Red Noir Global Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0202] to-black" />
        <div className="absolute top-0 left-0 w-[1px] h-[1px] bg-transparent stars-1 animate-stars-1" />
        <div className="absolute top-0 left-0 w-[2px] h-[2px] bg-transparent stars-2 animate-stars-2" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)',
          }}
        />
      </div>

      {/* Sidebar */}
      <Sidebar
        currentView={view}
        onNavigate={navigate}
        user={user}
        onUpload={openUpload}
      />

      {/* Main content */}
      <div className="flex-1 lg:ml-64 min-w-0">
        {/* Top bar (mobile) */}
        <div className="lg:hidden sticky top-0 z-40 bg-black/60 backdrop-blur-xl border-b border-white/5 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={22} />
            <span className="font-manrope font-bold text-base text-white">RGE Hub</span>
          </div>
          <span className="text-xs font-manrope text-zinc-500 uppercase tracking-wider">
            {view}
          </span>
        </div>

        {/* Content area */}
        <main className="relative z-10 px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
          {view === 'home' && <HomeView key={`home-${uploadVersion}`} onNavigate={navigate} onUpload={openUpload} />}
          {view === 'images' && <ResourcesView key={`images-${uploadVersion}`} type="image" onUpload={() => openUpload('image')} onOpenUser={openUser} />}
          {view === 'clips' && <ResourcesView key={`clips-${uploadVersion}`} type="clip" onUpload={() => openUpload('clip')} onOpenUser={openUser} />}
          {view === 'xmls' && <ResourcesView key={`xmls-${uploadVersion}`} type="xml" onUpload={() => openUpload('xml')} onOpenUser={openUser} />}
          {view === 'community' && <CommunityView key={`community-${uploadVersion}`} onOpenUser={openUser} />}
          {view === 'profile' && <ProfileView key={`profile-${uploadVersion}`} onOpenUser={openUser} />}
          {view === 'search' && <SearchView key={`search-${uploadVersion}`} onOpenUser={openUser} />}
          {view === 'user' && selectedUserId && (
            <UserView key={`user-${selectedUserId}`} userId={selectedUserId} onOpenUser={openUser} onOpenSelf={() => setView('profile')} />
          )}
          {view === 'studio' && <SpeedRampStudio onPublishClip={(f) => openUploadWithFiles('clip', [f])} />}
          {view === 'admin' && (user.isAdmin || (user.role && user.role !== 'user')) && <AdminView key={`admin-${uploadVersion}`} />}
        </main>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <UploadModal
          type={uploadType}
          initialFiles={uploadInitialFiles}
          onClose={() => {
            setUploadOpen(false);
            setUploadInitialFiles(undefined);
          }}
          onSuccess={() => {
            setUploadOpen(false);
            setUploadInitialFiles(undefined);
            setUploadVersion(v => v + 1);
            // Invalidate and re-fetch the store (single request covers mine too)
            useResourceStore.getState().invalidate(user?.userId);
            setView(uploadType === 'image' ? 'images' : uploadType === 'clip' ? 'clips' : 'xmls');
          }}
        />
      )}
    </div>
  );
}

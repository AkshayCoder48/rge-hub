'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthScreen } from '@/components/platform/auth-screen';
import { Sidebar } from '@/components/platform/sidebar';
import { HomeView } from '@/components/platform/views/home-view';
import { ResourcesView } from '@/components/platform/views/resources-view';
import { CommunityView } from '@/components/platform/views/community-view';
import { ProfileView } from '@/components/platform/views/profile-view';
import { AdminView } from '@/components/platform/views/admin-view';
import { SpeedRampStudio } from '@/components/platform/views/speed-ramp-studio';
import { UploadModal } from '@/components/platform/upload-modal';
import { AmbientOrbs } from '@/components/synapse';

export type ViewKey = 'home' | 'images' | 'clips' | 'xmls' | 'community' | 'profile' | 'admin' | 'studio';

export function PlatformApp() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<ViewKey>('home');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<'image' | 'clip' | 'xml'>('image');

  const navigate = useCallback((v: ViewKey) => {
    setView(v);
  }, []);

  const openUpload = useCallback((type: 'image' | 'clip' | 'xml') => {
    setUploadType(type);
    setUploadOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030303]">
        <div className="w-10 h-10 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#030303] relative">
        <AmbientOrbs />
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030303] text-white flex">
      <AmbientOrbs />

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
        <div className="lg:hidden sticky top-0 z-40 glass px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gradient-to-br from-violet-400 to-cyan-400" />
            <span className="font-serif-display text-base">RailGuyEdits</span>
          </div>
          <span className="text-xs font-mono-display text-neutral-500 uppercase tracking-wider">
            {view}
          </span>
        </div>

        {/* Content area */}
        <main className="relative z-10 px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
          {view === 'home' && <HomeView onNavigate={navigate} onUpload={openUpload} />}
          {view === 'images' && <ResourcesView type="image" onUpload={() => openUpload('image')} />}
          {view === 'clips' && <ResourcesView type="clip" onUpload={() => openUpload('clip')} />}
          {view === 'xmls' && <ResourcesView type="xml" onUpload={() => openUpload('xml')} />}
          {view === 'community' && <CommunityView />}
          {view === 'profile' && <ProfileView />}
          {view === 'admin' && user.isAdmin && <AdminView />}
          {view === 'studio' && <SpeedRampStudio />}
        </main>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <UploadModal
          type={uploadType}
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            setUploadOpen(false);
            setView(uploadType === 'image' ? 'images' : uploadType === 'clip' ? 'clips' : 'xmls');
          }}
        />
      )}
    </div>
  );
}

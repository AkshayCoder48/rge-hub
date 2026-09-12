'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { ViewKey } from './platform-app';
import {
  Home,
  Image as ImageIcon,
  Film,
  FileCode,
  Users,
  User,
  Shield,
  Zap,
  Upload,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';

interface SidebarProps {
  currentView: ViewKey;
  onNavigate: (v: ViewKey) => void;
  user: {
    userId: string;
    username: string;
    displayName: string;
    avatar?: string;
    isAdmin: boolean;
  };
  onUpload: (type: 'image' | 'clip' | 'xml') => void;
}

export function Sidebar({ currentView, onNavigate, user, onUpload }: SidebarProps) {
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: { key: ViewKey; label: string; icon: typeof Home; section?: string }[] = [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'studio', label: 'Speed Ramp Studio', icon: Zap },
    { key: 'images', label: 'Images', icon: ImageIcon, section: 'Resources' },
    { key: 'clips', label: 'Clips', icon: Film },
    { key: 'xmls', label: 'XMLs', icon: FileCode },
    { key: 'community', label: 'Community', icon: Users, section: 'Discover' },
    { key: 'profile', label: 'Profile', icon: User, section: 'Account' },
  ];

  if (user.isAdmin) {
    navItems.push({ key: 'admin', label: 'Admin', icon: Shield });
  }

  const handleNav = (v: ViewKey) => {
    onNavigate(v);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_-5px_rgba(139,92,246,0.5)]"
      >
        {mobileOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
      </button>

      {/* Backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-40 h-full w-64 glass border-r border-white/5
        transition-transform duration-300 ease-snap
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_12px_-2px_rgba(139,92,246,0.5)]">
              <Film className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-serif-display text-sm text-white leading-tight">RailGuyEdits</div>
              <div className="text-[9px] font-mono-display uppercase tracking-[0.15em] text-neutral-500">Editing Platform</div>
            </div>
          </div>

          {/* Upload button */}
          <div className="mb-4 px-1">
            <UploadMenu onUpload={onUpload} />
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
            {navItems.map((item, i) => (
              <div key={item.key}>
                {item.section && (
                  <div className={`text-[9px] font-mono-display uppercase tracking-[0.2em] text-neutral-600 px-3 ${i > 0 ? 'mt-4 mb-1' : 'mb-1'}`}>
                    {item.section}
                  </div>
                )}
                <button
                  onClick={() => handleNav(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-300 ease-snap ${
                    currentView === item.key
                      ? 'bg-gradient-to-r from-violet-500/15 to-cyan-500/10 text-white border border-violet-500/20'
                      : 'text-neutral-400 hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  <item.icon className={`w-4 h-4 ${currentView === item.key ? 'text-violet-400' : ''}`} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {currentView === item.key && <ChevronRight className="w-3 h-3 text-violet-400" />}
                </button>
              </div>
            ))}
          </nav>

          {/* User card */}
          <div className="mt-4 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center text-sm font-medium text-white overflow-hidden">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
                ) : (
                  user.displayName.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white truncate">{user.displayName}</div>
                <div className="text-[10px] font-mono-display text-neutral-500 truncate">@{user.username}</div>
              </div>
            </div>
            {user.isAdmin && (
              <div className="mb-2 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-[9px] font-mono-display uppercase tracking-wider text-violet-400 text-center">
                Administrator
              </div>
            )}
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-neutral-500 hover:text-red-400 hover:bg-red-500/5 transition-all duration-300 ease-snap"
            >
              <LogOut className="w-3 h-3" /> Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function UploadMenu({ onUpload }: { onUpload: (type: 'image' | 'clip' | 'xml') => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-medium hover:from-violet-400 hover:to-cyan-400 transition-all duration-300 ease-snap shadow-[0_0_20px_-8px_rgba(139,92,246,0.6)]"
      >
        <Upload className="w-4 h-4" /> Upload
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 glass rounded-2xl p-1.5 z-50 space-y-0.5">
          <button
            onClick={() => { onUpload('image'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition-all"
          >
            <ImageIcon className="w-3.5 h-3.5 text-violet-400" /> Image
          </button>
          <button
            onClick={() => { onUpload('clip'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition-all"
          >
            <Film className="w-3.5 h-3.5 text-cyan-400" /> Clip
          </button>
          <button
            onClick={() => { onUpload('xml'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition-all"
          >
            <FileCode className="w-3.5 h-3.5 text-emerald-400" /> XML
          </button>
        </div>
      )}
    </div>
  );
}

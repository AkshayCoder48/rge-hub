'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Logo } from '@/components/logo';
import type { ViewKey } from './platform-app';
import { useAgentStore } from '@/lib/agent-store';
import {
  Home,
  Search,
  Image as ImageIcon,
  Film,
  FileCode,
  Users,
  User,
  Zap,
  Upload,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Shield,
  Settings,
  Braces,
  Plug,
  Bot,
  MessageSquare,
  Plus,
  Trash2,
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
    role?: string;
    permissions?: string[];
  };
  onUpload: (type: 'image' | 'clip' | 'xml') => void;
}

/**
 * Chat history block for the RGE Agent — rendered ONLY while the agent
 * view is active (per product decision: the section appears in the same
 * sidebar, scoped to the agent section).
 */
function AgentChatHistory({ onNavigate }: { onNavigate: (v: ViewKey) => void }) {
  const chats = useAgentStore((s) => s.chats);
  const activeChatId = useAgentStore((s) => s.activeChatId);
  const selectChat = useAgentStore((s) => s.selectChat);
  const deleteChat = useAgentStore((s) => s.deleteChat);
  const newChat = useAgentStore((s) => s.newChat);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="mt-4 mb-2 rounded-2xl bg-white/[0.02] border border-white/5 p-2.5">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3 h-3 text-[#ef233c]" />
          <span className="text-[9px] font-manrope uppercase tracking-[0.2em] text-zinc-500">
            Chat history
          </span>
        </div>
        <button
          onClick={() => {
            newChat();
            onNavigate('agent');
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-zinc-400 hover:text-white hover:bg-white/5 transition-all duration-300"
          title="New chat"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-0.5">
        {chats.length === 0 && (
          <div className="text-[10px] text-zinc-600 px-2 py-2 leading-relaxed">
            No chats yet — start one in the agent view.
          </div>
        )}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
              activeChatId === c.id
                ? 'bg-[#ef233c]/10 border border-[#ef233c]/20'
                : 'border border-transparent hover:bg-white/[0.04]'
            }`}
            onClick={() => {
              selectChat(c.id);
              onNavigate('agent');
            }}
          >
            <MessageSquare
              className={`w-3 h-3 shrink-0 ${activeChatId === c.id ? 'text-[#ef233c]' : 'text-zinc-600'}`}
            />
            <span
              className={`flex-1 min-w-0 truncate text-[11px] ${
                activeChatId === c.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'
              }`}
              title={c.title}
            >
              {c.title || 'Untitled chat'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirmDelete === c.id) {
                  deleteChat(c.id);
                  setConfirmDelete(null);
                } else {
                  setConfirmDelete(c.id);
                  setTimeout(() => setConfirmDelete((p) => (p === c.id ? null : p)), 2500);
                }
              }}
              className={`shrink-0 p-1 rounded transition-all ${
                confirmDelete === c.id
                  ? 'text-red-400 opacity-100'
                  : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400'
              }`}
              title={confirmDelete === c.id ? 'Click again to delete' : 'Delete chat'}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sidebar({ currentView, onNavigate, user, onUpload }: SidebarProps) {
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Admin entry is visible ONLY to verified admins (email-based check, server-side).
  const navItems: { key: ViewKey; label: string; icon: typeof Home; section?: string }[] = [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'studio', label: 'Speed Ramp Studio', icon: Zap },
    { key: 'agent', label: 'RGE Agent', icon: Bot },
    { key: 'images', label: 'Images', icon: ImageIcon, section: 'Resources' },
    { key: 'clips', label: 'Clips', icon: Film },
    { key: 'xmls', label: 'Files', icon: FileCode },
    { key: 'search', label: 'Search', icon: Search, section: 'Discover' },
    { key: 'community', label: 'Community', icon: Users },
    { key: 'api', label: 'API Docs', icon: Braces, section: 'Developers' },
    { key: 'mcp', label: 'MCP Server', icon: Plug },
    { key: 'profile', label: 'Profile', icon: User, section: 'Account' },
    // Same "Account" group as Profile — the section header only renders on
    // the first item of the group, so no duplicate "Account" label.
    { key: 'settings', label: 'Settings', icon: Settings },
    ...((user.isAdmin || (user.role && user.role !== 'user'))
      ? [{ key: 'admin' as ViewKey, label: 'Admin', icon: Shield, section: 'Staff' }]
      : []),
  ];

  const handleNav = (v: ViewKey) => {
    onNavigate(v);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[#ef233c] flex items-center justify-center shadow-[0_0_20px_-5px_rgba(239,35,60,0.5)]"
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
        fixed top-0 left-0 z-40 h-full w-64 bg-black/60 backdrop-blur-xl border-r border-white/10
        transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full p-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
            <Logo size={28} />
            <div>
              <div className="font-manrope font-bold text-sm text-white leading-tight">
                RGE <span className="text-[#ef233c]">Hub</span>
              </div>
              <div className="text-[9px] font-manrope uppercase tracking-[0.15em] text-zinc-600">Editing Platform</div>
            </div>
          </div>

          {/* Upload button */}
          <div className="mb-4 px-1">
            <UploadMenu onUpload={onUpload} />
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
            {/* Agent chat history — visible ONLY inside the agent section */}
            {currentView === 'agent' && <AgentChatHistory onNavigate={onNavigate} />}
            {navItems.map((item, i) => (
              <div key={item.key}>
                {item.section && (
                  <div className={`text-[9px] font-manrope uppercase tracking-[0.2em] text-zinc-600 px-3 ${i > 0 ? 'mt-4 mb-1' : 'mb-1'}`}>
                    {item.section}
                  </div>
                )}
                <button
                  onClick={() => handleNav(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                    currentView === item.key
                      ? 'bg-[#ef233c]/10 text-white border border-[#ef233c]/20'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  <item.icon className={`w-4 h-4 ${currentView === item.key ? 'text-[#ef233c]' : ''}`} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {currentView === item.key && <ChevronRight className="w-3 h-3 text-[#ef233c]" />}
                </button>
              </div>
            ))}
          </nav>

          {/* User card */}
          <div className="mt-4 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#ef233c]/20 to-zinc-700 flex items-center justify-center text-sm font-medium text-white overflow-hidden">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.displayName} className="w-full h-full object-cover" />
                ) : (
                  user.displayName.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white truncate">{user.displayName}</div>
                <div className="text-[10px] font-manrope text-zinc-500 truncate">@{user.username}</div>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-zinc-500 hover:text-red-400 hover:bg-red-500/5 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
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
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-full bg-[#ef233c] text-white text-sm font-bold hover:bg-red-700 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[0_0_20px_-8px_rgba(239,35,60,0.6)]"
      >
        <Upload className="w-4 h-4" /> Upload
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-black/80 backdrop-blur-xl rounded-2xl p-1.5 z-50 space-y-0.5 border border-white/10">
          <button
            onClick={() => { onUpload('image'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-white/5 transition-all"
          >
            <ImageIcon className="w-3.5 h-3.5 text-[#ef233c]" /> Image
          </button>
          <button
            onClick={() => { onUpload('clip'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-white/5 transition-all"
          >
            <Film className="w-3.5 h-3.5 text-[#ef233c]" /> Clip
          </button>
          <button
            onClick={() => { onUpload('xml'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-white/5 transition-all"
          >
            <FileCode className="w-3.5 h-3.5 text-[#ef233c]" /> File / Link
          </button>
        </div>
      )}
    </div>
  );
}

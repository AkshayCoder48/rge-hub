'use client';

import React, { useState, useEffect } from 'react';
import type { Resource, Profile } from '@/lib/resources';
import { X, Download, Share2, ExternalLink, Calendar, Tag, Crown, Film, FileCode, Image as ImageIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ResourceDetailModalProps {
  resource: Resource | null;
  onClose: () => void;
  onDownload?: (r: Resource) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  onDelete?: (r: Resource) => void;
}

export function ResourceDetailModal({
  resource,
  onClose,
  onDownload,
  canEdit = false,
  canDelete = false,
  onDelete,
}: ResourceDetailModalProps) {
  const { toast } = useToast();
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [loadingOwner, setLoadingOwner] = useState(false);

  // Dynamically resolve the owner's current profile (not a stale copy)
  useEffect(() => {
    let cancelled = false;
    const ownerName = resource?.ownerName;
    if (!ownerName) {
      return () => { cancelled = true; };
    }
    // Defer the synchronous setState calls to avoid cascading renders
    // (setState synchronously inside an effect body is flagged by lint).
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadingOwner(true);
      fetch(`/api/profile/${encodeURIComponent(ownerName)}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          setOwnerProfile(data.ok && data.profile ? data.profile : null);
        })
        .catch(() => {
          if (!cancelled) setOwnerProfile(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingOwner(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [resource?.ownerName]);

  if (!resource) return null;

  const typeIcon = resource.type === 'image' ? ImageIcon : resource.type === 'clip' ? Film : FileCode;
  // Red Noir: all type icons use the same red accent
  const typeColor = 'text-[#ef233c]';
  const TypeIcon = typeIcon;

  // Use the dynamically resolved owner profile, fall back to resource's stored ownerName
  const displayName = ownerProfile?.displayName || resource.ownerName;
  const avatar = ownerProfile?.avatar;
  const username = ownerProfile?.username || resource.ownerName;
  const isAdminResource = resource.ownerName?.toLowerCase() === 'railguyedits' || resource.xmlSource === 'admin';

  // Every resource has its own canonical URL on our domain: /r/<id>
  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/r/${resource.id}` : `/r/${resource.id}`;

  const handleShare = () => {
    navigator.clipboard.writeText(pageUrl).then(() => {
      toast({ title: 'Link copied!', description: 'Resource page URL copied to clipboard' });
    }).catch(() => {
      toast({ title: 'Copy failed', description: 'Could not copy URL', variant: 'destructive' });
    });
  };

  const handleOpenPage = () => {
    window.open(pageUrl, '_blank');
  };

  const handleOpenFull = () => {
    if (resource.downloadUrl) {
      window.open(resource.downloadUrl, '_blank');
    }
  };

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload(resource);
    } else if (resource.downloadUrl) {
      window.open(resource.downloadUrl, '_blank');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center">
              <TypeIcon className={`w-4 h-4 ${typeColor}`} />
            </div>
            <div>
              <h2 className="font-manrope font-semibold text-lg text-white truncate max-w-[300px]">{resource.title}</h2>
              <p className="text-[10px] font-manrope uppercase tracking-wider text-zinc-500">
                {resource.type} · {formatDate(resource.createdAt)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Full-resolution image preview */}
          <div className="bg-black/60 flex items-center justify-center p-4 min-h-[200px]">
            {resource.type === 'image' && (resource.thumbnailUrl || resource.downloadUrl) ? (
              <img
                src={resource.downloadUrl || resource.thumbnailUrl}
                alt={resource.title}
                className="max-w-full max-h-[50vh] object-contain rounded-xl"
              />
            ) : resource.type === 'clip' && (resource.thumbnailUrl || resource.downloadUrl) ? (
              <video
                src={resource.downloadUrl}
                poster={resource.thumbnailUrl}
                controls
                className="max-w-full max-h-[50vh] rounded-xl"
              />
            ) : resource.type === 'xml' ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <FileCode className="w-16 h-16 text-[#ef233c]/30" />
                <p className="font-inter text-sm text-zinc-500">XML file — download to view</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12">
                <TypeIcon className={`w-16 h-16 ${typeColor} opacity-30`} />
                <p className="font-inter text-sm text-zinc-500">No preview available</p>
              </div>
            )}
          </div>

          {/* Info section */}
          <div className="p-6 space-y-4">
            {/* Creator — dynamically resolved from current profile */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ef233c]/20 to-zinc-800 flex items-center justify-center text-sm font-medium text-white overflow-hidden shrink-0">
                {avatar ? (
                  <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  displayName?.charAt(0).toUpperCase() || '?'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-inter text-sm font-medium text-white truncate">{displayName}</p>
                  {isAdminResource && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#ef233c]/15 border border-[#ef233c]/30 text-[8px] font-manrope uppercase tracking-wider text-[#ef233c]">
                      <Crown className="w-2.5 h-2.5" /> Admin
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-manrope text-zinc-500">@{username}</p>
              </div>
              {loadingOwner && (
                <div className="w-4 h-4 border-2 border-[#ef233c]/30 border-t-[#ef233c] rounded-full animate-spin" />
              )}
            </div>

            {/* Description */}
            {resource.description && (
              <div>
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Description</p>
                <p className="font-inter text-sm text-zinc-300 leading-relaxed">{resource.description}</p>
              </div>
            )}

            {/* Tags */}
            {resource.tags && resource.tags.length > 0 && (
              <div>
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {resource.tags.map((tag, i) => (
                    <span key={i} className="flex items-center gap-1 text-[11px] font-manrope px-2 py-1 rounded-lg bg-white/[0.03] border border-white/5 text-zinc-400">
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Meta info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1">Published</p>
                <div className="flex items-center gap-1.5 text-xs font-inter text-zinc-300">
                  <Calendar className="w-3 h-3 text-zinc-600" />
                  {formatDate(resource.createdAt)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1">Type</p>
                <div className="flex items-center gap-1.5 text-xs font-inter text-zinc-300">
                  <TypeIcon className={`w-3 h-3 ${typeColor}`} />
                  {resource.type.toUpperCase()}
                  {resource.duration && ` · ${resource.duration.toFixed(1)}s`}
                </div>
              </div>
            </div>

            {/* Status badge */}
            {!resource.published && (
              <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                <p className="text-[11px] font-inter text-amber-400 font-medium">Draft — not published to community</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions — sticky bottom */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-white/5 shrink-0">
          <button
            onClick={handleDownloadClick}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c] hover:bg-red-700 text-white text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            <Download className="w-4 h-4" /> Download
          </button>
          <button
            onClick={handleOpenPage}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.05] border border-white/5 text-zinc-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
            title="Open resource page (/r/…)"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          {resource.downloadUrl && (
            <button
              onClick={handleOpenFull}
              className="hidden sm:flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.05] border border-white/5 text-zinc-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              title="Open raw file"
            >
              <span className="font-mono text-[10px] text-zinc-500">RAW</span>
            </button>
          )}
          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.05] border border-white/5 text-zinc-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
            title="Share"
          >
            <Share2 className="w-4 h-4" />
          </button>
          {canDelete && onDelete && (
            <button
              onClick={() => { onDelete(resource); onClose(); }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/20 text-[#ef233c] text-sm font-medium hover:bg-[#ef233c]/20 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              title="Delete"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

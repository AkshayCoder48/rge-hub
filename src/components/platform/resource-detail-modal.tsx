'use client';

import React, { useState, useEffect } from 'react';
import type { Resource, Profile } from '@/lib/resources';
import { RESOURCE_TYPE_LABEL, resourceExtension } from '@/lib/resources';
import { X, Download, Share2, ExternalLink, Calendar, Tag, Film, FileCode, Image as ImageIcon, Pencil } from 'lucide-react';
import { RoleBadge, authorDisplayRole } from './role-badge';
import { XmlViewer } from './xml-viewer';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth-context';
import { useResourceStore } from '@/lib/resource-store';
import { usePreferences } from '@/lib/preferences';
import { EditResourceModal } from './edit-resource-modal';

interface ResourceDetailModalProps {
  resource: Resource | null;
  onClose: () => void;
  onDownload?: (r: Resource) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  onDelete?: (r: Resource) => void;
  onOpenUser?: (userId: string) => void;
  /** Notified with the saved resource so the parent can update its selection. */
  onUpdated?: (r: Resource) => void;
}

export function ResourceDetailModal({
  resource,
  onClose,
  onDownload,
  canEdit = false,
  canDelete = false,
  onDelete,
  onOpenUser,
  onUpdated,
}: ResourceDetailModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { autoplayVideos } = usePreferences();
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [loadingOwner, setLoadingOwner] = useState(false);
  // Local override with the SAVED resource (id-guarded) so the modal body
  // re-renders with fresh data even when the parent doesn't pass onUpdated.
  const [edited, setEdited] = useState<{ id: string; resource: Resource } | null>(null);
  const [editOpen, setEditOpen] = useState(false);

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

  // Prefer the locally-saved copy (same resource id) over the prop.
  const shown = edited && edited.id === resource.id ? edited.resource : resource;

  // Edit rights: owner, admin, or any elevated role (matches the server's
  // PATCH authorization).
  const canEditResource =
    !!user &&
    (resource.ownerId === user.userId ||
      user.isAdmin ||
      (user.role !== undefined && user.role !== 'user'));
  const showEdit = canEdit || canEditResource;

  const typeIcon = shown.type === 'image' ? ImageIcon : shown.type === 'clip' ? Film : FileCode;
  // Red Noir: all type icons use the same red accent
  const typeColor = 'text-[#ef233c]';
  const TypeIcon = typeIcon;

  // REAL file extension — drives the header badge, the Type card and the
  // preview routing below. NEVER resource.type: the internal id 'xml' is
  // the generic-file bucket, which is why every file used to say "XML".
  const ext = resourceExtension(shown);
  const isRealExt = ext !== 'image' && ext !== 'clip' && ext !== 'file';

  // Use the dynamically resolved owner profile, fall back to resource's stored ownerName
  const displayName = ownerProfile?.displayName || shown.ownerName;
  const avatar = ownerProfile?.avatar;
  const username = ownerProfile?.username || shown.ownerName;
  // Creator role: live profile role first, stamped authorRole as fallback
  // (legacy records carry isOwnerAdmin). Server-resolved either way.
  let ownerRole: string =
    ((ownerProfile as unknown as { role?: string } | null)?.role) || authorDisplayRole(shown);
  if (ownerRole === 'user' && shown.type === 'xml' && shown.xmlSource === 'admin') {
    ownerRole = 'admin';
  }

  // Every resource has its own canonical URL on our domain: /r/<id>
  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/r/${shown.id}` : `/r/${shown.id}`;

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
    if (shown.downloadUrl) {
      window.open(shown.downloadUrl, '_blank');
    }
  };

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload(shown);
    } else if (shown.downloadUrl) {
      window.open(shown.downloadUrl, '_blank');
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
              <h2 className="font-manrope font-semibold text-lg text-white truncate max-w-[300px]">{shown.title}</h2>
              <p className="text-[10px] font-manrope uppercase tracking-wider text-zinc-500">
                {RESOURCE_TYPE_LABEL[shown.type] ?? shown.type}
                {isRealExt ? ` · ${ext.toUpperCase()}` : ''} · {formatDate(shown.createdAt)}
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
            {shown.type === 'image' && (shown.thumbnailUrl || shown.downloadUrl) ? (
              <img
                src={shown.downloadUrl || shown.thumbnailUrl}
                alt={shown.title}
                className="max-w-full max-h-[50vh] object-contain rounded-xl"
              />
            ) : shown.type === 'clip' && (shown.thumbnailUrl || shown.downloadUrl) ? (
              <video
                src={shown.downloadUrl}
                poster={shown.thumbnailUrl}
                controls
                autoPlay={autoplayVideos}
                muted={autoplayVideos}
                className="max-w-full max-h-[50vh] rounded-xl"
              />
            ) : shown.type === 'xml' ? (
              // Preview routing by REAL extension: only code files (xml/svg)
              // go through the code viewer, PDFs embed, everything else
              // (zip/apk/…) gets an honest no-preview panel.
              ext === 'xml' || ext === 'svg' ? (
                shown.downloadUrl ? (
                  <XmlViewer
                    url={shown.downloadUrl}
                    fileName={shown.fileName || `${shown.title}.${ext}`}
                    fileSize={shown.size}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <FileCode className="w-16 h-16 text-[#ef233c]/30" />
                    <p className="font-inter text-sm text-zinc-500">File — download to view</p>
                  </div>
                )
              ) : ext === 'pdf' ? (
                shown.downloadUrl ? (
                  <object
                    data={shown.downloadUrl}
                    type="application/pdf"
                    className="w-full rounded-xl bg-white/5"
                    style={{ minHeight: '400px', maxHeight: '50vh' }}
                  >
                    {/* Graceful fallback when the browser can't embed the PDF */}
                    <div className="flex flex-col items-center gap-3 py-12">
                      <FileCode className="w-16 h-16 text-[#ef233c]/30" />
                      <p className="font-inter text-sm text-zinc-500">Couldn't embed this PDF — download to open it.</p>
                    </div>
                  </object>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <FileCode className="w-16 h-16 text-[#ef233c]/30" />
                    <p className="font-inter text-sm text-zinc-500">File — download to view</p>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center gap-3 py-12">
                  <TypeIcon className={`w-16 h-16 ${typeColor} opacity-30`} />
                  <p className="font-inter text-sm text-zinc-500">No in-app preview — download to open it</p>
                  <button
                    onClick={handleDownloadClick}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/20 text-[#ef233c] text-xs font-manrope font-medium hover:bg-[#ef233c]/20 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isRealExt ? `Download ${ext.toUpperCase()}` : 'Download'}
                  </button>
                </div>
              )
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
            <div
              className={`flex items-center gap-3 p-3 rounded-xl bg-black/40 border border-white/5 ${onOpenUser ? 'cursor-pointer hover:border-[#ef233c]/30 transition-all' : ''}`}
              onClick={onOpenUser ? () => onOpenUser(shown.ownerId) : undefined}
            >
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
                  <RoleBadge role={ownerRole} />
                </div>
                <p className="text-[11px] font-manrope text-zinc-500">@{username}</p>
              </div>
              {loadingOwner && (
                <div className="w-4 h-4 border-2 border-[#ef233c]/30 border-t-[#ef233c] rounded-full animate-spin" />
              )}
            </div>

            {/* Description */}
            {shown.description && (
              <div>
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Description</p>
                <p className="font-inter text-sm text-zinc-300 leading-relaxed">{shown.description}</p>
              </div>
            )}

            {/* Tags */}
            {shown.tags && shown.tags.length > 0 && (
              <div>
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {shown.tags.map((tag, i) => (
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
                  {formatDate(shown.createdAt)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                <p className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 mb-1">Type</p>
                <div className="flex items-center gap-1.5 text-xs font-inter text-zinc-300">
                  <TypeIcon className={`w-3 h-3 ${typeColor}`} />
                  {ext.toUpperCase()}
                  {shown.duration && ` · ${shown.duration.toFixed(1)}s`}
                </div>
              </div>
            </div>

            {/* Status badge */}
            {!shown.published && (
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
          {shown.downloadUrl && (
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
          {showEdit && (
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.05] border border-white/5 text-zinc-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {canDelete && onDelete && (
            <button
              onClick={() => { onDelete(shown); onClose(); }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#ef233c]/10 border border-[#ef233c]/20 text-[#ef233c] text-sm font-medium hover:bg-[#ef233c]/20 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
              title="Delete"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Edit modal — overlays this detail modal (z-[70] > z-[60]) */}
      {editOpen && (
        <EditResourceModal
          resource={shown}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => {
            // Instant local application: store + this modal's body + parent.
            useResourceStore.getState().upsertLocal(saved);
            setEdited({ id: saved.id, resource: saved });
            setEditOpen(false);
            onUpdated?.(saved);
          }}
        />
      )}
    </div>
  );
}

'use client';

/**
 * Edit Resource modal — metadata editor for an existing upload.
 *
 * PATCHes ONLY the changed fields to /api/resources/[id]?type&xmlSource
 * (owner or staff; the server enforces permissions — a 403 shows an honest
 * destructive toast). A client timeout is NEVER treated as failure: the user
 * gets a "still saving" notice and the locally-merged resource is applied.
 *
 * Thumbnail replacement goes through POST /api/resources/thumbnail (image
 * ≤10MB, mirror-first) or a pasted URL; both mark the field dirty so the
 * PATCH only carries it when it actually changed.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { Resource } from '@/lib/resources';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Pencil, X, Upload, Loader2, ImageOff } from 'lucide-react';

export interface EditResourceModalProps {
  resource: Resource;
  onClose: () => void;
  onSaved: (r: Resource) => void;
}

const INPUT_CLS =
  'w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:border-[#ef233c] focus:outline-none transition-colors';
const LABEL_CLS =
  'text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-1.5';

export function EditResourceModal({ resource, onClose, onSaved }: EditResourceModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState(resource.title);
  const [description, setDescription] = useState(resource.description || '');
  const [tagsInput, setTagsInput] = useState((resource.tags || []).join(', '));
  const [category, setCategory] = useState(resource.category || '');
  const [duration, setDuration] = useState(resource.duration !== undefined ? String(resource.duration) : '');
  const [published, setPublished] = useState(resource.published);
  const [featured, setFeatured] = useState(resource.featured);
  const [thumbnailUrl, setThumbnailUrl] = useState(resource.thumbnailUrl || '');
  const [thumbnailDirty, setThumbnailDirty] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(resource.downloadUrl || '');
  const [saving, setSaving] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Featured toggle: elevated role AND own upload (the server enforces the
  // content.feature permission on the PATCH anyway — a 403 surfaces an
  // honest "no permission" toast instead of a silent no-op).
  const isOwner = !!user && resource.ownerId === user.userId;
  const elevatedRole =
    !!user && (user.isAdmin || user.role === 'root' || user.role === 'admin' || user.role === 'moderator');
  const canFeature = isOwner && elevatedRole;

  const handleThumbSelect = useCallback(
    async (file: File) => {
      if (uploadingThumb) return;
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Invalid file', description: 'Please select an image file', variant: 'destructive' });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: 'File too large', description: 'Image must be under 10MB', variant: 'destructive' });
        return;
      }
      setUploadingThumb(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        let res: Response;
        try {
          res = await fetch('/api/resources/thumbnail', {
            method: 'POST',
            body: formData,
            signal: ctrl.signal,
          });
        } catch {
          clearTimeout(timer);
          if (ctrl.signal.aborted) {
            // Timeout ≠ failure — the upload may have landed. A retry
            // reconciles; never a hard error over an unknown outcome.
            toast({ title: 'Still saving', description: 'Still saving — your change will appear shortly.' });
            return;
          }
          throw new Error('Thumbnail upload failed — please check your connection and retry.');
        }
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.thumbnailUrl) {
          throw new Error(data.error || 'Thumbnail upload failed');
        }
        setThumbnailUrl(data.thumbnailUrl as string);
        setThumbnailDirty(true);
        toast({ title: 'Thumbnail ready', description: 'Remember to save your changes' });
      } catch (err) {
        toast({
          title: 'Thumbnail failed',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      } finally {
        setUploadingThumb(false);
      }
    },
    [uploadingThumb, toast]
  );

  const handleSave = useCallback(async () => {
    if (saving) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast({ title: 'Title required', description: 'Give your upload a title', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      // Comma-separated tags → clean array (lowercase, trimmed, no empties).
      const nextTags = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const prevTags = resource.tags || [];

      // PATCH body carries ONLY the changed fields.
      const body: {
        title?: string;
        description?: string;
        tags?: string[];
        category?: string;
        duration?: number;
        published?: boolean;
        featured?: boolean;
        thumbnailUrl?: string;
        downloadUrl?: string;
      } = {};
      if (trimmedTitle !== resource.title) body.title = trimmedTitle;
      if (description !== (resource.description || '')) body.description = description;
      if (nextTags.join(',') !== prevTags.join(',')) body.tags = nextTags;
      if (category.trim() !== (resource.category || '')) body.category = category.trim();
      if (resource.type === 'clip') {
        const dur = duration.trim() === '' ? undefined : parseFloat(duration);
        if (dur !== undefined && !Number.isNaN(dur) && dur !== resource.duration) body.duration = dur;
      }
      if (published !== resource.published) body.published = published;
      if (canFeature && featured !== resource.featured) body.featured = featured;
      if (thumbnailDirty) body.thumbnailUrl = thumbnailUrl.trim();
      if (downloadUrl.trim() !== (resource.downloadUrl || '')) body.downloadUrl = downloadUrl.trim();

      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }

      const params = new URLSearchParams();
      params.set('type', resource.type);
      if (resource.xmlSource) params.set('xmlSource', resource.xmlSource);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let res: Response;
      try {
        res = await fetch(`/api/resources/${encodeURIComponent(resource.id)}?${params.toString()}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch {
        clearTimeout(timer);
        if (ctrl.signal.aborted) {
          // Timeout ≠ failure — the write may have landed. Apply the locally
          // merged resource so a refresh reconciles the truth.
          toast({ title: 'Still saving', description: 'Still saving — your change will appear shortly.' });
          onSaved({ ...resource, ...body });
          return;
        }
        throw new Error('Save failed — please check your connection and retry.');
      }
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        toast({
          title: 'Not allowed',
          description:
            body.featured !== undefined
              ? "You don't have permission to feature uploads"
              : data.error || 'You are not allowed to edit this resource',
          variant: 'destructive',
        });
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to save changes');
      }

      toast({ title: 'Saved', description: 'Your changes have been saved' });
      onSaved(data.resource as Resource);
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    title,
    description,
    tagsInput,
    category,
    duration,
    published,
    featured,
    thumbnailDirty,
    thumbnailUrl,
    downloadUrl,
    resource,
    canFeature,
    toast,
    onClose,
    onSaved,
  ]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ef233c]/15 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-[#ef233c]" />
            </div>
            <div>
              <h2 className="font-manrope font-semibold text-lg text-white">Edit Upload</h2>
              <p className="text-[10px] font-manrope uppercase tracking-wider text-zinc-500">
                {resource.title}
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

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
          {/* Title */}
          <div>
            <label className={LABEL_CLS}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              className={INPUT_CLS}
            />
          </div>

          {/* Description */}
          <div>
            <label className={LABEL_CLS}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Describe your upload..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>

          {/* Tags */}
          <div>
            <label className={LABEL_CLS}>Tags</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="tag1, tag2, tag3"
              className={INPUT_CLS}
            />
            <p className="text-[10px] font-manrope text-zinc-600 mt-1.5">
              Comma-separated — shown on your upload and used by search
            </p>
          </div>

          {/* Category */}
          <div>
            <label className={LABEL_CLS}>Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={40}
              placeholder="Optional category"
              className={INPUT_CLS}
            />
          </div>

          {/* Duration (clips only) */}
          {resource.type === 'clip' && (
            <div>
              <label className={LABEL_CLS}>Duration (seconds)</label>
              <input
                type="number"
                step={0.1}
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 12.5"
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Published toggle */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-black/40 border border-white/5">
            <div className="min-w-0">
              <p className="font-manrope text-sm text-white">Published</p>
              <p className="font-inter text-xs text-zinc-500 mt-0.5">
                {published ? 'Published to community' : 'Draft — only you can see it'}
              </p>
            </div>
            <Switch
              checked={published}
              onCheckedChange={setPublished}
              aria-label="Published to community"
              className="data-[state=unchecked]:bg-white/10 data-[state=checked]:bg-[#ef233c] shrink-0"
            />
          </div>

          {/* Featured toggle (elevated owners only — server enforces anyway) */}
          {canFeature && (
            <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="min-w-0">
                <p className="font-manrope text-sm text-white">Featured on home</p>
                <p className="font-inter text-xs text-zinc-500 mt-0.5">
                  Highlight this upload on the home page
                </p>
              </div>
              <Switch
                checked={featured}
                onCheckedChange={setFeatured}
                aria-label="Featured on home"
                className="data-[state=unchecked]:bg-white/10 data-[state=checked]:bg-[#ef233c] shrink-0"
              />
            </div>
          )}

          {/* Thumbnail */}
          <div className="space-y-3">
            <label className={`${LABEL_CLS} mb-0`}>Thumbnail</label>
            {thumbnailUrl ? (
              <div className="w-full max-w-[240px] aspect-video rounded-xl overflow-hidden border border-white/10 bg-black/60">
                <img
                  src={thumbnailUrl}
                  alt={`${resource.title} thumbnail`}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-full max-w-[240px] aspect-video rounded-xl border border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-1.5">
                <ImageOff className="w-4 h-4 text-zinc-600" />
                <span className="text-[11px] font-inter text-zinc-600">No thumbnail</span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => thumbInputRef.current?.click()}
                disabled={uploadingThumb}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/[0.04] border border-white/10 text-xs font-manrope text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50"
              >
                {uploadingThumb ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Upload new thumbnail
              </button>
              <button
                onClick={() => {
                  setThumbnailUrl('');
                  setThumbnailDirty(true);
                }}
                className="text-xs text-zinc-500 hover:text-white transition-colors"
              >
                Remove thumbnail
              </button>
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleThumbSelect(e.target.files[0]);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Or paste image URL</label>
              <input
                type="text"
                value={thumbnailUrl}
                onChange={(e) => {
                  setThumbnailUrl(e.target.value);
                  setThumbnailDirty(true);
                }}
                placeholder="https://..."
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* File link — always shown (downloadUrl; replace with an external link if wanted) */}
          <div>
            <label className={LABEL_CLS}>File link (URL)</label>
            <input
              type="text"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://..."
              className={INPUT_CLS}
            />
            <p className="text-[10px] font-manrope text-zinc-600 mt-1.5">
              The permanent storage URL for this file — replace it to point at an external link
            </p>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-white/5 shrink-0">
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
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

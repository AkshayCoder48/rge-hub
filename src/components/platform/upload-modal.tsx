'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/hooks/use-toast';
import { X, Upload, Loader2, FileCode, Film, Image as ImageIcon, CheckCircle2 } from 'lucide-react';

interface UploadModalProps {
  type: 'image' | 'clip' | 'xml';
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadModal({ type, onClose, onSuccess }: UploadModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [published, setPublished] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<'select' | 'details' | 'uploading' | 'done'>('select');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const typeIcon = type === 'image' ? ImageIcon : type === 'clip' ? Film : FileCode;
  const TypeIcon = typeIcon;
  const accept = type === 'image' ? 'image/*' : type === 'clip' ? 'video/*' : '.xml,text/xml';
  const accentColor = type === 'image' ? 'violet' : type === 'clip' ? 'cyan' : 'emerald';

  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''));
    setStep('details');
  }, [title]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  const handleUpload = useCallback(async () => {
    if (!file || !user) return;
    setUploading(true);
    setStep('uploading');

    try {
      // 1. Upload file to OnyxBase
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch('/api/resources/upload', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      if (!uploadData.ok) {
        throw new Error(uploadData.error || 'File upload failed');
      }

      // 2. Create resource record
      const tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);

      const createRes = await fetch('/api/resources/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title,
          description,
          fileId: uploadData.fileId,
          downloadUrl: uploadData.url,
          tags: tagsArray,
          published,
        }),
      });
      const createData = await createRes.json();

      if (!createData.ok) {
        throw new Error(createData.error || 'Failed to create resource');
      }

      setStep('done');
      toast({ title: 'Uploaded!', description: `${title} has been ${published ? 'published' : 'saved as draft'}` });
      setTimeout(onSuccess, 1000);
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      setStep('details');
    } finally {
      setUploading(false);
    }
  }, [file, user, type, title, description, tags, published, toast, onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-lg glass rounded-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl bg-${accentColor}-500/15 flex items-center justify-center`}>
              <TypeIcon className={`w-4 h-4 text-${accentColor}-400`} />
            </div>
            <div>
              <h2 className="font-serif-display text-lg text-white">Upload {type}</h2>
              <p className="text-[10px] font-mono-display uppercase tracking-wider text-neutral-500">
                {step === 'select' ? 'Choose file' : step === 'details' ? 'Add details' : step === 'uploading' ? 'Uploading...' : 'Complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'select' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-violet-500/30 hover:bg-white/[0.03] transition-all duration-300 ease-snap"
            >
              <div className={`w-14 h-14 rounded-2xl bg-${accentColor}-500/10 flex items-center justify-center`}>
                <Upload className={`w-6 h-6 text-${accentColor}-400`} />
              </div>
              <div className="text-center">
                <p className="text-sm text-white">Drop your {type} here</p>
                <p className="text-xs text-neutral-500 mt-1">or click to browse</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
                className="hidden"
              />
            </div>
          )}

          {step === 'details' && file && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className={`w-10 h-10 rounded-xl bg-${accentColor}-500/10 flex items-center justify-center shrink-0`}>
                  <TypeIcon className={`w-4 h-4 text-${accentColor}-400`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{file.name}</p>
                  <p className="text-[10px] font-mono-display text-neutral-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button
                  onClick={() => { setFile(null); setStep('select'); }}
                  className="text-xs text-neutral-500 hover:text-white transition-colors"
                >
                  Change
                </button>
              </div>

              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-white focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-white resize-none focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-1.5">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="WAP7, IndianRailways, locomotive"
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={published}
                  onChange={(e) => setPublished(e.target.checked)}
                  className="w-4 h-4 rounded accent-violet-500"
                />
                <span className="text-sm text-neutral-300">Publish to community</span>
              </label>

              <button
                onClick={handleUpload}
                disabled={!title || uploading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-medium hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
              >
                <Upload className="w-4 h-4" /> Upload {type}
              </button>
            </div>
          )}

          {step === 'uploading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
              <p className="text-sm text-neutral-400">Uploading to OnyxBase...</p>
              <p className="text-[10px] font-mono-display text-neutral-600">{file?.name}</p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <p className="text-sm text-white">Upload complete!</p>
              <p className="text-[10px] font-mono-display text-neutral-500">{published ? 'Published to community' : 'Saved as draft'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

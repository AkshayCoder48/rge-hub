'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useAppStore, formatDuration, formatFileSize } from '@/lib/store';
import type { MotionBlurClip, MotionBlurFilterType } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, Film, Loader2, CheckCircle2, AlertCircle, Trash2,
  Wind, MonitorPlay, Clock, Download, PlayCircle, Plus,
  ArrowRight, Archive, ChevronDown, Gauge, Sparkles, Eye,
} from 'lucide-react';

const ACCEPTED_EXTENSIONS = '.mp4,.mov,.avi,.webm,.mkv';
const FILTER_TYPE_OPTIONS: { value: MotionBlurFilterType; label: string; description: string }[] = [
  { value: 'tblend', label: 'tblend', description: 'Temporal blend — Blends each frame with the previous one. Great for adding smooth motion trails.' },
  { value: 'tmix', label: 'tmix', description: 'Temporal mix — Mixes N consecutive frames together. Creates long-exposure style blur.' },
];
const INTENSITY_OPTIONS = ['light', 'average', 'heavy'] as const;

/* ──────────────────── Upload Zone ──────────────────── */

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'analyzing' | 'done' | 'error';
  error?: string;
}

function MotionBlurUploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMotionBlurClip = useAppStore((s) => s.addMotionBlurClip);
  const { toast } = useToast();

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const videoFiles = Array.from(files).filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase();
        const validExt = ['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext || '');
        return validExt || f.type.startsWith('video/');
      });

      if (videoFiles.length === 0) {
        toast({ title: 'Invalid file type', description: 'Please upload video files only.', variant: 'destructive' });
        return;
      }

      for (const file of videoFiles) {
        setUploads((prev) => [...prev, { fileName: file.name, progress: 0, status: 'uploading' }]);

        try {
          const progressInterval = setInterval(() => {
            setUploads((prev) => prev.map((u) =>
              u.fileName === file.name && u.status === 'uploading'
                ? { ...u, progress: Math.min(u.progress + Math.random() * 15, 90) }
                : u
            ));
          }, 300);

          const formData = new FormData();
          formData.append('file', file);

          setUploads((prev) => prev.map((u) =>
            u.fileName === file.name ? { ...u, status: 'analyzing', progress: 60 } : u
          ));

          const response = await fetch('/api/analyze', { method: 'POST', body: formData });
          clearInterval(progressInterval);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(errorData.error || 'Upload failed');
          }

          const data = await response.json();

          const clip: MotionBlurClip = {
            id: data.id,
            fileName: data.fileName,
            originalName: data.originalName,
            duration: data.duration,
            width: data.width,
            height: data.height,
            fps: data.fps,
            codec: data.codec,
            bitrate: data.bitrate,
            format: data.format,
            fileSize: data.fileSize,
            url: data.url,
            filterType: 'tblend',
            frames: 2,
            intensity: 'average',
            status: 'ready',
          };

          addMotionBlurClip(clip);

          setUploads((prev) => prev.map((u) =>
            u.fileName === file.name ? { ...u, progress: 100, status: 'done' } : u
          ));

          toast({
            title: 'Video uploaded for motion blur',
            description: `${file.name}: ${data.fps}fps · ${clip.filterType} · ${clip.intensity}`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to upload video';
          setUploads((prev) => prev.map((u) =>
            u.fileName === file.name ? { ...u, status: 'error', error: message, progress: 0 } : u
          ));
          toast({ title: 'Upload failed', description: message, variant: 'destructive' });
        }
      }

      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.status === 'uploading' || u.status === 'analyzing'));
      }, 3000);
    },
    [addMotionBlurClip, toast]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) { handleFiles(e.target.files); e.target.value = ''; }
  }, [handleFiles]);

  const activeUploads = uploads.filter((u) => u.status !== 'done');

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative rounded-2xl cursor-pointer transition-all duration-500 ${isDragging ? 'scale-[1.02]' : 'scale-100'}`}
      >
        <div className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 ${
          isDragging
            ? 'border-transparent bg-[#0f0f17]'
            : 'border-white/10 bg-[#0f0f17] hover:border-purple-500/50 hover:bg-[#0f0f17]/80'
        } p-12 md:p-16 flex flex-col items-center justify-center gap-4`}>
          <div className={`relative transition-all duration-300 ${isDragging ? 'scale-110' : 'scale-100'}`}>
            <div className={`relative w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              isDragging ? 'bg-purple-500/20' : 'bg-white/5'
            }`}>
              <Upload className={`w-8 h-8 md:w-10 md:h-10 transition-all duration-300 ${
                isDragging ? 'text-purple-400 animate-bounce' : 'text-white/40'
              }`} />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className={`text-lg md:text-xl font-semibold transition-colors ${isDragging ? 'text-purple-400' : 'text-white/80'}`}>
              {isDragging ? 'Release to upload' : 'Drop your video here'}
            </h3>
            <p className="text-sm text-white/40">or click to browse · Apply cinematic motion blur to your videos</p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Film className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-wide">MP4 · MOV · AVI · WEBM · MKV</span>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} multiple onChange={handleInputChange} className="hidden" />

      {activeUploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {activeUploads.map((upload, idx) => (
            <div key={`${upload.fileName}-${idx}`} className="rounded-xl bg-[#0f0f17] border border-white/5 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {upload.status === 'error' ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0" /> :
                   upload.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" /> :
                   <Loader2 className="w-4 h-4 text-purple-400 shrink-0 animate-spin" />}
                  <span className="text-sm text-white/70 truncate">{upload.fileName}</span>
                </div>
                <span className="text-xs text-white/30 shrink-0 ml-2">
                  {upload.status === 'analyzing' ? 'Analyzing...' : upload.status === 'error' ? 'Failed' : `${Math.round(upload.progress)}%`}
                </span>
              </div>
              {upload.status !== 'error' && (
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{
                    width: `${upload.progress}%`,
                    background: upload.progress >= 100
                      ? 'linear-gradient(90deg, #a855f7, #ec4899)'
                      : 'linear-gradient(90deg, #a855f7, #c084fc)',
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Clip List Sidebar ──────────────────── */

function MotionBlurClipList() {
  const clips = useAppStore((s) => s.motionBlurClips);
  const selectedId = useAppStore((s) => s.selectedMotionBlurClipId);
  const selectClip = useAppStore((s) => s.selectMotionBlurClip);
  const removeClip = useAppStore((s) => s.removeMotionBlurClip);
  const setClipSettings = useAppStore((s) => s.setMotionBlurClipSettings);
  const addMotionBlurClip = useAppStore((s) => s.addMotionBlurClip);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  const handleFileUpload = async (files: FileList | File[]) => {
    const videoFiles = Array.from(files).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext || '') || f.type.startsWith('video/');
    });

    if (videoFiles.length === 0) {
      toast({ title: 'Invalid file type', description: 'Please upload video files only.', variant: 'destructive' });
      return;
    }

    setUploadingCount(videoFiles.length);
    let successCount = 0;

    for (const file of videoFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/analyze', { method: 'POST', body: formData });
        if (!response.ok) throw new Error('Upload failed');
        const data = await response.json();

        const clip: MotionBlurClip = {
          id: data.id, fileName: data.fileName, originalName: data.originalName,
          duration: data.duration, width: data.width, height: data.height,
          fps: data.fps, codec: data.codec, bitrate: data.bitrate,
          format: data.format, fileSize: data.fileSize, url: data.url,
          filterType: 'tblend', frames: 2, intensity: 'average', status: 'ready',
        };
        addMotionBlurClip(clip);
        successCount++;
      } catch {
        toast({ title: `Upload failed: ${file.name}`, variant: 'destructive' });
      } finally {
        setUploadingCount((prev) => prev - 1);
      }
    }

    if (successCount > 0) {
      toast({ title: `${successCount} video${successCount > 1 ? 's' : ''} uploaded`, description: `${successCount} clip${successCount > 1 ? 's' : ''} ready for motion blur.` });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/50 uppercase tracking-wider">Clips ({clips.length})</h2>
        {uploadingCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-purple-400/70">
            <Loader2 className="w-3 h-3 animate-spin" /> Uploading {uploadingCount}...
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-[calc(100vh-380px)] overflow-y-auto pr-1 custom-scrollbar">
        {clips.map((clip) => (
          <div
            key={clip.id}
            onClick={() => selectClip(clip.id)}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectClip(clip.id); }}
            className={`w-full text-left rounded-xl p-3 transition-all duration-200 group cursor-pointer ${
              selectedId === clip.id
                ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30'
                : 'bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10">
                <Wind className="w-4 h-4 text-white/60" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white/80 truncate">{clip.originalName}</p>
                  <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 text-white/50 border border-white/10 font-medium">MBLUR</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-xs font-mono font-medium text-purple-400/70">
                    {clip.filterType}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-white/30">
                    <Clock className="w-3 h-3" /> {formatDuration(clip.duration)}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-white/30">
                    <MonitorPlay className="w-3 h-3" /> {clip.width}x{clip.height}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    clip.status === 'ready' ? 'bg-purple-500/10 text-purple-400' :
                    clip.status === 'processing' ? 'bg-orange-500/10 text-orange-400' :
                    clip.status === 'done' ? 'bg-pink-500/10 text-pink-400' :
                    clip.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-white/30'
                  }`}>
                    {clip.status === 'ready' ? '● Ready' : clip.status === 'processing' ? '● Processing' :
                     clip.status === 'done' ? '● Complete' : clip.status === 'error' ? '● Error' : '● Idle'}
                  </span>
                  {/* Filter type selector */}
                  <div className="relative">
                    <select
                      value={clip.filterType}
                      onChange={(e) => { e.stopPropagation(); setClipSettings(clip.id, { filterType: e.target.value as MotionBlurFilterType }); }}
                      onClick={(e) => e.stopPropagation()}
                      className="appearance-none bg-white/[0.03] border border-white/10 rounded-lg px-2 py-0.5 text-[10px] text-white/50 font-mono cursor-pointer hover:border-purple-500/30 focus:outline-none focus:border-purple-500/50 pr-5"
                      title="Filter type"
                    >
                      {FILTER_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-white/20 pointer-events-none" />
                  </div>
                  {/* Intensity selector */}
                  <div className="flex items-center gap-0.5">
                    {INTENSITY_OPTIONS.map((intensity) => (
                      <button
                        key={intensity}
                        onClick={(e) => { e.stopPropagation(); setClipSettings(clip.id, { intensity }); }}
                        className={`px-1.5 py-0.5 text-[9px] rounded font-medium transition-all ${
                          clip.intensity === intensity
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                            : 'bg-white/[0.03] text-white/30 border border-white/5 hover:border-purple-500/20 hover:text-white/50'
                        }`}
                      >
                        {intensity.charAt(0).toUpperCase() + intensity.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); removeClip(clip.id); }}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-white/20 transition-all" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2 space-y-2">
        <button onClick={() => fileInputRef.current?.click()} disabled={uploadingCount > 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-white/[0.02] border border-dashed border-white/10 text-white/40 hover:bg-white/[0.05] hover:border-purple-500/30 hover:text-purple-400/70 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
          {uploadingCount > 0 ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><Plus className="w-4 h-4" /> Add More Videos</>}
        </button>
        <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} multiple onChange={async (e) => { if (e.target.files?.length) { await handleFileUpload(e.target.files); e.target.value = ''; } }} className="hidden" />
        <p className="text-[10px] text-white/15 text-center">Motion blur: add cinematic blur trails to your videos</p>
      </div>
    </div>
  );
}

/* ──────────────────── Motion Blur Visual ──────────────────── */

function MotionBlurVisual({ sourceFps, filterType, intensity }: { sourceFps: number; filterType: MotionBlurFilterType; intensity: string }) {
  const intensityLabel = intensity === 'light' ? 'Subtle' : intensity === 'heavy' ? 'Strong' : 'Balanced';
  const frameCount = filterType === 'tblend' ? 2 : intensity === 'light' ? 2 : intensity === 'heavy' ? 6 : 4;

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-white/70">Blur Preview</h3>
        <span className="ml-auto text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400/70">
          {filterType} · {intensityLabel}
        </span>
      </div>

      <div className="space-y-4">
        {/* Before - Sharp frames */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Before — Sharp</span>
            <span className="text-xs font-mono text-white/40">{sourceFps}fps</span>
          </div>
          <div className="flex items-end gap-[6px] h-10">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-white/15 border border-white/10"
                style={{ height: '100%' }}
              />
            ))}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center gap-2">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex items-center gap-1 text-purple-400/60">
            <ArrowRight className="w-4 h-4" />
            <span className="text-[10px] font-medium">Motion Blur</span>
          </div>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>

        {/* After - Blurred frames */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">After — Blurred</span>
            <span className="text-xs font-mono text-purple-400/70">{filterType} · {frameCount} frames</span>
          </div>
          <div className="flex items-end gap-[6px] h-10">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm border border-purple-400/10"
                style={{
                  height: '100%',
                  background: `linear-gradient(90deg, rgba(168,85,247,${intensity === 'heavy' ? 0.35 : intensity === 'light' ? 0.15 : 0.25}), rgba(236,72,153,${intensity === 'heavy' ? 0.25 : intensity === 'light' ? 0.08 : 0.15}))`,
                  boxShadow: intensity === 'heavy'
                    ? '0 0 12px rgba(168,85,247,0.3), 0 0 4px rgba(168,85,247,0.2)'
                    : intensity === 'average'
                    ? '0 0 8px rgba(168,85,247,0.2), 0 0 2px rgba(168,85,247,0.1)'
                    : '0 0 4px rgba(168,85,247,0.15)',
                  filter: `blur(${intensity === 'heavy' ? '2px' : intensity === 'average' ? '1px' : '0.5px'})`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
        <div className="text-center">
          <p className="text-[10px] text-white/25 uppercase tracking-wider">Source FPS</p>
          <p className="text-sm font-mono font-medium text-white/60">{sourceFps}fps</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-white/25 uppercase tracking-wider">Filter</p>
          <p className="text-sm font-mono font-medium text-purple-400">{filterType}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-white/25 uppercase tracking-wider">Intensity</p>
          <p className="text-sm font-mono font-medium text-pink-400/70">{intensityLabel}</p>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Settings Panel ──────────────────── */

function MotionBlurSettingsPanel({ clipId }: { clipId: string }) {
  const clip = useAppStore((s) => s.motionBlurClips.find((c) => c.id === clipId));
  const setClipSettings = useAppStore((s) => s.setMotionBlurClipSettings);
  const setClipStatus = useAppStore((s) => s.setMotionBlurClipStatus);
  const setClipProcessedUrl = useAppStore((s) => s.setMotionBlurClipProcessedUrl);
  const setMotionBlurState = useAppStore((s) => s.setMotionBlurState);
  const motionBlurState = useAppStore((s) => s.motionBlurState);

  if (!clip) return null;

  const isProcessing = motionBlurState.isProcessing && motionBlurState.currentClipId === clipId;

  const handleProcess = async () => {
    try {
      setClipStatus(clipId, 'processing');
      setMotionBlurState({ isProcessing: true, progress: 0, currentClipId: clipId, message: `Applying ${clip.filterType} motion blur...` });

      const progressInterval = setInterval(() => {
        setMotionBlurState({ progress: Math.min((useAppStore.getState().motionBlurState.progress || 0) + Math.random() * 8, 90) });
      }, 500);

      const response = await fetch('/api/motion-blur', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId: clip.id, filterType: clip.filterType, frames: clip.frames, intensity: clip.intensity }),
      });

      clearInterval(progressInterval);
      if (!response.ok) { const e = await response.json().catch(() => ({ error: 'Failed' })); throw new Error(e.error || 'Failed'); }

      const data = await response.json();
      setClipProcessedUrl(clipId, data.outputUrl);
      setClipStatus(clipId, 'done');
      setMotionBlurState({ isProcessing: false, progress: 100, currentClipId: null, message: 'Complete!' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      setClipStatus(clipId, 'error', message);
      setMotionBlurState({ isProcessing: false, progress: 0, currentClipId: null, message: '' });
    }
  };

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-white/70">Motion Blur Settings</h3>
      </div>

      {/* Filter Type */}
      <div className="mb-5">
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-2 block">Filter Type</label>
        <div className="grid grid-cols-2 gap-2">
          {FILTER_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setClipSettings(clipId, { filterType: opt.value })}
              className={`text-left p-3 rounded-xl border transition-all ${
                clip.filterType === opt.value
                  ? 'bg-purple-500/10 border-purple-500/30'
                  : 'bg-white/[0.02] border-white/5 hover:border-purple-500/20 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-mono font-bold ${clip.filterType === opt.value ? 'text-purple-400' : 'text-white/50'}`}>
                  {opt.label}
                </span>
                {clip.filterType === opt.value && (
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                )}
              </div>
              <p className="text-[10px] text-white/30 leading-relaxed">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Frames slider */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">Frames</label>
          <span className="text-xs font-mono font-medium text-purple-400/80">{clip.frames}</span>
        </div>
        <input
          type="range"
          min={2}
          max={16}
          value={clip.frames}
          onChange={(e) => setClipSettings(clipId, { frames: Number(e.target.value) })}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer range-input"
          style={{
            background: `linear-gradient(to right, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0.5) ${((clip.frames - 2) / 14) * 100}%, rgba(255,255,255,0.06) ${((clip.frames - 2) / 14) * 100}%, rgba(255,255,255,0.06) 100%)`,
          }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-white/15">2</span>
          <span className="text-[9px] text-white/15">16</span>
        </div>
      </div>

      {/* Intensity selector */}
      <div className="mb-5">
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-2 block">Intensity</label>
        <div className="grid grid-cols-3 gap-2">
          {INTENSITY_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setClipSettings(clipId, { intensity: opt })}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                clip.intensity === opt
                  ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30 shadow-sm shadow-purple-500/10'
                  : 'bg-white/[0.02] text-white/30 border border-white/5 hover:border-purple-500/20 hover:text-white/50'
              }`}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Processing progress */}
      {isProcessing && (
        <div className="mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            <span className="text-xs text-white/60">{motionBlurState.message || 'Processing...'}</span>
            <span className="text-xs text-purple-400/80 font-mono ml-auto">{Math.round(motionBlurState.progress)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${motionBlurState.progress}%`,
              background: 'linear-gradient(90deg, #a855f7, #ec4899)',
            }} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={handleProcess} disabled={isProcessing || clip.status === 'done'}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
            isProcessing ? 'bg-purple-500/10 text-purple-400/60 cursor-not-allowed'
              : clip.status === 'done' ? 'bg-purple-500/10 text-purple-400/40 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400 shadow-lg shadow-purple-500/20'
          }`}>
          {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> :
           clip.status === 'done' ? <><CheckCircle2 className="w-4 h-4" /> Blur Applied</> :
           <><PlayCircle className="w-4 h-4" /> Apply Motion Blur</>}
        </button>
        {clip.processedUrl && (
          <a href={clip.processedUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-pink-500/10 text-pink-400 border border-pink-500/20 hover:bg-pink-500/20 transition-all">
            <Download className="w-4 h-4" /> Download
          </a>
        )}
      </div>

      {clip.status === 'error' && clip.error && (
        <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <p className="text-xs text-red-400">{clip.error}</p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Batch Process Panel ──────────────────── */

function MotionBlurBatchPanel() {
  const clips = useAppStore((s) => s.motionBlurClips);
  const setClipStatus = useAppStore((s) => s.setMotionBlurClipStatus);
  const setClipProcessedUrl = useAppStore((s) => s.setMotionBlurClipProcessedUrl);
  const setMotionBlurState = useAppStore((s) => s.setMotionBlurState);
  const motionBlurState = useAppStore((s) => s.motionBlurState);
  const { toast } = useToast();
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const processableClips = clips.filter((c) => c.status === 'ready' || c.status === 'error');
  const doneClips = clips.filter((c) => c.status === 'done');

  const handleProcessAll = useCallback(async () => {
    if (processableClips.length === 0) return;
    setIsProcessingAll(true);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < processableClips.length; i++) {
      const clip = processableClips[i];
      setClipStatus(clip.id, 'processing');
      setMotionBlurState({ isProcessing: true, progress: Math.round((i / processableClips.length) * 100), currentClipId: clip.id, message: `Processing ${i + 1}/${processableClips.length}` });

      try {
        const response = await fetch('/api/motion-blur', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clipId: clip.id, filterType: clip.filterType, frames: clip.frames, intensity: clip.intensity }),
        });

        if (!response.ok) { const e = await response.json().catch(() => ({ error: 'Failed' })); throw new Error(e.error || 'Failed'); }

        const data = await response.json();
        setClipProcessedUrl(clip.id, data.outputUrl);
        setClipStatus(clip.id, 'done');
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed';
        setClipStatus(clip.id, 'error', message);
        failCount++;
      }
    }

    setMotionBlurState({ isProcessing: false, progress: 100, currentClipId: null, message: '' });
    setIsProcessingAll(false);
    toast({ title: 'Batch motion blur complete', description: `${successCount} succeeded, ${failCount} failed.`, variant: failCount > 0 ? 'destructive' : 'default' });
  }, [processableClips, setClipStatus, setClipProcessedUrl, setMotionBlurState, toast]);

  const handleDownloadZip = async () => {
    const doneClipIds = doneClips.map((c) => {
      const url = c.processedUrl || '';
      const match = url.match(/id=([\w-]+)/);
      return match ? match[1] : c.id;
    });
    if (doneClipIds.length === 0) return;

    try {
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: doneClipIds }),
      });

      if (!response.ok) throw new Error('Failed to create ZIP');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'motion-blur-videos.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: 'Download failed', description: err instanceof Error ? err.message : 'Failed to download ZIP', variant: 'destructive' });
    }
  };

  const handleDownloadAllZip = async () => {
    if (clips.length === 0) return;

    const allClipIds = clips.map((c) => {
      if (c.processedUrl) {
        const match = c.processedUrl.match(/id=([\w-]+)/);
        if (match) return match[1];
      }
      return c.id;
    });

    try {
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: allClipIds }),
      });

      if (!response.ok) throw new Error('Failed to create ZIP');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'all-motion-blur-clips.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: 'Download failed', description: err instanceof Error ? err.message : 'Failed to download ZIP', variant: 'destructive' });
    }
  };

  if (clips.length === 0) return null;

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wind className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-white/70">Batch Process</h3>
        <span className="text-xs text-white/20 ml-auto">{doneClips.length}/{clips.length} done</span>
      </div>

      {isProcessingAll && (
        <div className="w-full h-1.5 rounded-full bg-white/5 mb-4 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-400 transition-all duration-500" style={{ width: `${motionBlurState.progress}%` }} />
        </div>
      )}

      <div className="space-y-2">
        <button onClick={handleProcessAll} disabled={isProcessingAll || processableClips.length === 0 || motionBlurState.isProcessing}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
            isProcessingAll || motionBlurState.isProcessing ? 'bg-purple-500/10 text-purple-400/60 cursor-not-allowed' :
            processableClips.length === 0 ? 'bg-white/[0.03] text-white/20 cursor-not-allowed' :
            'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400 shadow-lg shadow-purple-500/20'
          }`}>
          {isProcessingAll || motionBlurState.isProcessing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Processing {processableClips.length} clip{processableClips.length > 1 ? 's' : ''}...</>
          ) : (
            <><PlayCircle className="w-4 h-4" /> Process All ({processableClips.length})</>
          )}
        </button>

        {doneClips.length > 0 && (
          <button onClick={handleDownloadZip}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-pink-500/10 text-pink-400 border border-pink-500/20 hover:bg-pink-500/20 transition-all">
            <Archive className="w-4 h-4" /> Download Processed ZIP ({doneClips.length})
          </button>
        )}

        {clips.length > 0 && (
          <button onClick={handleDownloadAllZip}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-all">
            <Download className="w-4 h-4" /> Download All as ZIP ({clips.length})
          </button>
        )}
      </div>

      {processableClips.length === 0 && clips.length > 0 && (
        <p className="text-[10px] text-white/20 mt-2 text-center">All clips have been processed</p>
      )}
    </div>
  );
}

/* ──────────────────── Main Page ──────────────────── */

export function MotionBlurPage() {
  const clips = useAppStore((s) => s.motionBlurClips);
  const selectedId = useAppStore((s) => s.selectedMotionBlurClipId);
  const selectedClip = useAppStore((s) => s.motionBlurClips.find((c) => c.id === s.selectedMotionBlurClipId));
  const selectClip = useAppStore((s) => s.selectMotionBlurClip);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden pb-20">
      {/* Background effects - purple themed */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
      </div>
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.06) 0%, transparent 70%)', filter: 'blur(40px)' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Wind className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-purple-400 via-white/90 to-pink-400 bg-clip-text text-transparent">Motion Blur</h1>
                <p className="text-[10px] text-white/25 tracking-wider uppercase">
                  {selectedClip ? `${selectedClip.filterType} · ${selectedClip.intensity}` : 'Cinematic motion trails'}
                </p>
              </div>
            </div>
            {clips.length > 0 && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-white/25">
                  <Film className="w-3.5 h-3.5" /><span>{clips.length} clip{clips.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="hidden sm:flex items-center gap-3">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-400/70 font-mono">
                    <Wind className="w-3 h-3" />tblend/tmix
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-[10px] text-pink-400/70 font-mono">
                    <Archive className="w-3 h-3" />ZIP Download
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {clips.length === 0 ? (
            /* ── Empty State ── */
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] gap-8 animate-fade-in">
              <div className="text-center space-y-4 max-w-lg">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 text-xs text-purple-400/80 mb-2">
                  <Sparkles className="w-3 h-3" /> Motion Blur
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-white/90 leading-tight">
                  Add <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">cinematic motion blur</span>
                </h2>
                <p className="text-sm text-white/30 leading-relaxed max-w-md mx-auto">
                  Apply temporal blur effects to your videos. Choose between tblend for smooth trails or tmix for long-exposure style blur. Batch upload and download supported.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                  {[
                    { text: 'tblend & tmix', icon: <Wind className="w-3.5 h-3.5" /> },
                    { text: 'Batch Upload', icon: <Upload className="w-3.5 h-3.5" /> },
                    { text: 'ZIP Download', icon: <Archive className="w-3.5 h-3.5" /> },
                    { text: '3 Intensities', icon: <Gauge className="w-3.5 h-3.5" /> },
                  ].map((f) => (
                    <div key={f.text} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/5 border border-purple-500/15">
                      <span className="text-purple-400/60">{f.icon}</span>
                      <span className="text-xs text-purple-400/60 font-medium">{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <MotionBlurUploadZone />
              <div className="flex flex-wrap items-center justify-center gap-6 mt-4">
                {[
                  { icon: <Wind className="w-4 h-4" />, text: 'Temporal Blur' },
                  { icon: <Eye className="w-4 h-4" />, text: 'Long Exposure' },
                  { icon: <Sparkles className="w-4 h-4" />, text: 'FFmpeg Powered' },
                ].map((f) => (
                  <div key={f.text} className="flex items-center gap-2 text-xs text-white/20">
                    <span className="text-purple-400/40">{f.icon}</span>{f.text}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── With Clips ── */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              <div className="lg:col-span-1">
                <div className="sticky top-8 space-y-4">
                  <MotionBlurClipList />
                  <MotionBlurBatchPanel />
                </div>
              </div>
              <div className="lg:col-span-2 space-y-6">
                {selectedId && selectedClip ? (
                  <>
                    {/* Selected clip header */}
                    <div className="flex items-center gap-3 px-1">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500/10 to-pink-500/10">
                        <Wind className="w-4 h-4 text-white/70" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-medium text-white/80 truncate">{selectedClip.originalName}</h2>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs font-mono font-medium bg-gradient-to-r from-purple-400/70 to-pink-400/70 bg-clip-text text-transparent">{selectedClip.filterType} · {selectedClip.intensity}</span>
                          <span className="text-[10px] text-white/25">{selectedClip.width}x{selectedClip.height} · {selectedClip.codec} · {formatDuration(selectedClip.duration)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gradient-to-r from-purple-500/10 to-pink-500/10 text-white/60 border border-white/10">
                        MBlur
                      </div>
                    </div>

                    {/* Motion Blur Visual */}
                    <MotionBlurVisual sourceFps={selectedClip.fps} filterType={selectedClip.filterType} intensity={selectedClip.intensity} />

                    {/* Settings Panel */}
                    <MotionBlurSettingsPanel clipId={selectedId} />

                    {/* Clip details */}
                    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Film className="w-4 h-4 text-pink-400" />
                        <h3 className="text-sm font-medium text-white/70">Clip Details</h3>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[
                          { label: 'Resolution', value: `${selectedClip.width}x${selectedClip.height}` },
                          { label: 'Duration', value: formatDuration(selectedClip.duration) },
                          { label: 'Source FPS', value: `${selectedClip.fps}` },
                          { label: 'Codec', value: selectedClip.codec.toUpperCase() },
                          { label: 'Format', value: selectedClip.format.toUpperCase() },
                          { label: 'Size', value: formatFileSize(selectedClip.fileSize) },
                        ].map((item) => (
                          <div key={item.label} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                            <p className="text-[10px] text-white/25 uppercase tracking-wider">{item.label}</p>
                            <p className="text-xs font-medium text-white/60 mt-0.5">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Individual downloads for all done clips */}
                    {clips.filter(c => c.status === 'done').length > 0 && (
                      <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Download className="w-4 h-4 text-pink-400" />
                          <h3 className="text-sm font-medium text-white/70">Downloads</h3>
                        </div>
                        <div className="space-y-2">
                          {clips.filter(c => c.status === 'done' && c.processedUrl).map((clip) => (
                            <a key={clip.id} href={clip.processedUrl!} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-pink-500/20 hover:bg-white/[0.04] transition-all group">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/10 shrink-0">
                                <Wind className="w-4 h-4 text-purple-400/70" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-white/70 truncate group-hover:text-white/90 transition-colors">{clip.originalName}</p>
                                <p className="text-[10px] text-white/30">{clip.filterType} · {clip.intensity} · {clip.width}x{clip.height}</p>
                              </div>
                              <Download className="w-4 h-4 text-white/20 group-hover:text-pink-400 transition-colors shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 rounded-2xl bg-[#0f0f17] border border-white/5">
                    <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center">
                      <Wind className="w-6 h-6 text-white/15" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-white/40">Select a clip to configure</p>
                      <p className="text-xs text-white/20 mt-1">Choose a clip from the list to set filter type and process</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <style jsx global>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s ease-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
      `}</style>
    </div>
  );
}

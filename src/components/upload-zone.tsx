'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Upload, Film, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAppStore, createReverseSpeedRamp, DEFAULT_CONFIG, MAX_AUTO_TRIM_DURATION, RAMP_START, RAMP_MID, RAMP_END } from '@/lib/store';
import type { VideoClip } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { probeVideoLocal, uploadInChunks, DIRECT_UPLOAD_LIMIT } from '@/lib/chunked-client';

const ACCEPTED_EXTENSIONS = '.mp4,.mov,.avi,.webm,.mkv';

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'analyzing' | 'done' | 'error';
  error?: string;
}

export function UploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addClip = useAppStore((s) => s.addClip);
  const { toast } = useToast();

  const setUpload = useCallback((fileName: string, patch: Partial<UploadProgress>) => {
    setUploads((prev) => prev.map((u) => (u.fileName === fileName ? { ...u, ...patch } : u)));
  }, []);

  /**
   * Analyze one file:
   *  1. Instant local probe in the browser (duration/dimensions, zero upload).
   *  2. Server analysis for full metadata (codec/fps/audio) — direct for
   *     small files, chunked for large ones (defeats the ~4.5MB Vercel cap).
   *  3. If the server is unreachable, the local probe still yields a
   *     fully usable clip — ingest never hard-fails with "Upload failed".
   */
  const analyzeFile = useCallback(
    async (file: File) => {
      let local: { duration: number; width: number; height: number } | null = null;
      try {
        local = await probeVideoLocal(file);
      } catch {
        local = null;
      }

      try {
        let data: Record<string, unknown>;
        if (file.size <= DIRECT_UPLOAD_LIMIT) {
          setUpload(file.name, { status: 'analyzing', progress: 60 });
          const formData = new FormData();
          formData.append('file', file);
          const response = await fetch('/api/analyze', { method: 'POST', body: formData });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error((errorData.error as string) || 'Upload failed');
          }
          data = await response.json();
        } else {
          setUpload(file.name, { status: 'uploading', progress: 0 });
          const { uploadId } = await uploadInChunks(file, {
            onProgress: (p) => setUpload(file.name, { status: 'uploading', progress: p.pct }),
          });
          setUpload(file.name, { status: 'analyzing', progress: 95 });
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId }),
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error((errorData.error as string) || 'Upload failed');
          }
          data = await response.json();
        }
        return { data, localFallback: false };
      } catch (err) {
        if (!local || (!local.duration && !local.width)) throw err;
        // Graceful degradation: local metadata is enough to work with.
        const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
        return {
          data: {
            id: crypto.randomUUID(),
            fileName: file.name,
            originalName: file.name,
            duration: local.duration || 0,
            width: local.width || 0,
            height: local.height || 0,
            fps: 30,
            codec: 'unknown',
            bitrate: 0,
            format: ext,
            fileSize: file.size,
            hasAudio: true,
            audioCodec: null,
          } as Record<string, unknown>,
          localFallback: true,
        };
      }
    },
    [setUpload]
  );

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
          const { data, localFallback } = await analyzeFile(file);
          const duration = Number(data.duration) || 0;
          const trimDuration = Math.min(duration || MAX_AUTO_TRIM_DURATION, MAX_AUTO_TRIM_DURATION);

          const clip: VideoClip = {
            id: String(data.id),
            fileName: String(data.fileName),
            originalName: String(data.originalName),
            duration,
            width: Number(data.width) || 0,
            height: Number(data.height) || 0,
            fps: Number(data.fps) || 0,
            codec: String(data.codec || 'unknown'),
            bitrate: Number(data.bitrate) || 0,
            format: String(data.format || ''),
            fileSize: Number(data.fileSize) || file.size,
            trimDuration,
            speedRamps: createReverseSpeedRamp(trimDuration),
            config: { ...DEFAULT_CONFIG, trimDuration },
            hasAudio: Boolean(data.hasAudio),
            originalFile: file,
            status: 'ready',
          };

          addClip(clip);
          setUpload(file.name, { progress: 100, status: 'done' });

          toast({
            title: 'Video uploaded — Reverse Speed Ramp created',
            description: localFallback
              ? `${file.name}: metadata read locally (server analysis unavailable)`
              : `${file.name}: First ${trimDuration.toFixed(2)}s → ${RAMP_START}x→${RAMP_MID}x→${RAMP_END}x`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to upload video';
          setUpload(file.name, { status: 'error', error: message, progress: 0 });
          toast({ title: 'Upload failed', description: message, variant: 'destructive' });
        }
      }

      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.status === 'uploading' || u.status === 'analyzing'));
      }, 3000);
    },
    [addClip, analyzeFile, toast]
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
        className={`relative rounded-3xl cursor-pointer transition-all duration-500 ease-snap ${isDragging ? 'scale-[1.02]' : 'scale-100'}`}
      >
        {/* Glow ring on drag */}
        {isDragging && (
          <div className="absolute -inset-1 rounded-3xl opacity-60 pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.3), transparent 70%)', filter: 'blur(20px)' }} />
        )}
        <div className={`relative rounded-3xl border-2 border-dashed transition-all duration-300 ease-snap ${
          isDragging
            ? 'border-violet-500/50 bg-violet-500/5'
            : 'border-white/10 bg-white/[0.02] hover:border-violet-500/40 hover:bg-white/[0.03]'
        } p-12 md:p-16 flex flex-col items-center justify-center gap-5`}>
          <div className={`relative transition-all duration-300 ease-snap ${isDragging ? 'scale-110' : 'scale-100'}`}>
            <div className={`relative w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ease-snap ${
              isDragging ? 'bg-violet-500/20 shadow-[0_0_30px_-5px_rgba(139,92,246,0.5)]' : 'bg-white/[0.03]'
            }`}>
              <Upload className={`w-8 h-8 md:w-10 md:h-10 transition-all duration-300 ease-snap ${
                isDragging ? 'text-violet-400 animate-bounce-subtle' : 'text-neutral-500'
              }`} />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className={`font-serif-display text-2xl transition-colors duration-300 ${isDragging ? 'text-violet-300' : 'text-white'}`}>
              {isDragging ? 'Release to upload' : 'Drop your video here'}
            </h3>
            <p className="text-sm text-neutral-500">or click to browse · auto-creates reverse speed ramp · large files supported</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Film className="w-3.5 h-3.5 text-neutral-600" />
            <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500">MP4 · MOV · AVI · WEBM · MKV</span>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} multiple onChange={handleInputChange} className="hidden" />

      {activeUploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {activeUploads.map((upload, idx) => (
            <div key={`${upload.fileName}-${idx}`} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {upload.status === 'error' ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0" /> :
                   upload.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> :
                   <Loader2 className="w-4 h-4 text-violet-400 shrink-0 animate-spin" />}
                  <span className="text-sm text-neutral-300 truncate">{upload.fileName}</span>
                </div>
                <span className="text-xs font-mono-display text-neutral-500 shrink-0 ml-2">
                  {upload.status === 'analyzing' ? 'Analyzing...' : upload.status === 'error' ? 'Failed' : `${Math.round(upload.progress)}%`}
                </span>
              </div>
              {upload.status !== 'error' && (
                <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300 ease-snap" style={{
                    width: `${upload.progress}%`,
                    background: upload.progress >= 100
                      ? 'linear-gradient(90deg, #10b981, #06b6d4)'
                      : 'linear-gradient(90deg, #8b5cf6, #06b6d4)',
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

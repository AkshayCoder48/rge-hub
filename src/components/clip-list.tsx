'use client';

import React, { useRef, useState } from 'react';
import { useAppStore, formatDuration, formatFileSize, createReverseSpeedRamp, DEFAULT_CONFIG, MAX_AUTO_TRIM_DURATION, RAMP_START, RAMP_MID, RAMP_END } from '@/lib/store';
import { Film, Trash2, Clock, MonitorPlay, Plus, Loader2, Combine } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { VideoClip } from '@/lib/types';
import { probeVideoLocal, uploadInChunks, DIRECT_UPLOAD_LIMIT } from '@/lib/chunked-client';

export function ClipList() {
  const clips = useAppStore((s) => s.clips);
  const selectedClipId = useAppStore((s) => s.selectedClipId);
  const selectClip = useAppStore((s) => s.selectClip);
  const removeClip = useAppStore((s) => s.removeClip);
  const addClip = useAppStore((s) => s.addClip);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  const analyzeFile = async (file: File): Promise<Record<string, unknown>> => {
    // 1. Instant local probe (no upload) as the safety net.
    let local: { duration: number; width: number; height: number } | null = null;
    try {
      local = await probeVideoLocal(file);
    } catch {
      local = null;
    }

    // 2. Server analysis — direct for small files, chunked for large ones
    // (defeats the ~4.5MB Vercel request cap that caused 413s).
    try {
      let data: Record<string, unknown>;
      if (file.size <= DIRECT_UPLOAD_LIMIT) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/analyze', { method: 'POST', body: formData });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error((err.error as string) || 'Upload failed');
        }
        data = await response.json();
      } else {
        const { uploadId } = await uploadInChunks(file);
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error((err.error as string) || 'Upload failed');
        }
        data = await response.json();
      }
      return data;
    } catch (err) {
      // 3. Graceful degradation: local metadata still yields a usable clip.
      if (!local || (!local.duration && !local.width)) throw err;
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
      return {
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
      };
    }
  };

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
        const data = await analyzeFile(file);
        const duration = Number(data.duration) || 0;
        const trimDuration = Math.min(duration || MAX_AUTO_TRIM_DURATION, MAX_AUTO_TRIM_DURATION);

        const clip: VideoClip = {
          id: String(data.id), fileName: String(data.fileName), originalName: String(data.originalName),
          duration, width: Number(data.width) || 0, height: Number(data.height) || 0,
          fps: Number(data.fps) || 0, codec: String(data.codec || 'unknown'), bitrate: Number(data.bitrate) || 0,
          format: String(data.format || ''), fileSize: Number(data.fileSize) || file.size,
          trimDuration,
          speedRamps: createReverseSpeedRamp(trimDuration),
          config: { ...DEFAULT_CONFIG, trimDuration },
          hasAudio: Boolean(data.hasAudio),
          originalFile: file,
          status: 'ready',
        };
        addClip(clip);
        successCount++;
      } catch {
        toast({ title: `Upload failed: ${file.name}`, variant: 'destructive' });
      } finally {
        setUploadingCount((prev) => prev - 1);
      }
    }

    if (successCount > 0) {
      toast({ title: `${successCount} video${successCount > 1 ? 's' : ''} uploaded`, description: `${successCount} reverse speed ramp clip${successCount > 1 ? 's' : ''} created.` });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500">Clips ({clips.length})</h2>
        {uploadingCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-violet-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Uploading {uploadingCount}...
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-[calc(100vh-340px)] overflow-y-auto pr-1 custom-scrollbar">
        {clips.map((clip) => {
          const speedStart = clip.speedRamps[0]?.speed ?? 0;
          const speedMid = clip.speedRamps[Math.floor(clip.speedRamps.length / 2)]?.speed ?? 0;
          const speedEnd = clip.speedRamps[clip.speedRamps.length - 1]?.speed ?? 0;

          return (
            <div
              key={clip.id}
              onClick={() => selectClip(clip.id)}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectClip(clip.id); }}
              className={`w-full text-left rounded-2xl p-3 transition-all duration-300 ease-snap group cursor-pointer ${
                selectedClipId === clip.id
                  ? 'bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/30 shadow-[0_0_20px_-10px_rgba(139,92,246,0.4)]'
                  : 'bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-violet-500/10 to-cyan-500/10">
                  <Combine className="w-4 h-4 text-neutral-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{clip.originalName}</p>
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-violet-400 border border-violet-500/20 font-mono-display font-medium">V-RAMP</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono-display font-medium bg-gradient-to-r from-violet-400/80 to-cyan-400/80 bg-clip-text text-transparent">
                      {speedStart}x → {speedMid}x → {speedEnd}x
                    </span>
                    <span className="flex items-center gap-1 text-xs text-neutral-500 font-mono-display">
                      <Clock className="w-3 h-3" /> {clip.trimDuration.toFixed(2)}s
                    </span>
                    <span className="flex items-center gap-1 text-xs text-neutral-500 font-mono-display">
                      <MonitorPlay className="w-3 h-3" /> {clip.width}×{clip.height}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-mono-display font-medium ${
                      clip.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400' :
                      clip.status === 'processing' ? 'bg-violet-500/10 text-violet-400' :
                      clip.status === 'done' ? 'bg-cyan-500/10 text-cyan-400' :
                      clip.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-neutral-500'
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${
                        clip.status === 'ready' ? 'bg-emerald-400' :
                        clip.status === 'processing' ? 'bg-violet-400 animate-pulse' :
                        clip.status === 'done' ? 'bg-cyan-400' :
                        clip.status === 'error' ? 'bg-red-400' : 'bg-neutral-500'
                      }`} />
                      {clip.status === 'ready' ? 'Ready' : clip.status === 'processing' ? 'Processing' :
                       clip.status === 'done' ? 'Complete' : clip.status === 'error' ? 'Error' : 'Idle'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-snap">
                  <button onClick={(e) => { e.stopPropagation(); removeClip(clip.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-neutral-600 transition-all duration-300 ease-snap" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 space-y-2">
        <button onClick={() => fileInputRef.current?.click()} disabled={uploadingCount > 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium bg-white/[0.02] border border-dashed border-white/10 text-neutral-400 hover:bg-white/[0.04] hover:border-violet-500/30 hover:text-violet-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 ease-snap">
          {uploadingCount > 0 ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><Plus className="w-4 h-4" /> Add More Videos</>}
        </button>
        <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.webm,.mkv" multiple onChange={async (e) => { if (e.target.files?.length) { await handleFileUpload(e.target.files); e.target.value = ''; } }} className="hidden" />
        <p className="text-[10px] font-mono-display text-neutral-600 text-center tracking-wide">Each video creates 1 reverse speed ramp clip ({RAMP_START}x→{RAMP_MID}x→{RAMP_END}x)</p>
      </div>
    </div>
  );
}

'use client';

import React, { useRef, useState } from 'react';
import { useAppStore, formatDuration, formatFileSize, createReverseSpeedRamp, DEFAULT_TRIM_DURATION, RAMP_START, RAMP_MID, RAMP_END } from '@/lib/store';
import { Film, Trash2, Clock, MonitorPlay, Plus, Loader2, Combine } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { VideoClip } from '@/lib/types';

export function ClipList() {
  const clips = useAppStore((s) => s.clips);
  const selectedClipId = useAppStore((s) => s.selectedClipId);
  const selectClip = useAppStore((s) => s.selectClip);
  const removeClip = useAppStore((s) => s.removeClip);
  const addClip = useAppStore((s) => s.addClip);
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

        const trimDuration = Math.min(DEFAULT_TRIM_DURATION, data.duration);

        const clip: VideoClip = {
          id: data.id, fileName: data.fileName, originalName: data.originalName,
          duration: data.duration, width: data.width, height: data.height,
          fps: data.fps, codec: data.codec, bitrate: data.bitrate,
          format: data.format, fileSize: data.fileSize,
          trimDuration,
          speedRamps: createReverseSpeedRamp(trimDuration),
          hasAudio: data.hasAudio,
          originalFile: file, // Store the original File object for re-uploading during process
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
        <h2 className="text-sm font-medium text-white/50 uppercase tracking-wider">Clips ({clips.length})</h2>
        {uploadingCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-orange-400/70">
            <Loader2 className="w-3 h-3 animate-spin" /> Uploading {uploadingCount}...
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1 custom-scrollbar">
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
              className={`w-full text-left rounded-xl p-3 transition-all duration-200 group cursor-pointer ${
                selectedClipId === clip.id
                  ? 'bg-gradient-to-r from-orange-500/10 to-cyan-500/10 border border-orange-500/30'
                  : 'bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-orange-500/10 to-cyan-500/10">
                  <Combine className="w-4 h-4 text-white/60" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white/80 truncate">{clip.originalName}</p>
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-orange-500/10 to-cyan-500/10 text-white/50 border border-white/10 font-medium">V-RAMP</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono font-medium bg-gradient-to-r from-orange-400/60 to-cyan-400/60 bg-clip-text text-transparent">
                      {speedStart}x → {speedMid}x → {speedEnd}x
                    </span>
                    <span className="flex items-center gap-1 text-xs text-white/30">
                      <Clock className="w-3 h-3" /> {clip.trimDuration.toFixed(2)}s
                    </span>
                    <span className="flex items-center gap-1 text-xs text-white/30">
                      <MonitorPlay className="w-3 h-3" /> {clip.width}x{clip.height}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      clip.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400' :
                      clip.status === 'processing' ? 'bg-orange-500/10 text-orange-400' :
                      clip.status === 'done' ? 'bg-cyan-500/10 text-cyan-400' :
                      clip.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-white/30'
                    }`}>
                      {clip.status === 'ready' ? '● Ready' : clip.status === 'processing' ? '● Processing' :
                       clip.status === 'done' ? '● Complete' : clip.status === 'error' ? '● Error' : '● Idle'}
                    </span>
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
          );
        })}
      </div>

      <div className="pt-2 space-y-2">
        <button onClick={() => fileInputRef.current?.click()} disabled={uploadingCount > 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-white/[0.02] border border-dashed border-white/10 text-white/40 hover:bg-white/[0.05] hover:border-orange-500/30 hover:text-orange-400/70 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
          {uploadingCount > 0 ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><Plus className="w-4 h-4" /> Add More Videos</>}
        </button>
        <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.webm,.mkv" multiple onChange={async (e) => { if (e.target.files?.length) { await handleFileUpload(e.target.files); e.target.value = ''; } }} className="hidden" />
        <p className="text-[10px] text-white/15 text-center">Each video creates 1 reverse speed ramp clip ({RAMP_START}x→{RAMP_MID}x→{RAMP_END}x)</p>
      </div>
    </div>
  );
}

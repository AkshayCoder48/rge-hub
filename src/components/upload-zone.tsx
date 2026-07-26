'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Upload, Film, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAppStore, createReverseSpeedRamp, DEFAULT_TRIM_DURATION, RAMP_START, RAMP_MID, RAMP_END } from '@/lib/store';
import type { VideoClip } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

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
          const trimDuration = Math.min(DEFAULT_TRIM_DURATION, data.duration);

          const clip: VideoClip = {
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
            trimDuration,
            speedRamps: createReverseSpeedRamp(trimDuration),
            hasAudio: data.hasAudio,
            originalFile: file, // Store the original File object for re-uploading during process
            status: 'ready',
          };

          addClip(clip);

          setUploads((prev) => prev.map((u) =>
            u.fileName === file.name ? { ...u, progress: 100, status: 'done' } : u
          ));

          toast({
            title: 'Video uploaded — Reverse Speed Ramp created',
            description: `${file.name}: First ${trimDuration.toFixed(2)}s → ${RAMP_START}x→${RAMP_MID}x→${RAMP_END}x`,
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
    [addClip, toast]
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
            : 'border-white/10 bg-[#0f0f17] hover:border-orange-500/50 hover:bg-[#0f0f17]/80'
        } p-12 md:p-16 flex flex-col items-center justify-center gap-4`}>
          <div className={`relative transition-all duration-300 ${isDragging ? 'scale-110' : 'scale-100'}`}>
            <div className={`relative w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              isDragging ? 'bg-orange-500/20' : 'bg-white/5'
            }`}>
              <Upload className={`w-8 h-8 md:w-10 md:h-10 transition-all duration-300 ${
                isDragging ? 'text-orange-400 animate-bounce' : 'text-white/40'
              }`} />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className={`text-lg md:text-xl font-semibold transition-colors ${isDragging ? 'text-orange-400' : 'text-white/80'}`}>
              {isDragging ? 'Release to upload' : 'Drop your video here'}
            </h3>
            <p className="text-sm text-white/40">or click to browse · Auto-creates reverse speed ramp</p>
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
                   <Loader2 className="w-4 h-4 text-orange-400 shrink-0 animate-spin" />}
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
                    background: upload.progress >= 100 ? 'linear-gradient(90deg, #22c55e, #22d3ee)' : 'linear-gradient(90deg, #f97316, #22d3ee)',
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

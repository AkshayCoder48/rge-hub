'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Film, AlertCircle, ShieldCheck, FileVideo } from 'lucide-react';
import { isWebCodecsSupported, MP4Demuxer } from '@/lib/video';
import type { VideoMetadata } from '@/lib/video';
import { useToast } from '@/hooks/use-toast';

const ACCEPTED_EXTENSIONS = '.mp4,.webm,.mov';

interface VideoUploaderProps {
  onFileSelected: (file: File, metadata: VideoMetadata) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${s}s`;
}

export function VideoUploader({ onFileSelected }: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [webCodecsSupported, setWebCodecsSupported] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWebCodecsSupported(isWebCodecsSupported());
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const validExt = ['mp4', 'webm', 'mov'].includes(ext || '');
      if (!validExt && !file.type.startsWith('video/')) {
        toast({ title: 'Invalid file type', description: 'Please upload MP4, WebM, or MOV files.', variant: 'destructive' });
        return;
      }

      setIsLoading(true);
      try {
        const meta = await MP4Demuxer.extractMetadata(file);
        const videoMetadata: VideoMetadata = {
          filename: file.name,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          fileSize: file.size,
          codec: meta.codec,
          hasAudio: meta.hasAudio,
        };
        setMetadata(videoMetadata);
        setSelectedFile(file);
        onFileSelected(file, videoMetadata);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read video metadata';
        toast({ title: 'Metadata extraction failed', description: message, variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    },
    [onFileSelected, toast]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
        e.target.value = '';
      }
    },
    [handleFiles]
  );

  // WebCodecs not supported error (only show after client hydration)
  if (mounted && !webCodecsSupported) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="rounded-2xl bg-[#0f0f17] border border-red-500/20 p-8 md:p-12 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold text-red-400">Browser Not Supported</h3>
            <p className="text-sm text-white/40 max-w-md">
              WebCodecs API is not available in this browser. Motion blur processing requires Chrome 94+ or Edge 94+.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show metadata after file is loaded
  if (metadata && selectedFile) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <FileVideo className="w-5 h-5 text-orange-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-white/80 truncate">{metadata.filename}</h3>
              <p className="text-xs text-white/30 mt-0.5">Ready for motion blur processing</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Duration', value: formatDuration(metadata.duration) },
              { label: 'Resolution', value: `${metadata.width}×${metadata.height}` },
              { label: 'Frame Rate', value: `${Math.round(metadata.fps)} fps` },
              { label: 'File Size', value: formatFileSize(metadata.fileSize) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
                <p className="text-[10px] text-white/25 uppercase tracking-wider">{item.label}</p>
                <p className="text-sm font-medium text-white/70 mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        className={`relative rounded-2xl cursor-pointer transition-all duration-500 ${isDragging ? 'scale-[1.02]' : 'scale-100'} ${isLoading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div
          className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 ${
            isDragging
              ? 'border-orange-500/50 bg-[#0f0f17]'
              : 'border-white/10 bg-[#0f0f17] hover:border-orange-500/30'
          } p-10 md:p-14 flex flex-col items-center justify-center gap-4`}
        >
          <div className={`relative transition-all duration-300 ${isDragging ? 'scale-110' : 'scale-100'}`}>
            <div
              className={`relative w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                isDragging ?'bg-orange-500/20' : 'bg-white/5'
              }`}
            >
              {isLoading ? (
                <div className="w-8 h-8 md:w-10 md:h-10 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
              ) : (
                <Upload
                  className={`w-8 h-8 md:w-10 md:h-10 transition-all duration-300 ${
                    isDragging ? 'text-orange-400 animate-bounce' : 'text-white/40'
                  }`}
                />
              )}
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3
              className={`text-lg md:text-xl font-semibold transition-colors ${
                isDragging ? 'text-orange-400' : 'text-white/80'
              }`}
            >
              {isLoading ? 'Reading, analyzing…' : isDragging ? 'Release to upload' : 'Drop your video here'}
            </h3>
            <p className="text-sm text-white/40">
              {isLoading ? 'Extracting video metadata' : 'or click to browse'}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Film className="w-3.5 h-3.5 text-white/20" />
            <span className="text-xs text-white/25 tracking-wide">MP4 · WebM · MOV</span>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Privacy notice */}
      <div className="flex items-center justify-center gap-2 mt-4">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan-400/50" />
        <p className="text-xs text-white/25">
          Your video is processed locally in your browser. It is not uploaded to a server.
        </p>
      </div>
    </div>
  );
}

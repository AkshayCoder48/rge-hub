'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useAppStore, formatDuration } from '@/lib/store';
import { Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, Download } from 'lucide-react';

interface VideoPreviewProps {
  clipId: string;
}

export function VideoPreview({ clipId }: VideoPreviewProps) {
  const clip = useAppStore((s) => s.clips.find((c) => c.id === clipId));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [playbackState, setPlaybackState] = useState<'playing' | 'paused' | 'loading'>('paused');
  const [timeDisplay, setTimeDisplay] = useState({ current: 0, duration: 0 });

  const hasProcessed = !!clip?.processedUrl && clip?.status === 'done';
  const originalUrl = clip?.url || '';
  const videoSrc = clip ? (showOriginal ? originalUrl : (clip.processedUrl || originalUrl)) : '';

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play().catch(() => setPlaybackState('paused')); }
    else { video.pause(); }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) setTimeDisplay({ current: video.currentTime, duration: video.duration || 0 });
  }, []);

  const handlePlay = useCallback(() => setPlaybackState('playing'), []);
  const handlePause = useCallback(() => setPlaybackState('paused'), []);
  const handleWaiting = useCallback(() => setPlaybackState('loading'), []);
  const handleCanPlay = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused) setPlaybackState('playing');
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) { video.muted = !video.muted; setIsMuted(video.muted); }
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration;
  }, []);

  const handleFullscreen = useCallback(() => {
    videoRef.current?.requestFullscreen();
  }, []);

  const handleRestart = useCallback(() => {
    const video = videoRef.current;
    if (video) { video.currentTime = 0; video.play().catch(() => setPlaybackState('paused')); }
  }, []);

  if (!clip) return null;
  const progress = timeDisplay.duration > 0 ? (timeDisplay.current / timeDisplay.duration) * 100 : 0;

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between p-4 pb-0">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-medium text-white/70">Preview</h3>
        </div>
        {hasProcessed && (
          <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-0.5">
            <button onClick={() => setShowOriginal(false)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${!showOriginal ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' : 'text-white/30 hover:text-white/50'}`}>
              Processed
            </button>
            <button onClick={() => setShowOriginal(true)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${showOriginal ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30' : 'text-white/30 hover:text-white/50'}`}>
              Original
            </button>
          </div>
        )}
      </div>

      <div className="relative mt-3 mx-4 rounded-xl overflow-hidden bg-black aspect-video">
        <video ref={videoRef} src={videoSrc} className="w-full h-full object-contain" preload="metadata" playsInline
          onClick={handlePlayPause} onTimeUpdate={handleTimeUpdate} onPlay={handlePlay} onPause={handlePause}
          onWaiting={handleWaiting} onCanPlay={handleCanPlay} />
        {playbackState === 'paused' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer" onClick={handlePlayPause}>
            <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/20 hover:bg-white/20 transition-all">
              <Play className="w-6 h-6 text-white ml-1" />
            </div>
          </div>
        )}
        {playbackState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-10 h-10 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
          </div>
        )}
        {clip.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center">
              <div className="w-10 h-10 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-white/50">Processing V-Ramp...</p>
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
            showOriginal ? 'bg-orange-500/20 text-orange-400' : hasProcessed ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/10 text-white/40'
          }`}>{showOriginal ? 'ORIGINAL' : hasProcessed ? 'V-RAMP' : 'ORIGINAL'}</span>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4">
        <div className="relative w-full h-1.5 rounded-full bg-white/5 mb-3 cursor-pointer group" onClick={handleProgressClick}>
          <div className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-orange-500 to-cyan-400 transition-all duration-100" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-white/30 font-mono mb-2">
          <span>{formatDuration(timeDisplay.current)}</span>
          <span>{formatDuration(timeDisplay.duration)}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={handlePlayPause} className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 text-white/60 hover:text-white/90 transition-all">
              {playbackState === 'playing' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={handleRestart} className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 text-white/60 hover:text-white/90 transition-all">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={toggleMute} className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 text-white/60 hover:text-white/90 transition-all">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {hasProcessed && clip.processedUrl && (
              <a href={clip.processedUrl} target="_blank" rel="noopener noreferrer"
                className="p-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400/60 hover:text-cyan-400 transition-all">
                <Download className="w-4 h-4" />
              </a>
            )}
            <button onClick={handleFullscreen} className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/10 text-white/60 hover:text-white/90 transition-all">
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

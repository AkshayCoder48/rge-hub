'use client';

import React, { useState } from 'react';
import { useAppStore, formatDuration, RAMP_START, RAMP_MID, RAMP_END } from '@/lib/store';
import { Download, Loader2, Film, Settings2, Clock, Gauge, Scissors, Combine } from 'lucide-react';

interface ExportPanelProps { clipId: string; }

export function ExportPanel({ clipId }: ExportPanelProps) {
  const clip = useAppStore((s) => s.clips.find((c) => c.id === clipId));
  const setClipStatus = useAppStore((s) => s.setClipStatus);
  const setClipProcessedBlob = useAppStore((s) => s.setClipProcessedBlob);
  const setProcessingState = useAppStore((s) => s.setProcessingState);
  const processingState = useAppStore((s) => s.processingState);

  if (!clip) return null;

  const speedStart = clip.speedRamps[0]?.speed ?? RAMP_START;
  const speedMid = clip.speedRamps[Math.floor(clip.speedRamps.length / 2)]?.speed ?? RAMP_MID;
  const speedEnd = clip.speedRamps[clip.speedRamps.length - 1]?.speed ?? RAMP_END;
  const trimDuration = clip.trimDuration;

  // Accurate output duration using the integral formula
  function computeRampDuration(s0: number, s1: number, D: number): number {
    const deltaS = s1 - s0;
    if (Math.abs(deltaS) < 0.001) return D / s0;
    return (D / deltaS) * Math.log(1 + deltaS / s0);
  }
  const forwardDur = computeRampDuration(speedStart, speedMid, trimDuration / 2);
  const reversedDur = computeRampDuration(speedMid, speedEnd, trimDuration / 2);
  const estimatedDuration = forwardDur + reversedDur;

  const handleProcess = async () => {
    if (!clip.originalFile) {
      setClipStatus(clipId, 'error', 'Original file not available. Please re-upload the video.');
      return;
    }

    try {
      setClipStatus(clipId, 'processing');
      setProcessingState({ isProcessing: true, progress: 0, currentClipId: clipId, message: 'Processing smooth reverse speed ramp...' });

      const progressInterval = setInterval(() => {
        setProcessingState({ progress: Math.min((useAppStore.getState().processingState.progress || 0) + Math.random() * 8, 90) });
      }, 500);

      // Send original file + trimDuration to /api/speedramp
      const formData = new FormData();
      formData.append('file', clip.originalFile);
      formData.append('trimDuration', String(clip.trimDuration));

      const response = await fetch('/api/speedramp', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        let errorMsg = 'Failed to process video';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch {
          // Response might not be JSON if it's an error
        }
        throw new Error(errorMsg);
      }

      // Receive the processed video as a Blob
      const blob = await response.blob();
      setClipProcessedBlob(clipId, blob);
      setClipStatus(clipId, 'done');
      setProcessingState({ isProcessing: false, progress: 100, currentClipId: null, message: 'Complete!' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      setClipStatus(clipId, 'error', message);
      setProcessingState({ isProcessing: false, progress: 0, currentClipId: null, message: '' });
    }
  };

  const handleDownload = () => {
    if (!clip.processedBlob) return;
    const url = URL.createObjectURL(clip.processedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speedramp_${clip.originalName.replace(/\.[^/.]+$/, '')}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearResult = () => {
    setClipProcessedBlob(clipId, undefined as any);
    setClipStatus(clipId, 'ready');
  };

  const isProcessing = processingState.isProcessing && processingState.currentClipId === clipId;

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-medium text-white/70">Export</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
        <div className="flex items-center gap-2">
          <Combine className="w-3.5 h-3.5 text-white/40" />
          <div>
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Type</p>
            <p className="text-xs font-medium bg-gradient-to-r from-orange-400/70 to-cyan-400/70 bg-clip-text text-transparent">Reverse Speed Ramp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-white/40" />
          <div>
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Speed Ramp</p>
            <p className="text-xs text-white/60">{speedStart}x → {speedMid}x → {speedEnd}x</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Scissors className="w-3.5 h-3.5 text-orange-400/60" />
          <div>
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Trim</p>
            <p className="text-xs text-white/60">{trimDuration.toFixed(2)}s of original</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-cyan-400/60" />
          <div>
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Est. Duration</p>
            <p className="text-xs text-white/60">~{formatDuration(estimatedDuration)}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleProcess} disabled={isProcessing}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
            isProcessing ? 'bg-orange-500/10 text-orange-400/60 cursor-not-allowed'
              : 'bg-gradient-to-r from-orange-500 to-cyan-500 text-white hover:from-orange-400 hover:to-cyan-400 shadow-lg shadow-orange-500/20'
          }`}>
          {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Film className="w-4 h-4" /> Process V-Ramp</>}
        </button>
        {clip.processedBlob && (
          <>
            <button onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all">
              <Download className="w-4 h-4" /> Download
            </button>
            <button onClick={handleClearResult} className="px-3 py-2.5 rounded-xl text-xs text-white/20 hover:text-white/40 hover:bg-white/5 transition-all">Clear</button>
          </>
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

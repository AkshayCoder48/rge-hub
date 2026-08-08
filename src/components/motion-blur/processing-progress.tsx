'use client';

import React from 'react';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import type { ProcessingProgress } from '@/lib/video';

interface ProcessingProgressProps {
  progress: ProcessingProgress | null;
  isProcessing: boolean;
  onCancel: () => void;
}

const STAGE_LABELS: Record<ProcessingProgress['stage'], string> = {
  demuxing: 'Demuxing…',
  decoding: 'Decoding…',
  blurring: 'Applying Motion Blur…',
  encoding: 'Encoding…',
  muxing: 'Finalizing…',
  done: 'Complete!',
};

const STAGE_ICONS: Record<ProcessingProgress['stage'], string> = {
  demuxing: '📦',
  decoding: '🔓',
  blurring: '🎬',
  encoding: '🔒',
  muxing: '📦',
  done: '✅',
};

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function ProcessingProgressBar({ progress, isProcessing, onCancel }: ProcessingProgressProps) {
  const stage = progress?.stage ?? 'demuxing';
  const percent = progress?.percent ?? 0;
  const framesProcessed = progress?.framesProcessed ?? 0;
  const totalFrames = progress?.totalFrames ?? 0;
  const elapsed = progress?.elapsed ?? 0;
  const estimatedRemaining = progress?.estimatedRemaining ?? 0;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-6 space-y-5">
        {/* Stage header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/10 to-cyan-500/10 flex items-center justify-center">
              {isProcessing ? (
                <Loader2 className="w-4.5 h-4.5 text-orange-400 animate-spin" />
              ) : (
                <span className="text-sm">{STAGE_ICONS[stage]}</span>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-white/80">
                {STAGE_LABELS[stage]}
              </h3>
              {isProcessing && (
                <p className="text-xs text-white/30 mt-0.5">
                  {percent.toFixed(1)}% complete
                </p>
              )}
            </div>
          </div>

          {/* Cancel button */}
          {isProcessing && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/70 hover:bg-white/10 hover:border-white/20 transition-all"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, percent))}%`,
                background: 'linear-gradient(90deg, #f97316, #22d3ee)',
              }}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-xs font-mono text-white/30">{percent.toFixed(1)}%</span>
            {totalFrames > 0 && (
              <span className="text-xs font-mono text-white/30">
                Frame {framesProcessed} / {totalFrames}
              </span>
            )}
          </div>
        </div>

        {/* Timing info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Elapsed</p>
            <p className="text-sm font-medium text-white/70 mt-0.5 font-mono">
              {formatTime(elapsed)}
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Remaining</p>
            <p className="text-sm font-medium text-white/70 mt-0.5 font-mono">
              {estimatedRemaining > 0 && isProcessing ? `~${formatTime(estimatedRemaining)}` : '—'}
            </p>
          </div>
        </div>

        {/* Warning */}
        {isProcessing && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/5 border border-amber-500/15 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
            <p className="text-xs text-amber-400/60">Please keep this tab open.</p>
          </div>
        )}
      </div>
    </div>
  );
}

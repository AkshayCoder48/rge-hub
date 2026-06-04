'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';
import { Loader2, CheckCircle2, AlertCircle, Cpu } from 'lucide-react';

export function ProcessingStatus() {
  const processingState = useAppStore((s) => s.processingState);
  const clips = useAppStore((s) => s.clips);

  const processingClips = clips.filter((c) => c.status === 'processing');
  const doneClips = clips.filter((c) => c.status === 'done');
  const errorClips = clips.filter((c) => c.status === 'error');

  if (!processingState.isProcessing && processingClips.length === 0 && doneClips.length === 0 && errorClips.length === 0) {
    return (
      <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/40">Ready to process</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-4 space-y-3">
      {processingState.isProcessing && (
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-orange-400 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 font-medium">{processingState.message || 'Processing...'}</p>
            <div className="w-full h-1.5 rounded-full bg-white/5 mt-1.5 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${processingState.progress}%`, background: 'linear-gradient(90deg, #f97316, #22d3ee)',
              }} />
            </div>
          </div>
          <span className="text-xs text-orange-400/80 font-mono shrink-0">{Math.round(processingState.progress)}%</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        {processingClips.length > 0 && <div className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 text-orange-400 animate-spin" /><span className="text-[10px] text-orange-400/60">{processingClips.length} active</span></div>}
        {doneClips.length > 0 && <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-cyan-400" /><span className="text-[10px] text-cyan-400/60">{doneClips.length} done</span></div>}
        {errorClips.length > 0 && <div className="flex items-center gap-1.5"><AlertCircle className="w-3 h-3 text-red-400" /><span className="text-[10px] text-red-400/60">{errorClips.length} error</span></div>}
      </div>
    </div>
  );
}

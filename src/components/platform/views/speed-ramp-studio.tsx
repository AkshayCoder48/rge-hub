'use client';

import React from 'react';
import { SpeedRampApp } from '@/components/speed-ramp-app';
import { Zap, Cpu } from 'lucide-react';

export function SpeedRampStudio({ onPublishClip }: { onPublishClip: (file: File) => void }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <h1 className="font-serif-display text-2xl lg:text-3xl text-white leading-tight">
                Speed Ramp Studio
              </h1>
              <p className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 mt-1">
                Create V-shaped reverse speed ramp clips
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/5">
            <Cpu className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-400">
              Powered by FFmpeg
            </span>
          </div>
        </div>
      </section>

      {/* Tool container */}
      <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-4 lg:p-6">
        <SpeedRampApp onPublishClip={onPublishClip} />
      </div>
    </div>
  );
}

'use client';

import React from 'react';

/**
 * MetricsTicker — Full-width infinite horizontal scroll bar.
 * Height ~60px. Background #000/40, border-y white/5.
 * Pairs of labels (mono uppercase neutral-500) and values (mono white/accent).
 * Speed: 40s linear loop.
 */
interface MetricItem {
  label: string;
  value: string;
  accent?: 'violet' | 'cyan' | 'emerald' | 'white';
}

const METRICS: MetricItem[] = [
  { label: 'Engine', value: 'FFmpeg 6.0', accent: 'violet' },
  { label: 'Ramp Mode', value: 'V-Shape', accent: 'cyan' },
  { label: 'Speed Range', value: '4x → 0.6x', accent: 'white' },
  { label: 'Avg Latency', value: '271ms', accent: 'emerald' },
  { label: 'Codec', value: 'H.264 / VP9', accent: 'violet' },
  { label: 'Max Clips', value: '∞ Batch', accent: 'cyan' },
  { label: 'Trim Window', value: '10s Auto', accent: 'white' },
  { label: 'Container', value: 'MP4 / WebM', accent: 'emerald' },
  { label: 'CRF Default', value: '23', accent: 'violet' },
  { label: 'Preset', value: 'Ultrafast', accent: 'cyan' },
];

const accentMap = {
  violet: 'text-violet-400',
  cyan: 'text-cyan-400',
  emerald: 'text-emerald-400',
  white: 'text-white',
};

export function MetricsTicker() {
  // Duplicate the list for seamless infinite scroll
  const items = [...METRICS, ...METRICS];

  return (
    <div className="relative w-full overflow-hidden border-y border-white/5 bg-black/40 py-3">
      <div className="flex w-max animate-ticker">
        {items.map((m, i) => (
          <div key={i} className="flex items-center gap-3 px-8 shrink-0">
            <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500">
              {m.label}
            </span>
            <span className={`text-sm font-mono-display font-medium ${accentMap[m.accent ?? 'white']}`}>
              {m.value}
            </span>
            <span className="text-neutral-700 ml-4">/</span>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';

type RampPreset = 'cinematic' | 'action' | 'smooth' | 'hyper' | 'custom';

interface PresetConfig {
  name: string;
  key: RampPreset;
  min: number;
  max: number;
  description: string;
  color: string;
  colorClass: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
  glowClass: string;
  dotClass: string;
}

const presets: PresetConfig[] = [
  {
    name: 'Cinematic',
    key: 'cinematic',
    min: 0.3,
    max: 2.5,
    description: 'Smooth, dramatic speed transitions',
    color: 'amber',
    colorClass: 'from-amber-500 to-amber-600',
    borderClass: 'border-amber-500/50',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    glowClass: 'shadow-amber-500/20',
    dotClass: 'bg-amber-500',
  },
  {
    name: 'Action',
    key: 'action',
    min: 0.5,
    max: 6.0,
    description: 'Fast, punchy speed ramps',
    color: 'red',
    colorClass: 'from-red-500 to-red-600',
    borderClass: 'border-red-500/50',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    glowClass: 'shadow-red-500/20',
    dotClass: 'bg-red-500',
  },
  {
    name: 'Smooth',
    key: 'smooth',
    min: 0.8,
    max: 2.0,
    description: 'Gentle, flowing speed changes',
    color: 'emerald',
    colorClass: 'from-emerald-500 to-emerald-600',
    borderClass: 'border-emerald-500/50',
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-400',
    glowClass: 'shadow-emerald-500/20',
    dotClass: 'bg-emerald-500',
  },
  {
    name: 'Hyper',
    key: 'hyper',
    min: 0.3,
    max: 8.0,
    description: 'Extreme speed contrast',
    color: 'violet',
    colorClass: 'from-violet-500 to-violet-600',
    borderClass: 'border-violet-500/50',
    bgClass: 'bg-violet-500/10',
    textClass: 'text-violet-400',
    glowClass: 'shadow-violet-500/20',
    dotClass: 'bg-violet-500',
  },
  {
    name: 'Custom',
    key: 'custom',
    min: 0.6,
    max: 4.0,
    description: 'Your custom slider values',
    color: 'zinc',
    colorClass: 'from-zinc-400 to-zinc-500',
    borderClass: 'border-zinc-500/50',
    bgClass: 'bg-zinc-500/10',
    textClass: 'text-zinc-400',
    glowClass: 'shadow-zinc-500/20',
    dotClass: 'bg-zinc-400',
  },
];

function SpeedCurvePreview({ preset, isActive }: { preset: PresetConfig; isActive: boolean }) {
  const { rampMinSpeed, rampMaxSpeed } = useAppStore();
  const minSpeed = preset.key === 'custom' ? rampMinSpeed : preset.min;
  const maxSpeed = preset.key === 'custom' ? rampMaxSpeed : preset.max;

  // Create a simple speed curve SVG path
  const width = 48;
  const height = 24;
  const padding = 4;
  const graphW = width - padding * 2;
  const graphH = height - padding * 2;

  // Normalize speeds
  const maxVal = Math.max(maxSpeed, 8.0);
  const startY = padding + graphH - (maxSpeed / maxVal) * graphH;
  const endY = padding + graphH - (minSpeed / maxVal) * graphH;

  // Simple bezier curve
  const midY = (startY + endY) / 2;
  const pathD = `M ${padding} ${startY} C ${padding + graphW * 0.3} ${startY}, ${padding + graphW * 0.7} ${endY}, ${padding + graphW} ${endY}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0 group/curve">
      <defs>
        <linearGradient id={`curve-grad-${preset.key}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity={isActive ? 1 : 0.5} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={isActive ? 0.6 : 0.3} />
        </linearGradient>
      </defs>
      <path
        d={pathD}
        fill="none"
        stroke={`url(#curve-grad-${preset.key})`}
        strokeWidth={isActive ? 2 : 1.5}
        strokeLinecap="round"
        className={`transition-all duration-300 group-hover/curve:[stroke-dashoffset:0] ${isActive ? preset.textClass : 'text-zinc-600'}`}
        strokeDasharray={isActive ? 'none' : '4 2'}
        style={isActive ? {} : { strokeDashoffset: 0 }}
      />
      {isActive && (
        <>
          <circle cx={padding} cy={startY} r={2} className={preset.dotClass} />
          <circle cx={padding + graphW} cy={endY} r={2} className={preset.dotClass} />
        </>
      )}
    </svg>
  );
}

export function PresetSelector() {
  const { rampPreset, setRampPreset, rampMinSpeed, rampMaxSpeed } = useAppStore();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Speed Ramp Preset
        </h3>
        <span className="text-[10px] text-zinc-600">
          {rampPreset === 'custom' ? `${rampMinSpeed.toFixed(1)}x → ${rampMaxSpeed.toFixed(1)}x` : presets.find(p => p.key === rampPreset)?.description}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
        {presets.map((preset) => {
          const isActive = rampPreset === preset.key;
          const displayMin = preset.key === 'custom' ? rampMinSpeed : preset.min;
          const displayMax = preset.key === 'custom' ? rampMaxSpeed : preset.max;

          return (
            <button
              key={preset.key}
              type="button"
              className={`
                flex-shrink-0 rounded-xl border px-4 py-3 transition-all duration-200 no-select
                min-w-[140px] text-left cursor-pointer relative overflow-hidden
                ${isActive
                  ? `${preset.bgClass} ${preset.borderClass} shadow-lg ${preset.glowClass} ring-1 ring-current/10 backdrop-blur-sm`
                  : 'bg-zinc-900/60 backdrop-blur-sm border-zinc-800/60 hover:bg-zinc-800/50 hover:border-zinc-700'
                }
              `}
              onClick={() => setRampPreset(preset.key)}
            >
              {/* Gradient top border for active preset */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-orange-500/60 via-transparent to-cyan-500/60" />
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isActive ? preset.dotClass : 'bg-zinc-600'} transition-colors duration-200`} />
                  <span className={`text-sm font-semibold transition-colors duration-200 ${isActive ? preset.textClass : 'text-zinc-300'}`}>
                    {preset.name}
                  </span>
                </div>
                <SpeedCurvePreview preset={preset} isActive={isActive} />
              </div>
              <div className={`text-[11px] font-mono mt-1.5 transition-colors duration-200 ${isActive ? 'text-zinc-300' : 'text-zinc-500'}`}>
                {displayMin.toFixed(1)}x → {displayMax.toFixed(1)}x
              </div>
              <div className={`text-[10px] mt-0.5 transition-colors duration-200 ${isActive ? 'text-zinc-400' : 'text-zinc-600'} truncate`}>
                {preset.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

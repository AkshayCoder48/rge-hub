'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Info, ArrowRight, RotateCcw, Clock, Zap, ShieldCheck, Rocket, Layers, Clapperboard, Waves, Flame, SlidersHorizontal, TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import { calculateOutputDuration } from '@/lib/speed-ramp';

const PRESET_CONFIG: Record<string, { color: string; bgClass: string; borderClass: string; textClass: string; shadowClass: string; icon: React.ReactNode }> = {
  cinematic: {
    color: '#fbbf24',
    bgClass: 'bg-amber-400/10',
    borderClass: 'border-amber-400/20',
    textClass: 'text-amber-400',
    shadowClass: 'shadow-amber-400/30',
    icon: <Clapperboard className="w-4 h-4" />,
  },
  action: {
    color: '#f87171',
    bgClass: 'bg-red-400/10',
    borderClass: 'border-red-400/20',
    textClass: 'text-red-400',
    shadowClass: 'shadow-red-400/30',
    icon: <Zap className="w-4 h-4" />,
  },
  smooth: {
    color: '#34d399',
    bgClass: 'bg-emerald-400/10',
    borderClass: 'border-emerald-400/20',
    textClass: 'text-emerald-400',
    shadowClass: 'shadow-emerald-400/30',
    icon: <Waves className="w-4 h-4" />,
  },
  hyper: {
    color: '#a78bfa',
    bgClass: 'bg-violet-400/10',
    borderClass: 'border-violet-400/20',
    textClass: 'text-violet-400',
    shadowClass: 'shadow-violet-400/30',
    icon: <Flame className="w-4 h-4" />,
  },
  custom: {
    color: '#a1a1aa',
    bgClass: 'bg-zinc-400/10',
    borderClass: 'border-zinc-400/20',
    textClass: 'text-zinc-400',
    shadowClass: 'shadow-zinc-400/30',
    icon: <SlidersHorizontal className="w-4 h-4" />,
  },
};

const PRESET_LABELS: Record<string, string> = {
  cinematic: 'Cinematic',
  action: 'Action',
  smooth: 'Smooth',
  hyper: 'Hyper',
  custom: 'Custom',
};

/** Mini speed curve SVG preview based on preset */
function SpeedCurveMiniPreview({ minSpeed, maxSpeed, color }: { minSpeed: number; maxSpeed: number; color: string }) {
  const width = 64;
  const height = 24;
  const padding = 2;

  // Forward curve: maxSpeed → minSpeed (left half)
  // Reverse curve: minSpeed → maxSpeed (right half)
  const fwdPoints: string[] = [];
  const revPoints: string[] = [];
  const scaleMax = maxSpeed + 0.5;

  for (let i = 0; i <= 20; i++) {
    const prog = i / 20;
    const x = padding + prog * (width / 2 - padding);
    // Forward
    const fwdSpeed = maxSpeed + (minSpeed - maxSpeed) * prog;
    const fwdY = padding + (1 - fwdSpeed / scaleMax) * (height - 2 * padding);
    fwdPoints.push(`${x.toFixed(1)},${fwdY.toFixed(1)}`);
    // Reverse
    const revSpeed = minSpeed + (maxSpeed - minSpeed) * prog;
    const revX = width / 2 + prog * (width / 2 - padding);
    const revY = padding + (1 - revSpeed / scaleMax) * (height - 2 * padding);
    revPoints.push(`${revX.toFixed(1)},${revY.toFixed(1)}`);
  }

  return (
    <svg width={width} height={height} className="flex-shrink-0 opacity-70">
      <polyline
        points={fwdPoints.join(' ')}
        fill="none"
        stroke="#f97316"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={revPoints.join(' ')}
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 1x reference line */}
      {(() => {
        const oneY = padding + (1 - 1 / scaleMax) * (height - 2 * padding);
        return (
          <line
            x1={padding}
            y1={oneY}
            x2={width - padding}
            y2={oneY}
            stroke={color}
            strokeWidth="0.5"
            strokeDasharray="2,2"
            opacity="0.4"
          />
        );
      })()}
    </svg>
  );
}

/** Animated counter that counts up from 0 to target */
function AnimatedCounter({ target, duration = 800, decimals = 2 }: { target: number; duration?: number; decimals?: number }) {
  const [value, setValue] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(eased * target);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return <span className="tabular-nums">{value.toFixed(decimals)}s</span>;
}

export function RampInfo() {
  const { clips, selectedClipId, processingPreset, rampMinSpeed, rampMaxSpeed, rampPreset } = useAppStore();
  const selectedClip = clips.find((c) => c.id === selectedClipId);

  const presetCfg = PRESET_CONFIG[rampPreset] || PRESET_CONFIG.custom;
  const isNamedPreset = rampPreset !== 'custom';

  // Track if just completed (for animated counter) — use key-based animation
  // Derive completion key from the clip's completed state to trigger count-up
  const completionKey = useMemo(() => {
    if (selectedClip?.status === 'completed' && selectedClip.processingTime != null) {
      return `completed-${selectedClip.processingTime}`;
    }
    return 'not-completed';
  }, [selectedClip?.status, selectedClip?.processingTime]);

  const estimatedDuration = useMemo(() => {
    if (!selectedClip) return null;
    const trimDuration = selectedClip.trimEnd - selectedClip.trimStart;
    if (trimDuration <= 0) return null;

    const forwardDuration = calculateOutputDuration(rampMaxSpeed, rampMinSpeed, trimDuration);
    const reverseDuration = calculateOutputDuration(rampMinSpeed, rampMaxSpeed, trimDuration);

    return {
      forward: forwardDuration,
      reverse: reverseDuration,
      total: forwardDuration + reverseDuration,
    };
  }, [selectedClip, rampMinSpeed, rampMaxSpeed]);

  if (!selectedClip) return null;

  const trimDuration = selectedClip.trimEnd - selectedClip.trimStart;
  const isCompleted = selectedClip.status === 'completed';

  // Determine forward/reverse card colors based on preset
  const fwdBgClass = isNamedPreset ? presetCfg.bgClass : 'bg-orange-500/5';
  const fwdBorderClass = isNamedPreset ? presetCfg.borderClass : 'border-orange-500/10';
  const fwdDotShadow = isNamedPreset ? presetCfg.shadowClass : 'shadow-orange-500/50';
  const fwdTextClass = isNamedPreset ? presetCfg.textClass : 'text-orange-400';

  const revBgClass = isNamedPreset ? presetCfg.bgClass : 'bg-cyan-400/5';
  const revBorderClass = isNamedPreset ? presetCfg.borderClass : 'border-cyan-400/10';
  const revDotShadow = isNamedPreset ? presetCfg.shadowClass : 'shadow-cyan-400/50';
  const revTextClass = isNamedPreset ? presetCfg.textClass : 'text-cyan-400';

  return (
    <Card className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg overflow-hidden">
      {/* Colored accent bar at top based on preset */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: presetCfg.color }}
      />

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg ${presetCfg.bgClass} border ${presetCfg.borderClass} flex items-center justify-center flex-shrink-0 mt-0.5`}>
            <span className={presetCfg.textClass}>
              {presetCfg.icon}
            </span>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Speed Ramp Profile
                </p>
                {/* Preset name badge */}
                <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${presetCfg.bgClass} ${presetCfg.textClass} border ${presetCfg.borderClass}`}>
                  {presetCfg.icon}
                  {PRESET_LABELS[rampPreset]}
                </span>
                {/* Mini speed curve preview */}
                <SpeedCurveMiniPreview minSpeed={rampMinSpeed} maxSpeed={rampMaxSpeed} color={presetCfg.color} />
              </div>
              <div className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded ${
                processingPreset === 'turbo'
                  ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
              }`}>
                {processingPreset === 'turbo' ? (
                  <>
                    <Rocket className="w-3 h-3" />
                    Turbo Mode
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3 h-3" />
                    Quality Mode
                  </>
                )}
              </div>
            </div>

            {/* Forward and Reverse descriptions with gradient backgrounds */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Forward ramp */}
              <div className={`relative overflow-hidden flex items-center gap-2 ${fwdBgClass} border ${fwdBorderClass} rounded-lg px-3 py-2.5`}>
                {/* Gradient accent on left */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-orange-500 to-orange-400/30 rounded-l" />
                <span className={`w-3 h-3 rounded-full flex-shrink-0 shadow-sm ${fwdDotShadow}`} style={{ backgroundColor: isNamedPreset ? presetCfg.color : '#f97316' }} />
                <div className="min-w-0 ml-1">
                  <p className={`text-xs font-medium flex items-center gap-1 ${fwdTextClass}`}>
                    Forward
                    <TrendingDown className="w-3 h-3" />
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {rampMaxSpeed}x → {rampMinSpeed}x (decelerating)
                  </p>
                </div>
              </div>

              {/* Reverse ramp */}
              <div className={`relative overflow-hidden flex items-center gap-2 ${revBgClass} border ${revBorderClass} rounded-lg px-3 py-2.5`}>
                {/* Gradient accent on left */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-cyan-500 to-cyan-400/30 rounded-l" />
                <span className={`w-3 h-3 rounded-full flex-shrink-0 shadow-sm ${revDotShadow}`} style={{ backgroundColor: isNamedPreset ? presetCfg.color : '#22d3ee' }} />
                <div className="min-w-0 ml-1">
                  <p className={`text-xs font-medium flex items-center gap-1 ${revTextClass}`}>
                    Reverse
                    <TrendingUp className="w-3 h-3" />
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {rampMinSpeed}x → {rampMaxSpeed}x (accelerating, reversed)
                  </p>
                </div>
              </div>
            </div>

            {/* Duration & Quality info */}
            {estimatedDuration && trimDuration > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/50">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    Trim: {trimDuration.toFixed(2)}s
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3" />
                    Output ≈ {estimatedDuration.total.toFixed(2)}s
                  </span>
                  <span className="text-zinc-600">
                    (Fwd: {estimatedDuration.forward.toFixed(2)}s + Rev: {estimatedDuration.reverse.toFixed(2)}s)
                  </span>
                  <span className="flex items-center gap-1.5 text-green-400/60">
                    <Zap className="w-3 h-3" />
                    {processingPreset === 'turbo' ? 'CRF 17 • Visually lossless' : 'CRF 15 • Near-lossless'}
                  </span>
                </div>

                {/* Output duration with animated counter when completed */}
                {isCompleted && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-gradient-to-r from-green-500/10 to-cyan-500/10 border-green-500/20 transition-all duration-300">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Output Duration</span>
                    <span className="text-sm font-bold text-green-400" key={completionKey}>
                      <AnimatedCounter target={estimatedDuration.total} duration={800} decimals={2} />
                    </span>
                    <span className="text-[10px] text-zinc-600 ml-1">
                      ({((estimatedDuration.total / trimDuration) * 100).toFixed(0)}% of original)
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

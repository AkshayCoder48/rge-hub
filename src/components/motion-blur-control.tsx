'use client';

import React from 'react';
import { useAppStore, DEFAULT_MOTION_BLUR } from '@/lib/store';
import type { MotionBlurSettings } from '@/lib/types';
import { Eye, EyeOff, Wind, Sparkles } from 'lucide-react';

interface MotionBlurControlProps {
  clipId: string;
  type: 'speedramp' | 'interpolation';
}

export function MotionBlurControl({ clipId, type }: MotionBlurControlProps) {
  const clips = useAppStore((s) => type === 'speedramp' ? s.clips : s.interpolationClips);
  const clip = clips.find((c) => c.id === clipId) as (typeof clips)[number] & { motionBlur?: MotionBlurSettings } | undefined;
  const setMotionBlur = useAppStore((s) =>
    type === 'speedramp' ? s.setClipMotionBlur : s.setInterpolationClipMotionBlur
  );

  if (!clip) return null;

  const motionBlur: MotionBlurSettings = clip.motionBlur ?? { ...DEFAULT_MOTION_BLUR };

  const handleToggle = () => {
    setMotionBlur(clipId, { enabled: !motionBlur.enabled });
  };

  const handleFramesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 10) {
      setMotionBlur(clipId, { frames: val });
    }
  };

  const handleModeChange = (mode: MotionBlurSettings['mode']) => {
    setMotionBlur(clipId, { mode });
  };

  return (
    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wind className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-white/70">Motion Blur</h3>
        <button
          onClick={handleToggle}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            motionBlur.enabled
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
              : 'bg-white/[0.03] text-white/30 border border-white/5 hover:text-white/50'
          }`}
        >
          {motionBlur.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {motionBlur.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {motionBlur.enabled && (
        <div className="space-y-4 animate-fade-in">
          {/* Blur intensity (frames to blend) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-white/25 uppercase tracking-wider">Intensity</span>
              <span className="text-xs font-mono text-purple-400/80">{motionBlur.frames} frame{motionBlur.frames > 1 ? 's' : ''}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={motionBlur.frames}
              onChange={handleFramesChange}
              className="w-full"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] text-white/15">Subtle</span>
              <span className="text-[9px] text-white/15">Heavy</span>
            </div>
          </div>

          {/* Blend mode */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3 h-3 text-white/25" />
              <span className="text-[10px] text-white/25 uppercase tracking-wider">Blend Mode</span>
            </div>
            <div className="flex items-center gap-2">
              {[
                { id: 'light' as const, label: 'Light', desc: '1 pass' },
                { id: 'average' as const, label: 'Average', desc: '2 passes' },
                { id: 'heavy' as const, label: 'Heavy', desc: '3 passes' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => handleModeChange(mode.id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                    motionBlur.mode === mode.id
                      ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                      : 'bg-white/[0.03] text-white/30 border border-white/5 hover:text-white/50'
                  }`}
                >
                  <span>{mode.label}</span>
                  <span className="text-[9px] opacity-50">{mode.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10">
            <p className="text-[10px] text-purple-300/40 leading-relaxed">
              Motion blur blends adjacent frames together using FFmpeg&apos;s <code className="text-purple-400/50">tblend</code> filter.
              Higher frame count = more blur trails. More passes = stronger blending effect.
            </p>
          </div>
        </div>
      )}

      {!motionBlur.enabled && (
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
          <p className="text-[10px] text-white/20 leading-relaxed">
            Enable motion blur to add smooth frame blending trails. Uses FFmpeg&apos;s temporal blend filter to simulate natural motion blur from camera shutter.
          </p>
        </div>
      )}
    </div>
  );
}

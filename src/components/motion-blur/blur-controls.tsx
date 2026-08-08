'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, Zap, Settings2, FileOutput } from 'lucide-react';
import type { MotionBlurConfig } from '@/lib/video';
import { DEFAULT_MOTION_BLUR_CONFIG } from '@/lib/video';

interface BlurControlsProps {
  onApply: (config: MotionBlurConfig) => void;
  disabled?: boolean;
}

export function BlurControls({ onApply, disabled = false }: BlurControlsProps) {
  const [blurAmount, setBlurAmount] = useState(DEFAULT_MOTION_BLUR_CONFIG.blurAmount);
  const [blurStrength, setBlurStrength] = useState(
    Math.round(DEFAULT_MOTION_BLUR_CONFIG.blurStrength * 100)
  );
  const [quality, setQuality] = useState<MotionBlurConfig['quality']>(
    DEFAULT_MOTION_BLUR_CONFIG.quality
  );
  const [outputFormat, setOutputFormat] = useState<MotionBlurConfig['outputFormat']>(
    DEFAULT_MOTION_BLUR_CONFIG.outputFormat
  );

  const handleApply = () => {
    const config: MotionBlurConfig = {
      blurAmount,
      blurStrength: blurStrength / 100,
      quality,
      outputFormat,
    };
    onApply(config);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/10 to-cyan-500/10 flex items-center justify-center">
            <SlidersHorizontal className="w-4.5 h-4.5 text-white/70" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white/80">Motion Blur Settings</h3>
            <p className="text-xs text-white/30 mt-0.5">Adjust blur intensity and output options</p>
          </div>
        </div>

        {/* Blur Amount Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-400/70" />
              <label className="text-sm font-medium text-white/70">Blur Amount</label>
            </div>
            <span className="text-sm font-mono font-medium px-2.5 py-0.5 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
              {blurAmount}
            </span>
          </div>
          <div className="relative">
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={blurAmount}
              onChange={(e) => setBlurAmount(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between mt-1.5">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className={`text-[9px] ${i + 1 === blurAmount ? 'text-orange-400' : 'text-white/15'}`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-white/25">Number of frames to blend. Higher values create longer motion trails.</p>
        </div>

        {/* Blur Strength Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400/70" />
              <label className="text-sm font-medium text-white/70">Blur Strength</label>
            </div>
            <span className="text-sm font-mono font-medium px-2.5 py-0.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              {blurStrength}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={blurStrength}
            onChange={(e) => setBlurStrength(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-white/25">
            How much the previous frames contribute. 0% = no blur, 100% = full temporal blend.
          </p>
        </div>

        {/* Quality & Format Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Quality Select */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-white/40" />
              <label className="text-sm font-medium text-white/70">Quality</label>
            </div>
            <div className="relative">
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as MotionBlurConfig['quality'])}
                className="w-full appearance-none rounded-xl bg-white/[0.03] border border-white/10 px-4 py-2.5 text-sm text-white/70 focus:border-orange-500/50 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="performance" className="bg-[#0f0f17] text-white/70">Performance</option>
                <option value="balanced" className="bg-[#0f0f17] text-white/70">Balanced</option>
                <option value="quality" className="bg-[#0f0f17] text-white/70">Quality</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Output Format Select */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileOutput className="w-4 h-4 text-white/40" />
              <label className="text-sm font-medium text-white/70">Output Format</label>
            </div>
            <div className="relative">
              <select
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as MotionBlurConfig['outputFormat'])}
                className="w-full appearance-none rounded-xl bg-white/[0.03] border border-white/10 px-4 py-2.5 text-sm text-white/70 focus:border-orange-500/50 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="mp4" className="bg-[#0f0f17] text-white/70">MP4</option>
                <option value="webm" className="bg-[#0f0f17] text-white/70">WebM</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Quality description */}
        <div className="rounded-xl bg-white/[0.02] border border-white/5 px-4 py-2.5">
          <p className="text-xs text-white/30">
            {quality === 'performance' && '⚡ Performance — Faster processing, lower bitrate. Best for quick previews.'}
            {quality === 'balanced' && '⚖️ Balanced — Good quality-to-speed ratio. Recommended for most use cases.'}
            {quality === 'quality' && '✨ Quality — Higher bitrate, slower processing. Best for final output.'}
          </p>
        </div>

        {/* Apply Button */}
        <button
          onClick={handleApply}
          disabled={disabled}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
            disabled
              ? 'bg-white/5 text-white/20 cursor-not-allowed'
              : 'bg-gradient-to-r from-orange-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-orange-500/20 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          {disabled ? 'Processing…' : 'Apply Motion Blur'}
        </button>
      </div>
    </div>
  );
}

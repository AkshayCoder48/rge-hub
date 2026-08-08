'use client';

import React, { useState } from 'react';
import { SpeedRampApp } from '@/components/speed-ramp-app';
import { MotionBlurApp } from '@/components/motion-blur/motion-blur-app';
import { Combine, Sparkles, Zap, TrendingDown, TrendingUp, Cpu, ShieldCheck, Film, Server } from 'lucide-react';

type ActiveTab = 'speedramp' | 'motionblur';

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('motionblur');

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0f] relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
      </div>
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.06) 0%, transparent 70%)', filter: 'blur(40px)' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-orange-400 via-white/90 to-cyan-400 bg-clip-text text-transparent">
                  VideoFX Studio
                </h1>
                <p className="text-[10px] text-white/25 tracking-wider uppercase">
                  Speed ramp &amp; motion blur
                </p>
              </div>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/5">
              <button
                onClick={() => setActiveTab('speedramp')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'speedramp'
                    ? 'bg-gradient-to-r from-orange-500/20 to-orange-500/10 text-orange-400 border border-orange-500/20'
                    : 'text-white/30 hover:text-white/50 border border-transparent'
                }`}
              >
                <Combine className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Speed Ramp</span>
              </button>
              <button
                onClick={() => setActiveTab('motionblur')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'motionblur'
                    ? 'bg-gradient-to-r from-cyan-500/20 to-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-white/30 hover:text-white/50 border border-transparent'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Motion Blur</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Tab-specific hero */}
          {activeTab === 'motionblur' && (
            <div className="text-center space-y-4 max-w-lg mx-auto mb-8 animate-fade-in">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500/10 to-orange-500/10 border border-cyan-500/20 text-xs text-cyan-400/80 mb-2">
                <Sparkles className="w-3 h-3" /> Motion Blur
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white/90 leading-tight">
                Add <span className="bg-gradient-to-r from-cyan-400 to-orange-400 bg-clip-text text-transparent">motion blur</span> to your videos
              </h2>
              <p className="text-sm text-white/30 leading-relaxed max-w-md mx-auto">
                Blend consecutive frames to create realistic motion blur trails. All processing happens locally in your browser — your video never leaves your device.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-6 mt-2">
                {[
                  { icon: <Film className="w-4 h-4" />, text: 'Temporal Frame Blend' },
                  { icon: <Cpu className="w-4 h-4" />, text: 'WebCodecs Powered' },
                  { icon: <ShieldCheck className="w-4 h-4" />, text: '100% Private' },
                ].map((f) => (
                  <div key={f.text} className="flex items-center gap-2 text-xs text-white/20">
                    <span className="text-cyan-400/40">{f.icon}</span>{f.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'speedramp' && (
            <div className="text-center space-y-4 max-w-lg mx-auto mb-8 animate-fade-in">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-orange-500/10 to-cyan-500/10 border border-orange-500/20 text-xs text-orange-400/80 mb-2">
                <Combine className="w-3 h-3" /> Speed Ramp
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white/90 leading-tight">
                Create <span className="bg-gradient-to-r from-orange-400 to-cyan-400 bg-clip-text text-transparent">V-ramp</span> speed effects
              </h2>
              <p className="text-sm text-white/30 leading-relaxed max-w-md mx-auto">
                Upload a video and get a reverse speed ramp. Server-side FFmpeg processing with full parameter control.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-6 mt-2">
                {[
                  { icon: <TrendingDown className="w-4 h-4" />, text: 'V-Shaped Ramp' },
                  { icon: <Server className="w-4 h-4" />, text: 'FFmpeg Powered' },
                  { icon: <Film className="w-4 h-4" />, text: 'Batch Processing' },
                ].map((f) => (
                  <div key={f.text} className="flex items-center gap-2 text-xs text-white/20">
                    <span className="text-orange-400/40">{f.icon}</span>{f.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Feature */}
          <div className="animate-fade-in">
            {activeTab === 'speedramp' && <SpeedRampApp />}
            {activeTab === 'motionblur' && <MotionBlurApp />}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-center gap-2 text-xs text-white/15">
            <ShieldCheck className="w-3 h-3" />
            <span>Motion blur processes locally in your browser. Speed ramp uses server-side FFmpeg.</span>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        @keyframes float-slow { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(20px, -20px); } }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s ease-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
        input[type='range'] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; height: 4px; }
        input[type='range']::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.06); }
        input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #f97316; margin-top: -5px; box-shadow: 0 0 8px rgba(249,115,22,0.3); }
        input[type='range']::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.06); }
        input[type='range']::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #f97316; border: none; }
      `}</style>
    </div>
  );
}

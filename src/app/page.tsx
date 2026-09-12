'use client';

import React from 'react';
import { SpeedRampApp } from '@/components/speed-ramp-app';
import { Zap, Server } from 'lucide-react';

export default function Home() {
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
                  Speed ramp
                </p>
              </div>
            </div>

            {/* Capability badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5">
              <Server className="w-3.5 h-3.5 text-orange-400/60" />
              <span className="text-xs text-white/40 font-medium">FFmpeg Powered</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <SpeedRampApp />
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-center gap-2 text-xs text-white/15">
            <Server className="w-3 h-3" />
            <span>Speed ramp uses server-side FFmpeg processing.</span>
          </div>
        </div>
      </footer>

      <style jsx global>{`
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

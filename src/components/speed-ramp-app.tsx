'use client';

import React from 'react';
import { useAppStore, RAMP_START, RAMP_MID, RAMP_END, MAX_AUTO_TRIM_DURATION } from '@/lib/store';
import { UploadZone } from '@/components/upload-zone';
import { ClipList } from '@/components/clip-list';
import { ProcessingStatus } from '@/components/processing-status';
import { ExportPanel } from '@/components/export-panel';
import { VideoPreview } from '@/components/video-preview';
import { TrimDurationControl } from '@/components/trim-duration-control';
import { ProcessAll } from '@/components/process-all';
import { Zap, Film, Sparkles, MousePointerClick, TrendingDown, TrendingUp, Combine } from 'lucide-react';

export function SpeedRampApp() {
  const clips = useAppStore((s) => s.clips);
  const selectedClipId = useAppStore((s) => s.selectedClipId);
  const selectedClip = useAppStore((s) => s.clips.find((c) => c.id === s.selectedClipId));

  const speedStart = selectedClip?.speedRamps[0]?.speed ?? RAMP_START;
  const speedMid = selectedClip?.speedRamps[Math.floor((selectedClip?.speedRamps.length ?? 0) / 2)]?.speed ?? RAMP_MID;
  const speedEnd = selectedClip?.speedRamps[selectedClip?.speedRamps.length - 1]?.speed ?? RAMP_END;

  return (
    <div className="space-y-6">
      {clips.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-8 animate-fade-up">
          {/* Inline hero badges */}
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-light">
              <TrendingDown className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-mono-display text-neutral-300">Forward {RAMP_START}x → {RAMP_MID}x</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-light">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-mono-display text-neutral-300">Reversed {RAMP_MID}x → {RAMP_END}x</span>
            </div>
          </div>
          <UploadZone />
          <div className="flex flex-wrap items-center justify-center gap-6 mt-2">
            {[
              { icon: <Combine className="w-4 h-4" />, text: 'Single Combined Clip' },
              { icon: <Film className="w-4 h-4" />, text: 'V-Shaped Speed Ramp' },
              { icon: <Sparkles className="w-4 h-4" />, text: 'FFmpeg Powered' },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-2 text-xs text-neutral-500">
                <span className="text-violet-400/60">{f.icon}</span>{f.text}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              <ClipList />
              <ProcessAll />
            </div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            {selectedClipId && selectedClip ? (
              <>
                {/* Clip header */}
                <div className="flex items-center gap-3 px-1">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center glass-light">
                    <Combine className="w-4 h-4 text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-medium text-white truncate">{selectedClip.originalName}</h2>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs font-mono-display font-medium bg-gradient-to-r from-violet-400/80 to-cyan-400/80 bg-clip-text text-transparent">
                        {speedStart}x → {speedMid}x → {speedEnd}x
                      </span>
                      <span className="text-[10px] text-neutral-500 font-mono-display">{selectedClip.width}×{selectedClip.height} · {selectedClip.fps}fps · {selectedClip.codec}</span>
                    </div>
                  </div>
                  <div className="shrink-0 px-3 py-1 rounded-full text-[10px] font-mono-display uppercase tracking-[0.15em] glass-light text-violet-400">
                    V-Ramp
                  </div>
                </div>

                {/* V-shaped speed ramp visual */}
                <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="w-4 h-4 text-violet-400" />
                    <h3 className="font-serif-display text-lg text-white">Reverse Speed Ramp</h3>
                    <span className="ml-auto text-xs font-mono-display font-medium px-2.5 py-0.5 rounded-full bg-white/5 text-neutral-400">
                      {speedStart}x → {speedMid}x → {speedEnd}x
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono-display uppercase tracking-wider text-violet-400/70">
                      <TrendingDown className="w-3 h-3" />
                      <span>Forward: {speedStart}x→{speedMid}x</span>
                    </div>
                    <div className="w-px h-3 bg-white/10" />
                    <div className="flex items-center gap-1.5 text-[10px] font-mono-display uppercase tracking-wider text-cyan-400/70">
                      <TrendingUp className="w-3 h-3" />
                      <span>Reversed: {speedMid}x→{speedEnd}x</span>
                    </div>
                  </div>
                  <div className="w-full h-24 relative">
                    <svg viewBox="0 0 220 70" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                      <line x1="20" y1="5" x2="20" y2="55" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                      <line x1="120" y1="5" x2="120" y2="55" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                      <line x1="200" y1="5" x2="200" y2="55" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                      <line x1="20" y1="30" x2="200" y2="30" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 4" />
                      <text x="16" y="12" textAnchor="end" className="fill-neutral-600" fontSize="7" fontFamily="monospace">4x</text>
                      <text x="16" y="33" textAnchor="end" className="fill-neutral-700" fontSize="7" fontFamily="monospace">1x</text>
                      <text x="16" y="55" textAnchor="end" className="fill-neutral-600" fontSize="7" fontFamily="monospace">0.6x</text>
                      <text x="20" y="67" textAnchor="middle" className="fill-neutral-700" fontSize="6" fontFamily="monospace">0s</text>
                      <text x="120" y="67" textAnchor="middle" className="fill-neutral-700" fontSize="6" fontFamily="monospace">mid</text>
                      <text x="200" y="67" textAnchor="middle" className="fill-neutral-700" fontSize="6" fontFamily="monospace">end</text>
                      <defs>
                        <linearGradient id="rampGradForward" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#8b5cf6" />
                          <stop offset="100%" stopColor="#06b6d4" />
                        </linearGradient>
                        <linearGradient id="rampGradReverse" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#06b6d4" />
                          <stop offset="100%" stopColor="#8b5cf6" />
                        </linearGradient>
                        <linearGradient id="rampFillForward" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="rampFillReverse" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {(() => {
                        const yMax = 5, yMin = 55, yRange = yMax - yMin;
                        const yAt4 = yMin + ((4.0 - 4.0) / (4.0 - 0.6)) * yRange;
                        const yAt06 = yMin + ((4.0 - 0.6) / (4.0 - 0.6)) * yRange;
                        const x0 = 20, xMid = 120, xEnd = 200;
                        return (
                          <>
                            <polygon points={`${x0},${yAt4} ${xMid},${yAt06} ${xMid},${yMin} ${x0},${yMin}`} fill="url(#rampFillForward)" />
                            <polygon points={`${xMid},${yAt06} ${xEnd},${yAt4} ${xEnd},${yMin} ${xMid},${yMin}`} fill="url(#rampFillReverse)" />
                            <line x1={x0} y1={yAt4} x2={xMid} y2={yAt06} stroke="url(#rampGradForward)" strokeWidth="2.5" strokeLinecap="round" />
                            <line x1={xMid} y1={yAt06} x2={xEnd} y2={yAt4} stroke="url(#rampGradReverse)" strokeWidth="2.5" strokeLinecap="round" />
                            <circle cx={x0} cy={yAt4} r="4" fill="#030303" stroke="#8b5cf6" strokeWidth="2" />
                            <text x={x0} y={yAt4 - 8} textAnchor="middle" className="fill-violet-400" fontSize="8" fontWeight="600" fontFamily="monospace">4x</text>
                            <circle cx={xMid} cy={yAt06} r="4" fill="#030303" stroke="#06b6d4" strokeWidth="2" />
                            <text x={xMid} y={yAt06 + 14} textAnchor="middle" className="fill-cyan-400" fontSize="8" fontWeight="600" fontFamily="monospace">0.6x</text>
                            <circle cx={xEnd} cy={yAt4} r="4" fill="#030303" stroke="#8b5cf6" strokeWidth="2" />
                            <text x={xEnd} y={yAt4 - 8} textAnchor="middle" className="fill-violet-400" fontSize="8" fontWeight="600" fontFamily="monospace">4x</text>
                            <text x={70} y={44} textAnchor="middle" className="fill-violet-400/40" fontSize="6" fontWeight="600" fontFamily="monospace">FORWARD</text>
                            <text x={160} y={44} textAnchor="middle" className="fill-cyan-400/40" fontSize="6" fontWeight="600" fontFamily="monospace">REVERSED</text>
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                </div>

                <VideoPreview clipId={selectedClipId} />
                <TrimDurationControl clipId={selectedClipId} />
                <ProcessingStatus />
                <ExportPanel clipId={selectedClipId} />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 rounded-3xl border border-white/5 bg-white/[0.02]">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.03] flex items-center justify-center">
                  <MousePointerClick className="w-6 h-6 text-neutral-600" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-neutral-400">Select a clip to edit</p>
                  <p className="text-xs text-neutral-600 mt-1">Choose a clip from the list to start editing</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

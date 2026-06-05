'use client';

import React from 'react';
import { useAppStore, RAMP_START, RAMP_MID, RAMP_END, DEFAULT_TRIM_DURATION } from '@/lib/store';
import { UploadZone } from '@/components/upload-zone';
import { ClipList } from '@/components/clip-list';
import { ProcessingStatus } from '@/components/processing-status';
import { ExportPanel } from '@/components/export-panel';
import { VideoPreview } from '@/components/video-preview';
import { TrimDurationControl } from '@/components/trim-duration-control';
import { ProcessAll } from '@/components/process-all';
import { Zap, Film, Sparkles, MousePointerClick, TrendingDown, TrendingUp, Combine } from 'lucide-react';

export default function Home() {
  const clips = useAppStore((s) => s.clips);
  const selectedClipId = useAppStore((s) => s.selectedClipId);
  const selectedClip = useAppStore((s) => s.clips.find((c) => c.id === s.selectedClipId));

  const speedStart = selectedClip?.speedRamps[0]?.speed ?? RAMP_START;
  const speedMid = selectedClip?.speedRamps[Math.floor((selectedClip?.speedRamps.length ?? 0) / 2)]?.speed ?? RAMP_MID;
  const speedEnd = selectedClip?.speedRamps[selectedClip?.speedRamps.length - 1]?.speed ?? RAMP_END;

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
                <Combine className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-orange-400 via-white/90 to-cyan-400 bg-clip-text text-transparent">Reverse Speed Ramp</h1>
                <p className="text-[10px] text-white/25 tracking-wider uppercase">
                  {selectedClip ? `${speedStart}x → ${speedMid}x → ${speedEnd}x V-ramp` : 'V-shaped speed control'}
                </p>
              </div>
            </div>
            {clips.length > 0 && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-white/25">
                  <Film className="w-3.5 h-3.5" /><span>{clips.length} clip{clips.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="hidden sm:flex items-center gap-3">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[10px] text-orange-400/70 font-mono">
                    <TrendingDown className="w-3 h-3" />{RAMP_START}x → {RAMP_MID}x
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-[10px] text-cyan-400/70 font-mono">
                    <TrendingUp className="w-3 h-3" />{RAMP_MID}x → {RAMP_END}x
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] gap-8 animate-fade-in">
              <div className="text-center space-y-4 max-w-lg">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-orange-500/10 to-cyan-500/10 border border-orange-500/20 text-xs text-orange-400/80 mb-2">
                  <Sparkles className="w-3 h-3" /> Reverse Speed Ramp
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-white/90 leading-tight">
                  Upload → Get <span className="bg-gradient-to-r from-orange-400 to-cyan-400 bg-clip-text text-transparent">V-ramp clip</span>
                </h2>
                <p className="text-sm text-white/30 leading-relaxed max-w-md mx-auto">
                  Upload a video and automatically get a reverse speed ramp: first {DEFAULT_TRIM_DURATION}s plays at {RAMP_START}x→{RAMP_MID}x (decelerate), then reverses at {RAMP_MID}x→{RAMP_END}x (accelerate). Combined into one clip.
                </p>
                <div className="flex items-center justify-center gap-6 mt-2">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/5 border border-orange-500/15">
                    <TrendingDown className="w-4 h-4 text-orange-400" /><span className="text-sm font-mono text-orange-400/80">{RAMP_START}x → {RAMP_MID}x</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/5 border border-cyan-500/15">
                    <TrendingUp className="w-4 h-4 text-cyan-400" /><span className="text-sm font-mono text-cyan-400/80">{RAMP_MID}x → {RAMP_END}x</span>
                  </div>
                </div>
              </div>
              <UploadZone />
              <div className="flex flex-wrap items-center justify-center gap-6 mt-4">
                {[
                  { icon: <Combine className="w-4 h-4" />, text: 'Single Combined Clip' },
                  { icon: <Film className="w-4 h-4" />, text: 'V-Shaped Speed Ramp' },
                  { icon: <Sparkles className="w-4 h-4" />, text: 'FFmpeg Powered' },
                ].map((f) => (
                  <div key={f.text} className="flex items-center gap-2 text-xs text-white/20">
                    <span className="text-orange-400/40">{f.icon}</span>{f.text}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              <div className="lg:col-span-1">
                <div className="sticky top-8 space-y-4">
                  <ClipList />
                  <ProcessAll />
                </div>
              </div>
              <div className="lg:col-span-2 space-y-6">
                {selectedClipId && selectedClip ? (
                  <>
                    <div className="flex items-center gap-3 px-1">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-orange-500/10 to-cyan-500/10">
                        <Combine className="w-4 h-4 text-white/70" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-medium text-white/80 truncate">{selectedClip.originalName}</h2>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs font-mono font-medium bg-gradient-to-r from-orange-400/70 to-cyan-400/70 bg-clip-text text-transparent">{speedStart}x → {speedMid}x → {speedEnd}x</span>
                          <span className="text-[10px] text-white/25">{selectedClip.width}x{selectedClip.height} · {selectedClip.fps}fps · {selectedClip.codec}</span>
                        </div>
                      </div>
                      <div className="shrink-0 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gradient-to-r from-orange-500/10 to-cyan-500/10 text-white/60 border border-white/10">
                        V-Ramp
                      </div>
                    </div>

                    {/* V-shaped speed ramp visual */}
                    <div className="rounded-2xl bg-[#0f0f17] border border-white/5 p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-4 h-4 text-orange-400" />
                        <h3 className="text-sm font-medium text-white/70">Reverse Speed Ramp</h3>
                        <span className="ml-auto text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-500/10 to-cyan-500/10 text-white/50">
                          {speedStart}x → {speedMid}x → {speedEnd}x
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-1.5 text-[10px] text-orange-400/60">
                          <TrendingDown className="w-3 h-3" />
                          <span>Forward: {speedStart}x→{speedMid}x</span>
                        </div>
                        <div className="w-px h-3 bg-white/10" />
                        <div className="flex items-center gap-1.5 text-[10px] text-cyan-400/60">
                          <TrendingUp className="w-3 h-3" />
                          <span>Reversed: {speedMid}x→{speedEnd}x</span>
                        </div>
                      </div>
                      <div className="w-full h-20 relative">
                        <svg viewBox="0 0 220 70" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                          {/* Grid lines */}
                          <line x1="20" y1="5" x2="20" y2="55" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                          <line x1="120" y1="5" x2="120" y2="55" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                          <line x1="200" y1="5" x2="200" y2="55" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                          <line x1="20" y1="30" x2="200" y2="30" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 4" />

                          {/* Y-axis labels */}
                          <text x="16" y="12" textAnchor="end" className="fill-white/25" fontSize="7">4x</text>
                          <text x="16" y="33" textAnchor="end" className="fill-white/15" fontSize="7">1x</text>
                          <text x="16" y="55" textAnchor="end" className="fill-white/25" fontSize="7">0.6x</text>

                          {/* X-axis labels */}
                          <text x="20" y="67" textAnchor="middle" className="fill-white/20" fontSize="6">0s</text>
                          <text x="120" y="67" textAnchor="middle" className="fill-white/20" fontSize="6">mid</text>
                          <text x="200" y="67" textAnchor="middle" className="fill-white/20" fontSize="6">end</text>

                          <defs>
                            <linearGradient id="rampGradForward" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#f97316" />
                              <stop offset="100%" stopColor="#22d3ee" />
                            </linearGradient>
                            <linearGradient id="rampGradReverse" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#22d3ee" />
                              <stop offset="100%" stopColor="#f97316" />
                            </linearGradient>
                            <linearGradient id="rampFillForward" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#f97316" stopOpacity="0.15" />
                              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                            </linearGradient>
                            <linearGradient id="rampFillReverse" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15" />
                              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                            </linearGradient>
                          </defs>

                          {(() => {
                            const yMax = 5, yMin = 55, yRange = yMax - yMin;
                            const yAt4 = yMin + ((4.0 - 4.0) / (4.0 - 0.6)) * yRange; // top
                            const yAt06 = yMin + ((4.0 - 0.6) / (4.0 - 0.6)) * yRange; // bottom

                            // Forward: 4x (top-left) → 0.6x (bottom-mid)
                            // Reverse: 0.6x (bottom-mid) → 4x (top-right)
                            const x0 = 20, xMid = 120, xEnd = 200;

                            return (
                              <>
                                {/* Forward fill area */}
                                <polygon points={`${x0},${yAt4} ${xMid},${yAt06} ${xMid},${yMin} ${x0},${yMin}`} fill="url(#rampFillForward)" />
                                {/* Reverse fill area */}
                                <polygon points={`${xMid},${yAt06} ${xEnd},${yAt4} ${xEnd},${yMin} ${xMid},${yMin}`} fill="url(#rampFillReverse)" />

                                {/* Forward line: 4x → 0.6x */}
                                <line x1={x0} y1={yAt4} x2={xMid} y2={yAt06} stroke="url(#rampGradForward)" strokeWidth="2.5" strokeLinecap="round" />
                                {/* Reverse line: 0.6x → 4x */}
                                <line x1={xMid} y1={yAt06} x2={xEnd} y2={yAt4} stroke="url(#rampGradReverse)" strokeWidth="2.5" strokeLinecap="round" />

                                {/* Start point (4x) */}
                                <circle cx={x0} cy={yAt4} r="4" fill="#0f0f17" stroke="#f97316" strokeWidth="2" />
                                <text x={x0} y={yAt4 - 8} textAnchor="middle" className="fill-orange-400/70" fontSize="8" fontWeight="600">4x</text>

                                {/* Mid point (0.6x) */}
                                <circle cx={xMid} cy={yAt06} r="4" fill="#0f0f17" stroke="#22d3ee" strokeWidth="2" />
                                <text x={xMid} y={yAt06 + 14} textAnchor="middle" className="fill-cyan-400/70" fontSize="8" fontWeight="600">0.6x</text>

                                {/* End point (4x) */}
                                <circle cx={xEnd} cy={yAt4} r="4" fill="#0f0f17" stroke="#f97316" strokeWidth="2" />
                                <text x={xEnd} y={yAt4 - 8} textAnchor="middle" className="fill-orange-400/70" fontSize="8" fontWeight="600">4x</text>

                                {/* Labels for forward/reverse halves */}
                                <text x={70} y={44} textAnchor="middle" className="fill-orange-400/30" fontSize="6" fontWeight="500">FORWARD</text>
                                <text x={160} y={44} textAnchor="middle" className="fill-cyan-400/30" fontSize="6" fontWeight="500">REVERSED</text>
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
                  <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 rounded-2xl bg-[#0f0f17] border border-white/5">
                    <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center">
                      <MousePointerClick className="w-6 h-6 text-white/15" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-white/40">Select a clip to edit</p>
                      <p className="text-xs text-white/20 mt-1">Choose a clip from the list to start editing</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-white/15">Reverse Speed Ramp · {RAMP_START}x→{RAMP_MID}x→{RAMP_END}x V-shape</p>
            <span className="text-[10px] text-white/10">Built with Next.js & FFmpeg</span>
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

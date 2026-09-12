'use client';

import React from 'react';
import { SpeedRampApp } from '@/components/speed-ramp-app';
import {
  NavigationPill,
  MetricsTicker,
  FeatureCard,
  CodeBlock,
  AmbientOrbs,
  SynapseFooter,
  ShinyBorderButton,
} from '@/components/synapse';
import {
  Zap,
  TrendingDown,
  TrendingUp,
  Combine,
  Film,
  Server,
  Layers,
  Gauge,
  Cpu,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

const DEMO_CODE = `import { createRamp } from '@synapse/engine';

const ramp = await createRamp({
  file: input.mp4,
  mode: 'vramp',
  trimDuration: 10.0,
  speeds: { start: 4, mid: 0.6, end: 4 },
  reverse: true,
  preset: 'ultrafast',
  crf: 23,
  outputFps: 30,
});

// Returns a Blob URL — ready to play or download
const url = URL.createObjectURL(ramp.blob);`;

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-[#030303] text-white relative">
      <AmbientOrbs />
      <NavigationPill />

      {/* ===== HERO ===== */}
      <section className="relative z-10 pt-40 pb-20 px-6">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(139,92,246,0.4) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 0% 50%, rgba(6,182,212,0.08) 0%, transparent 50%)',
          }}
        />
        <div className="relative max-w-5xl mx-auto text-center">
          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8 animate-fade-up">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-400" />
            </span>
            <span className="text-[11px] font-mono-display uppercase tracking-[0.2em] text-neutral-300">
              Synapse Engine v1.0
            </span>
          </div>

          {/* Massive heading */}
          <h1 className="font-serif-display text-6xl sm:text-7xl md:text-8xl lg:text-9xl leading-[0.9] tracking-tight mb-8 animate-fade-up stagger-1">
            Speed ramp,
            <br />
            <span className="text-shimmer italic">reengineered.</span>
          </h1>

          {/* Subtext */}
          <p className="max-w-2xl mx-auto text-lg text-neutral-400 leading-relaxed mb-10 animate-fade-up stagger-2">
            Upload a clip and Synapse auto-generates a V-shaped reverse speed ramp —
            forward at 4x→0.6x, reversed at 0.6x→4x, fused into one seamless cut.
            Powered by server-side FFmpeg.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up stagger-3">
            <a href="#studio">
              <ShinyBorderButton innerClassName="gap-2">
                <Zap className="w-4 h-4 text-violet-400" />
                Launch Studio
              </ShinyBorderButton>
            </a>
            <a
              href="#features"
              className="group inline-flex items-center gap-1.5 px-4 py-3 text-sm text-neutral-400 hover:text-white transition-colors duration-300 ease-snap"
            >
              Explore features
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 ease-snap group-hover:translate-x-1" />
            </a>
          </div>

          {/* Speed preview badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-16 animate-fade-up stagger-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-light">
              <TrendingDown className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs font-mono-display text-neutral-300">4x → 0.6x</span>
            </div>
            <div className="text-neutral-600 text-xs">then</div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-light">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-mono-display text-neutral-300">0.6x → 4x</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== METRICS TICKER ===== */}
      <MetricsTicker />

      {/* ===== STUDIO (Speed Ramp App) ===== */}
      <section id="studio" className="relative z-10 py-24 px-6 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-[11px] font-mono-display uppercase tracking-[0.2em] text-violet-400 mb-4">
              <Sparkles className="w-3 h-3" /> Studio
            </div>
            <h2 className="font-serif-display text-4xl md:text-6xl leading-tight mb-3">
              The <span className="italic text-shimmer">studio</span>
            </h2>
            <p className="text-sm text-neutral-400 max-w-md mx-auto">
              Drop a video below. Synapse handles the rest.
            </p>
          </div>
          <SpeedRampApp />
        </div>
      </section>

      {/* ===== FEATURE GRID ===== */}
      <section id="features" className="relative z-10 py-24 px-6 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[11px] font-mono-display uppercase tracking-[0.2em] text-cyan-400 mb-4">
              <Layers className="w-3 h-3" /> Capabilities
            </div>
            <h2 className="font-serif-display text-4xl md:text-6xl leading-tight">
              Built for <span className="italic text-shimmer">precision</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={Gauge}
              title="V-Shaped Ramp"
              description="Continuous logarithmic setpts interpolation produces buttery speed transitions. No jitter, no frame drops."
              accent="violet"
              delay={0.1}
            />
            <FeatureCard
              icon={Combine}
              title="Seamless Fusion"
              description="Forward ramp + reversed ramp are concatenated into a single clip with perfectly aligned audio."
              accent="cyan"
              delay={0.2}
            />
            <FeatureCard
              icon={Server}
              title="FFmpeg Native"
              description="Runs on a hardened FFmpeg 6.0 pipeline with libx264, libvpx, and aac. Ultrafast presets keep latency under 300ms."
              accent="emerald"
              delay={0.3}
            />
            <FeatureCard
              icon={Cpu}
              title="Batch Engine"
              description="Queue unlimited clips. Synapse processes them sequentially with per-clip progress and error isolation."
              accent="violet"
              delay={0.4}
            />
            <FeatureCard
              icon={Film}
              title="Smart Trim"
              description="Clips under 10s use full duration automatically. Longer clips default to the first 10s — adjustable via slider."
              accent="cyan"
              delay={0.5}
            />
            <FeatureCard
              icon={Layers}
              title="Multi-Format"
              description="Export MP4 (H.264) or WebM (VP9). Tune CRF, FPS, preset, scale, and codec from the config panel."
              accent="emerald"
              delay={0.6}
            />
          </div>
        </div>
      </section>

      {/* ===== CODE INTEGRATION BLOCK ===== */}
      <section id="api" className="relative z-10 py-24 px-6 scroll-mt-24">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono-display uppercase tracking-[0.2em] text-emerald-400 mb-4">
              <Server className="w-3 h-3" /> API
            </div>
            <h2 className="font-serif-display text-4xl md:text-6xl leading-tight mb-3">
              One endpoint. <span className="italic text-shimmer">Total control.</span>
            </h2>
            <p className="text-sm text-neutral-400 max-w-lg mx-auto">
              Hit <code className="px-1.5 py-0.5 rounded bg-white/5 font-mono-display text-violet-400 text-xs">/api/speedramp</code> with FormData.
              Get back a processed video blob.
            </p>
          </div>
          <CodeBlock filename="ramp.ts" code={DEMO_CODE} />
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <SynapseFooter />
    </div>
  );
}

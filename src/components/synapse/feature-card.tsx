'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

/**
 * FeatureCard — Reveal-on-scroll card with floating iconography.
 * Rounded-3xl, border white/5, bg white/2, padding 40px.
 * Hover: lift -12px, violet border, glow shadow, icon scale 1.1x.
 */
interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  accent?: 'violet' | 'cyan' | 'emerald';
  delay?: number;
}

const accentConfig = {
  violet: {
    iconBg: 'bg-violet-500/10',
    iconText: 'text-violet-400',
    hoverBorder: 'group-hover:border-violet-500/40',
    glow: 'group-hover:shadow-[0_0_30px_-10px_rgba(139,92,246,0.4)]',
  },
  cyan: {
    iconBg: 'bg-cyan-500/10',
    iconText: 'text-cyan-400',
    hoverBorder: 'group-hover:border-cyan-500/40',
    glow: 'group-hover:shadow-[0_0_30px_-10px_rgba(6,182,212,0.4)]',
  },
  emerald: {
    iconBg: 'bg-emerald-500/10',
    iconText: 'text-emerald-400',
    hoverBorder: 'group-hover:border-emerald-500/40',
    glow: 'group-hover:shadow-[0_0_30px_-10px_rgba(16,185,129,0.4)]',
  },
};

export function FeatureCard({
  icon: Icon,
  title,
  description,
  accent = 'violet',
  delay = 0,
}: FeatureCardProps) {
  const config = accentConfig[accent];

  return (
    <div
      className="group relative rounded-3xl border border-white/5 bg-white/[0.02] p-8 md:p-10 transition-all duration-500 ease-snap hover:-translate-y-3 hover:bg-white/[0.04] animate-fade-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className={`absolute inset-0 rounded-3xl transition-shadow duration-500 ${config.glow} pointer-events-none`} />
      {/* Icon */}
      <div className={`w-12 h-12 rounded-2xl ${config.iconBg} flex items-center justify-center mb-6 transition-transform duration-500 ease-snap group-hover:scale-110 group-hover:rotate-3`}>
        <Icon className={`w-5 h-5 ${config.iconText}`} />
      </div>
      {/* Title */}
      <h3 className="font-serif-display text-2xl text-white mb-3 leading-tight">
        {title}
      </h3>
      {/* Body */}
      <p className="text-sm text-neutral-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

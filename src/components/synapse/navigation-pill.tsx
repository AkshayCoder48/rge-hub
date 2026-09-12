'use client';

import React, { useState } from 'react';
import { Zap } from 'lucide-react';

/**
 * NavigationPill — Floating glass navigation bar.
 * Width: 95% max-width 672px. Position: top-6, centered.
 * Style: rounded-full, glass background, 1px white/10 border.
 * Content: logo left, center links, right CTA.
 */
export function NavigationPill() {
  const [active, setActive] = useState('Studio');

  const links = ['Studio', 'Features', 'API', 'Pricing'];

  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-[672px]">
      <div className="glass rounded-full px-3 py-2 flex items-center justify-between gap-2">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2 pl-2 shrink-0">
          <div className="relative w-2.5 h-2.5 rounded-full bg-gradient-to-br from-violet-400 to-cyan-400 shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
          <span className="font-serif-display text-base text-white tracking-tight hidden sm:inline">Synapse</span>
        </a>

        {/* Center links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((link) => (
            <button
              key={link}
              onClick={() => setActive(link)}
              className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-[0.15em] font-medium transition-all duration-300 ease-snap ${
                active === link
                  ? 'text-white bg-white/5'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {link}
            </button>
          ))}
        </div>

        {/* CTA */}
        <a
          href="#studio"
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-black text-[11px] font-semibold uppercase tracking-wider hover:bg-neutral-200 transition-colors duration-300 ease-snap"
        >
          <Zap className="w-3 h-3" />
          <span className="hidden sm:inline">Launch</span>
        </a>
      </div>
    </nav>
  );
}

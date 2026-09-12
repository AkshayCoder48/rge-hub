'use client';

import React from 'react';

/**
 * SynapseFooter — Footer with 4-column grid, branding, and status indicator.
 * Background #050505, top border white/5.
 */
export function SynapseFooter() {
  const columns = [
    {
      heading: 'Product',
      links: ['Studio', 'API', 'Pricing', 'Changelog'],
    },
    {
      heading: 'Resources',
      links: ['Docs', 'FFmpeg Guide', 'Examples', 'GitHub'],
    },
    {
      heading: 'Company',
      links: ['About', 'Blog', 'Careers', 'Contact'],
    },
    {
      heading: 'Legal',
      links: ['Privacy', 'Terms', 'Security', 'Status'],
    },
  ];

  return (
    <footer className="relative z-10 border-t border-white/5 bg-[#050505]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {columns.map((col) => (
            <div key={col.heading}>
              <h4 className="text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500 mb-4">
                {col.heading}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    <a href="#" className="text-sm text-neutral-400 hover:text-white transition-colors duration-300 ease-snap">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-8 border-t border-white/5">
          {/* Branding */}
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-gradient-to-br from-violet-400 to-cyan-400 shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
            <span className="font-serif-display text-xl text-white">Synapse</span>
          </div>

          {/* Copyright */}
          <p className="text-xs text-neutral-500 tracking-wide">
            © {new Date().getFullYear()} Synapse Engine. All rights reserved.
          </p>

          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-emerald-400">
              All Systems Operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

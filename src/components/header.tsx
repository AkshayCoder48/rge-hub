'use client';

import React from 'react';
import { Zap, Rocket, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useAppStore } from '@/lib/store';

export function Header() {
  const { settingsOpen, setSettingsOpen } = useAppStore();

  return (
    <header className="relative border-b-0 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
      {/* Thin gradient border at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-orange-500/60 via-orange-400/30 to-cyan-400/60" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-orange-500/25 relative">
            <Zap className="w-5 h-5 text-white" />
            {/* Pulse animation */}
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-orange-500 to-cyan-500 animate-ping opacity-10" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight flex items-center gap-2 bg-gradient-to-r from-orange-400 via-orange-300 to-cyan-400 bg-clip-text text-transparent">
              Auto Speed Ramping
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 font-normal animate-pulse">
                TURBO
              </span>
            </h1>
            <p className="text-[10px] text-zinc-500 tracking-wide">
              CINEMATIC SPEED TRANSITIONS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Speed curve indicators with tooltips */}
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-zinc-500">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 font-medium cursor-default transition-colors hover:bg-orange-500/15">
                  4.0x
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
                Forward start speed
              </TooltipContent>
            </Tooltip>
            <span className="text-zinc-600">→</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 font-medium cursor-default transition-colors hover:bg-orange-500/15">
                  0.6x
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
                Forward deceleration
              </TooltipContent>
            </Tooltip>
            <span className="text-zinc-700 mx-1">+</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium cursor-default transition-colors hover:bg-cyan-500/15">
                  0.6x
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
                Reverse start speed
              </TooltipContent>
            </Tooltip>
            <span className="text-zinc-600">→</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium cursor-default transition-colors hover:bg-cyan-500/15">
                  4.0x
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
                Reverse acceleration
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Turbo badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-[10px] text-orange-400/70 cursor-default">
                <Rocket className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">1-2s/clip</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              Average processing time per clip in Turbo mode
            </TooltipContent>
          </Tooltip>

          {/* Settings gear icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 transition-all duration-200 ${
                  settingsOpen
                    ? 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                <Settings className={`w-4 h-4 transition-transform duration-300 ${settingsOpen ? 'rotate-90' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-zinc-800 text-zinc-200 border-zinc-700">
              Settings
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

'use client';

import React, { useState } from 'react';
import { Info, Film, SlidersHorizontal, Rocket, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const STEPS = [
  {
    number: 1,
    title: 'Upload',
    icon: <Film className="w-4 h-4" />,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    dotColor: 'bg-orange-400',
    description: 'Upload video clips (MP4, MOV, AVI, MKV) or a ZIP archive with multiple clips',
  },
  {
    number: 2,
    title: 'Configure',
    icon: <SlidersHorizontal className="w-4 h-4" />,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    dotColor: 'bg-amber-400',
    description: 'Choose a preset or customize speed ramp parameters (min/max speed)',
  },
  {
    number: 3,
    title: 'Process',
    icon: <Rocket className="w-4 h-4" />,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    dotColor: 'bg-cyan-400',
    description: 'Ultra-fast parallel FFmpeg processing applies forward + reverse speed ramps',
  },
  {
    number: 4,
    title: 'Export',
    icon: <Download className="w-4 h-4" />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    dotColor: 'bg-emerald-400',
    description: 'Download individual clips or export all as a ZIP archive',
  },
];

export function HowItWorks() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-orange-400" />
              <span className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
                How It Works
              </span>
            </div>
            <div className="flex items-center gap-1 text-zinc-500">
              <span className="text-[10px]">{isOpen ? 'Hide' : 'Show'}</span>
              {isOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-1">
            <div className="relative">
              {/* Timeline vertical connector line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-orange-500/30 via-cyan-500/30 to-emerald-500/30" />

              <div className="space-y-4">
                {STEPS.map((step) => (
                  <div key={step.number} className="flex items-start gap-4 relative">
                    {/* Number badge */}
                    <div className={`relative z-10 w-8 h-8 rounded-full ${step.bg} border ${step.border} flex items-center justify-center flex-shrink-0`}>
                      <span className={step.color}>
                        {step.icon}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${step.color}`}>
                          Step {step.number}
                        </span>
                        <span className="text-xs font-medium text-zinc-200">
                          {step.title}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full ${step.dotColor}`} />
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

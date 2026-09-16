'use client';

import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mono, paper } from './surfaces';

export interface AgentPlanProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The plan's steps, in order. */
  steps: readonly string[];
  /** Index of the step in progress. Out-of-range values clamp; NaN falls back to 0. */
  activeIndex: number;
}

/**
 * AgentPlan — a checklist the agent works through: a "n of m" header, a
 * progress bar, and each step marked done (check), active (spinner), or still
 * ahead (dot). `activeIndex` is clamped into 0…steps.length before anything is
 * drawn from it; at or past the end every step reads as done and the header
 * shows n of n.
 */
export function AgentPlan({ steps, activeIndex, className, ...rest }: AgentPlanProps) {
  const clamped = Number.isNaN(activeIndex)
    ? 0
    : Math.max(0, Math.min(steps.length, activeIndex));
  const pct = steps.length > 0 ? (clamped / steps.length) * 100 : 0;

  return (
    <div className={cn(paper, 'w-full max-w-md p-3', className)} {...rest} data-slot="agent-plan">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-xs font-medium text-zinc-300">Plan</span>
        <span className={cn(mono, 'text-[11px] text-zinc-500')}>
          {clamped} of {steps.length}
        </span>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-[#ef233c] transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="mt-3 space-y-1.5">
        {steps.map((step, i) => {
          const done = i < clamped;
          const active = i === clamped && clamped < steps.length;
          return (
            <li key={i} className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {done ? (
                  <Check aria-hidden className="h-3.5 w-3.5 text-emerald-400/90" />
                ) : active ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-[#ef233c]" />
                ) : (
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-zinc-600" />
                )}
              </span>
              <span
                className={cn(
                  'min-w-0 truncate text-xs',
                  done ? 'text-zinc-400' : active ? 'text-zinc-100' : 'text-zinc-600',
                )}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

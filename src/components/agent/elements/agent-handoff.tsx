'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { field, mono } from './surfaces';

export interface AgentHandoffProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Agent that had control. */
  from: string;
  /** Agent taking control. */
  to: string;
  /** Shown below the pills. */
  reason: string;
  /** Context items listed under "carried over". Pass `[]` to render none. */
  carried: readonly string[];
  /** Switches between the in-transit and settled styling. */
  settled: boolean;
}

/**
 * AgentHandoff — the moment control passes from one agent to another: a from
 * pill, an arrow, and a to pill on one line, the reason below, and a "carried
 * over" list when `carried` is non-empty. Before `settled`, the arrow and the
 * to pill read in the accent tint to mark the handoff as in transit; once
 * settled, the from pill dims, the arrow grays, and the to pill switches to
 * the neutral field style at full opacity — all over 500ms.
 */
export function AgentHandoff({
  from,
  to,
  reason,
  carried,
  settled,
  className,
  ...rest
}: AgentHandoffProps) {
  return (
    <div className={cn('w-full max-w-md', className)} {...rest} data-slot="agent-handoff">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            field,
            'px-2.5 py-1 text-xs text-zinc-300 transition-opacity duration-500',
            settled ? 'opacity-50' : 'opacity-100',
          )}
        >
          {from}
        </span>
        <ArrowRight
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 transition-colors duration-500',
            settled ? 'text-zinc-600' : 'text-[#ef233c]',
          )}
        />
        <span
          className={cn(
            'rounded-lg border px-2.5 py-1 text-xs transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]',
            settled
              ? 'border-white/5 bg-white/[0.03] text-zinc-100'
              : 'border-[#ef233c]/40 bg-[#ef233c]/10 text-red-300',
          )}
        >
          {to}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{reason}</p>

      {carried.length > 0 && (
        <div className="mt-3">
          <div className={cn(mono, 'text-[10px] uppercase tracking-[0.15em] text-zinc-600')}>
            carried over
          </div>
          <ul className="mt-1.5 space-y-1">
            {carried.map((item, i) => (
              <li key={`${i}-${item}`} className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
                <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                <span className="min-w-0 truncate">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

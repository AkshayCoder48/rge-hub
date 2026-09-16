'use client';

import React from 'react';
import { Check, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, ghostButton, mono } from './surfaces';

export type AgentState = 'working' | 'waiting' | 'done';

export interface AgentStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Drives the leading indicator and the trailing button's icon. */
  state: AgentState;
  /** Crossfades in whenever its value changes. */
  label: string;
  /** Shown only while `state` is not "done". */
  elapsed?: string;
}

/**
 * AgentStatus — one pill that always answers what the agent is doing and for
 * how long: a check once done (otherwise a pulsing dot — accent while working,
 * muted while waiting), a label that fades and blurs between values, a mono
 * elapsed time while it is still going, and a presentational trailing button
 * that swaps between Pause and Run again. Props spread onto the root pill, not
 * onto that button.
 */
export function AgentStatus({ state, label, elapsed, className, ...rest }: AgentStatusProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-3 pr-1.5',
        className,
      )}
      {...rest}
      data-slot="agent-status"
    >
      {state === 'done' ? (
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-400/90" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 animate-pulse rounded-full transition-colors duration-500',
            state === 'working' ? 'bg-[#ef233c]' : 'bg-zinc-500',
          )}
        />
      )}

      {/* Keyed on its own content: the text fades and blurs between values. */}
      <span key={label} className={cn(anim.labelIn, 'min-w-0 truncate text-sm text-zinc-200')}>
        {label}
      </span>

      {elapsed !== undefined && state !== 'done' && (
        <span className={cn(mono, 'shrink-0 text-[11px] text-zinc-500')}>{elapsed}</span>
      )}

      {/* Presentational in this version: no onClick prop, icon + label only. */}
      <button
        type="button"
        className={cn(ghostButton, 'h-6 rounded-full px-1.5')}
        aria-label={state === 'done' ? 'Run again' : 'Pause agent'}
      >
        {state === 'done' ? (
          <Play aria-hidden className="h-3 w-3" />
        ) : (
          <Pause aria-hidden className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

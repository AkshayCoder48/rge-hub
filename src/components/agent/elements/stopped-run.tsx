'use client';

import React from 'react';
import { Play, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, field, ghostButton, mono, paper } from './surfaces';

export interface StoppedRunProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The words already streamed, joined with spaces and given a trailing cursor. */
  words: readonly string[];
  /** Freeform label shown in the badge. */
  reason: string;
  /** Called when Continue is pressed. */
  onContinue: () => void;
  /** Called when Discard is pressed. */
  onDiscard: () => void;
}

/**
 * StoppedRun — what a cancelled generation leaves behind: the words that
 * arrived before the stop, a small freeform reason badge, and a way to pick
 * the run back up or let it go. The cursor is decorative (aria-hidden) and
 * always renders; there is no internal "still streaming" state.
 */
export function StoppedRun({
  words,
  reason,
  onContinue,
  onDiscard,
  className,
  ...rest
}: StoppedRunProps) {
  return (
    <div className={cn(paper, 'w-full max-w-md p-3.5', className)} {...rest} data-slot="stopped-run">
      <p className="text-sm leading-relaxed text-zinc-200">
        {words.join(' ')}
        <span
          aria-hidden
          className={cn(
            anim.blink,
            'ml-0.5 inline-block h-[1em] w-[7px] translate-y-[2px] rounded-[1px] bg-zinc-500',
          )}
        />
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn(field, mono, 'px-2 py-0.5 text-[11px] text-zinc-400')}>{reason}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[#ef233c] px-3 text-xs font-semibold text-white shadow-[0_0_16px_-8px_rgba(239,35,60,0.7)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-red-700 active:scale-[0.98]"
        >
          <Play aria-hidden className="h-3 w-3" />
          Continue
        </button>
        <button type="button" onClick={onDiscard} className={ghostButton}>
          <Trash2 aria-hidden className="h-3 w-3" />
          Discard
        </button>
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { anim, field, mono, ShimmerLabel } from './surfaces';

export interface ThinkingIndicatorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Status text; changing it replays the shimmer and slide-in. */
  label: string;
  /** Preformatted elapsed time shown after the label. Omit to hide the badge. */
  elapsed?: string;
}

/**
 * ThinkingIndicator — a live status line that names what the agent is doing
 * right now: a pulsing accent dot, a shimmering label that replays its
 * slide-in every time it changes (the inner span is keyed on the label), and
 * an optional mono elapsed badge. Omit `elapsed` entirely to hide it; passing
 * an empty string still renders it.
 */
export function ThinkingIndicator({ label, elapsed, className, ...rest }: ThinkingIndicatorProps) {
  return (
    <div
      className={cn('flex items-center gap-2.5', className)}
      {...rest}
      data-slot="thinking-indicator"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#ef233c]" />

      {/* Keyed on the label: every change remounts the span and replays the
          shimmer sweep and the slide-in on the new text. */}
      <span key={label} className={cn(anim.slideIn, 'inline-block min-w-0')}>
        <ShimmerLabel className="text-sm">{label}</ShimmerLabel>
      </span>

      {elapsed !== undefined && (
        <span className={cn(field, mono, 'shrink-0 px-1.5 py-0.5 text-[10px] text-zinc-500')}>
          {elapsed}
        </span>
      )}
    </div>
  );
}

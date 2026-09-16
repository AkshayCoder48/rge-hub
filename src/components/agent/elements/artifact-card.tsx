'use client';

import React from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, mono, paper, ShimmerLabel } from './surfaces';

export interface ArtifactCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Card title, truncated to one line. */
  title: string;
  /** Caption shown while not generating. */
  meta: string;
  /** Switches the caption row to the shimmering word count. */
  generating?: boolean;
  /** Word count shown while `generating` is true. */
  words?: number;
}

/**
 * ArtifactCard — a generated document as a tangible object: a file icon that
 * pulses while it writes, a truncated title, and a caption that reads as a
 * shimmering word count while generating and settles into the version caption
 * once done (the two never show together). The trailing arrow appears on
 * hover; the whole card carries hover/active styling as if it were a button,
 * but declares no click handler itself — wire one through the forwarded root
 * props.
 */
export function ArtifactCard({
  title,
  meta,
  generating = false,
  words = 0,
  className,
  ...rest
}: ArtifactCardProps) {
  return (
    <div
      className={cn(
        paper,
        'group flex w-full max-w-sm cursor-pointer items-center gap-3 p-3 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white/20 hover:bg-white/[0.04] active:scale-[0.99]',
        className,
      )}
      {...rest}
      data-slot="artifact-card"
    >
      <FileText
        aria-hidden
        className={cn(
          'h-4 w-4 shrink-0 transition-colors duration-300',
          generating ? 'animate-pulse text-[#ef233c]' : 'text-zinc-400',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-zinc-100">{title}</div>
        {/* Keyed on the lane so the switch between writing and meta fades in. */}
        <div
          key={generating ? 'writing' : 'meta'}
          className={cn(anim.labelIn, 'mt-0.5 truncate text-[11px] leading-4')}
        >
          {generating ? (
            <>
              <ShimmerLabel>Writing</ShimmerLabel>
              <span className={cn(mono, 'ml-1.5 text-zinc-500')}>· {words} words</span>
            </>
          ) : (
            <span className={cn(mono, 'text-zinc-500')}>{meta}</span>
          )}
        </div>
      </div>

      <ArrowUpRight
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-zinc-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100"
      />
    </div>
  );
}

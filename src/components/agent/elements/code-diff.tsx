'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { anim, codeScroll, mono, paper } from './surfaces';

export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

export interface CodeDiffProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shown in the header. */
  filename: string;
  /** Green count in the header. */
  additions: number;
  /** Red count in the header. */
  deletions: number;
  /** The diff body, in order. */
  lines: readonly DiffLine[];
  /** Folded into each line's key; increment to replay the entrance animation. */
  cycle: number;
}

const KIND_CLS: Record<DiffLine['kind'], string> = {
  context: 'text-zinc-400',
  added: 'bg-emerald-500/[0.08] text-emerald-200',
  removed: 'bg-red-500/[0.08] text-red-200',
};

const GUTTER_SIGN: Record<DiffLine['kind'], string> = {
  context: ' ',
  added: '+',
  removed: '−',
};

const GUTTER_CLS: Record<DiffLine['kind'], string> = {
  context: 'text-zinc-700',
  added: 'text-emerald-400',
  removed: 'text-red-400',
};

/**
 * CodeDiff — a unified diff sized for chat: filename and net +N/−N counts up
 * top (always rendered, even at zero), then every context, added, and removed
 * line beneath, each tinted and gutter-marked by kind. Lines keep their own
 * whitespace and scroll horizontally; each row's entrance is staggered 60ms
 * per row and keyed on `cycle` so a new diff replays the stagger in place.
 */
export function CodeDiff({
  filename,
  additions,
  deletions,
  lines,
  cycle,
  className,
  ...rest
}: CodeDiffProps) {
  return (
    <div
      className={cn(paper, 'w-full max-w-md overflow-hidden', className)}
      {...rest}
      data-slot="code-diff"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-3 py-2">
        <span className={cn(mono, 'min-w-0 truncate text-xs text-zinc-300')}>{filename}</span>
        <span className={cn(mono, 'flex shrink-0 items-center gap-2 text-[11px]')}>
          {/* The counts always render — there is no threshold hiding +0/−0. */}
          <span className="text-emerald-400">+{additions}</span>
          <span className="text-red-400">−{deletions}</span>
        </span>
      </div>

      <div className={cn(codeScroll, 'min-h-[2rem] py-1 font-mono text-xs leading-5')}>
        {lines.map((line, i) => (
          <div
            key={`${cycle}-${i}`}
            style={{ animationDelay: `${i * 60}ms` }}
            className={cn(
              anim.rowIn,
              'flex min-w-max items-start px-3',
              KIND_CLS[line.kind],
            )}
          >
            <span
              className={cn('w-4 shrink-0 select-none text-center', GUTTER_CLS[line.kind])}
              aria-hidden
            >
              {GUTTER_SIGN[line.kind]}
            </span>
            <span className="whitespace-pre">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

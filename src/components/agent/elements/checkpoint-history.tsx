'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { mono, paper } from './surfaces';

export interface Checkpoint {
  /** Matched against `currentId`. */
  id: string;
  /** Row title. */
  label: string;
  /** Shown before the file count; any format you choose. */
  at: string;
  /** Shown as "{files} files". */
  files: number;
}

export interface CheckpointHistoryProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The rows to render, in order. */
  checkpoints: readonly Checkpoint[];
  /** Id of the active checkpoint. An id with no match leaves every row unmarked. */
  currentId: string;
  /** Called when a row's Restore button is clicked. */
  onRestore?: (id: string) => void;
}

/**
 * CheckpointHistory — the points you could restore to: one row per checkpoint
 * with a status dot (solid accent = current, hollow ring = ahead, solid gray =
 * behind), its label, "at · N files", and either a "current" marker or a
 * Restore button that only appears on hover/focus. Rows after the current one
 * read as ahead and render dimmed. An empty list renders only the
 * "Checkpoints" label.
 */
export function CheckpointHistory({
  checkpoints,
  currentId,
  onRestore,
  className,
  ...rest
}: CheckpointHistoryProps) {
  const currentIndex = checkpoints.findIndex((c) => c.id === currentId);

  return (
    <div className={cn(paper, 'w-full max-w-md p-2.5', className)} {...rest} data-slot="checkpoint-history">
      <div className="px-2 py-1 font-manrope text-[10px] uppercase tracking-[0.15em] text-zinc-600">
        Checkpoints
      </div>

      <ul className="space-y-0.5">
        {checkpoints.map((checkpoint, i) => {
          const isCurrent = i === currentIndex;
          // Rows that come after the current one in the array are "ahead".
          const isAhead = currentIndex !== -1 && i > currentIndex;
          return (
            <li
              key={checkpoint.id}
              className={cn(
                'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-opacity duration-300',
                isCurrent && 'border border-[#ef233c]/15 bg-[#ef233c]/[0.06]',
                isAhead && 'opacity-50',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  isCurrent
                    ? 'bg-[#ef233c]'
                    : isAhead
                      ? 'border border-zinc-500 bg-transparent'
                      : 'bg-zinc-600',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-zinc-200">{checkpoint.label}</div>
                <div className={cn(mono, 'truncate text-[10px] text-zinc-500')}>
                  {checkpoint.at} · {checkpoint.files} files
                </div>
              </div>
              {isCurrent ? (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#ef233c]">
                  current
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRestore?.(checkpoint.id)}
                  className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 opacity-0 transition-all duration-300 hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  Restore
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

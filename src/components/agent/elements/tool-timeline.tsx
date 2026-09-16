'use client';

import React, { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapse, ShimmerLabel, clampCount, field, mono } from './surfaces';

export interface TimelineStep {
  verb: string;
  chip: string;
  icon: LucideIcon;
}

export interface TimelineStat {
  file: string;
  added?: number;
  removed?: number;
}

export interface ToolTimelineProps {
  /** The full step list, in order. */
  steps: readonly TimelineStep[];
  /** How many steps from the start of `steps` to render. */
  visibleSteps: number;
  /** Shimmers the trigger label and the last visible step while true. */
  streaming: boolean;
  /** Whether the disclosure panel is expanded. */
  open: boolean;
  /** Called when the trigger is clicked. */
  onOpenChange: (open: boolean) => void;
  /** Trigger text shown once `streaming` is false. */
  restingLabel: string;
  /** Shimmering trigger text shown while `streaming` is true. */
  activeLabel: string;
  /** File-change chips rendered below the steps. Pass `[]` to omit the row. */
  stats: TimelineStat[];
  /** Merged onto the root. */
  className?: string;
}

/**
 * ToolTimeline — a whole working session as one collapsed line that expands
 * into a vertical trace: a verb, an icon, and a chip per step, ending in a
 * wrapped row of file-change stats. Only the last visible step shimmers, and
 * only while streaming; every earlier step reads as settled even mid-run.
 */
export function ToolTimeline({
  steps,
  visibleSteps,
  streaming,
  open,
  onOpenChange,
  restingLabel,
  activeLabel,
  stats,
  className,
}: ToolTimelineProps) {
  const panelId = useId();
  // A step can exist in `steps` before it is shown: visibleSteps clamps to the
  // list length and floors fractional/negative values to zero.
  const visible = clampCount(visibleSteps, steps.length);

  return (
    <div className={cn('w-full', className)} data-slot="tool-timeline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
            open && 'rotate-90',
          )}
        />
        {streaming ? (
          <ShimmerLabel className="min-w-0 truncate text-sm">{activeLabel}</ShimmerLabel>
        ) : (
          <span className="min-w-0 truncate text-sm text-zinc-200">{restingLabel}</span>
        )}
      </button>

      <Collapse open={open}>
        <div id={panelId} className="space-y-2.5 px-2 pb-2 pl-[1.375rem]">
          <ol className="space-y-1.5">
            {steps.slice(0, visible).map((step, i) => {
              const Icon = step.icon;
              const isLive = streaming && i === visible - 1;
              return (
                <li key={`${step.verb}-${step.chip}-${i}`} className="flex min-w-0 items-center gap-2">
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="shrink-0 text-xs text-zinc-300">{step.verb}</span>
                  <span
                    className={cn(
                      field,
                      mono,
                      'min-w-0 max-w-[60%] shrink truncate px-1.5 py-0.5 text-[11px]',
                    )}
                  >
                    {isLive ? (
                      // Shimmer lives inside the chip so the field surface is
                      // not clipped to the glyphs.
                      <ShimmerLabel className="text-zinc-300">{step.chip}</ShimmerLabel>
                    ) : (
                      <span className="text-zinc-400">{step.chip}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          {stats.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {stats.map((stat, i) => (
                <span
                  key={`${stat.file}-${i}`}
                  className={cn(
                    field,
                    mono,
                    'inline-flex min-w-0 items-center gap-1.5 px-2 py-0.5 text-[11px]',
                  )}
                >
                  <span className="min-w-0 truncate text-zinc-300">{stat.file}</span>
                  {/* A missing half of the count is omitted, not shown as zero. */}
                  {stat.added !== undefined && (
                    <span className="shrink-0 text-emerald-400">+{stat.added}</span>
                  )}
                  {stat.removed !== undefined && (
                    <span className="shrink-0 text-red-400">−{stat.removed}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}

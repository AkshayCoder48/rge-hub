'use client';

import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, mono, paper } from './surfaces';

export interface SubagentItem {
  name: string;
  model: string;
}

export interface SubagentListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The roster, in display order. */
  agents: readonly SubagentItem[];
  /** How many agents, counted from the front of `agents`, are done. */
  completedCount: number;
  /** Bar width per agent, index-aligned with `agents`. Out-of-range or NaN entries read as 0. */
  progress: readonly number[];
  /** Whether the trailing summary card renders. */
  showSummary: boolean;
  /** Name and model for the summary card. */
  summaryAgent: SubagentItem;
}

function clampPercent(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

function AgentCard({
  name,
  model,
  done,
  pct,
  className,
}: {
  name: string;
  model: string;
  done: boolean;
  pct: number;
  className?: string;
}) {
  return (
    <div className={cn(paper, 'p-2.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {done ? (
            <Check aria-hidden className="h-3.5 w-3.5 text-emerald-400/90" />
          ) : (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-[#ef233c]" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{name}</span>
        <span className={cn(mono, 'shrink-0 text-[10px] text-zinc-500')}>{model}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-[#ef233c]/70 transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * SubagentList — parallel workers with their own progress, models, and
 * completions: a stack of cards, one per worker, plus an optional trailing
 * summary card that always shows the spinner treatment and a fixed bar. The
 * root carries a minimum height so the layout does not jump as agents complete
 * and the summary card fades in.
 */
export function SubagentList({
  agents,
  completedCount,
  progress,
  showSummary,
  summaryAgent,
  className,
  style,
  ...rest
}: SubagentListProps) {
  const cardCount = agents.length + (showSummary ? 1 : 0);
  // ~56px per card + 8px gaps — holds the layout steady across completions.
  const minHeight = cardCount > 0 ? `${cardCount * 56 + (cardCount - 1) * 8}px` : undefined;

  return (
    <div
      className={cn('flex w-full flex-col gap-2', className)}
      style={{ minHeight, ...style }}
      {...rest}
      data-slot="subagent-list"
    >
      {agents.map((agent, i) => (
        <AgentCard
          key={`${agent.name}-${i}`}
          name={agent.name}
          model={agent.model}
          done={i < completedCount}
          pct={clampPercent(progress[i])}
        />
      ))}
      {showSummary && (
        <AgentCard
          className={anim.rowIn}
          name={summaryAgent.name}
          model={summaryAgent.model}
          done={false}
          pct={33}
        />
      )}
    </div>
  );
}

'use client';

import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, mono, paper } from './surfaces';

export interface TodoItem {
  /** Row key; stable ids keep entrance animation from replaying on every render. */
  id: string;
  /** The step's label. */
  text: string;
  /** Drives the icon and text styling. */
  status: 'pending' | 'active' | 'done';
}

export interface TodoListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The rows to render, in order. */
  items: readonly TodoItem[];
  /** When set, appended to the counter as "· rev {revision}". */
  revision?: number;
}

/**
 * TodoList — the agent's own working list, rewritten mid-run: a header with a
 * done ratio (plus a decorative revision when supplied), and rows showing a
 * checked box for done (dimmed + struck), a spinning loader for active, and an
 * empty outlined box for pending (reduced opacity). Rows key off `item.id`, so
 * the same id keeps its place while a genuinely new id fades and slides in.
 * With zero items the header still renders 0/0 and the list is simply empty.
 */
export function TodoList({ items, revision, className, ...rest }: TodoListProps) {
  const doneCount = items.reduce((n, item) => (item.status === 'done' ? n + 1 : n), 0);

  return (
    <div className={cn(paper, 'w-full max-w-md p-3', className)} {...rest} data-slot="todo-list">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-xs font-medium text-zinc-300">Todos</span>
        <span className={cn(mono, 'text-[11px] text-zinc-500')}>
          {doneCount}/{items.length}
          {revision !== undefined ? ` · rev ${revision}` : ''}
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(anim.rowIn, 'flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1')}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {item.status === 'done' && (
                <span
                  aria-hidden
                  className="flex h-3.5 w-3.5 items-center justify-center rounded border border-emerald-400/40 bg-emerald-400/10"
                >
                  <Check className="h-2.5 w-2.5 text-emerald-400" />
                </span>
              )}
              {item.status === 'active' && (
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-[#ef233c]" />
              )}
              {item.status === 'pending' && (
                <span aria-hidden className="h-3.5 w-3.5 rounded border border-white/15" />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-xs',
                item.status === 'done' && 'text-zinc-500 line-through',
                item.status === 'active' && 'text-zinc-100',
                item.status === 'pending' && 'text-zinc-400/70',
              )}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

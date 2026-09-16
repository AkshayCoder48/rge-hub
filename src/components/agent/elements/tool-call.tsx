'use client';

import React, { useId } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapse, ShimmerLabel, codeScroll, codeSurface, field, mono } from './surfaces';

export interface ToolCallProps {
  /** Text shown once the call has settled. */
  label: string;
  /** Shimmering text shown while `running` is true. */
  activeLabel: string;
  /** The primary argument, shown as a chip next to the label. */
  query: string;
  /** Raw request text shown in the disclosure panel. */
  request: string;
  /** Result text shown in the disclosure panel. */
  result: string;
  /** Swaps the label and hides the checkmark while true. */
  running: boolean;
  /** Whether the disclosure panel is expanded. */
  open: boolean;
  /** Called when the trigger is clicked. */
  onOpenChange: (open: boolean) => void;
  /** Merged onto the root. */
  className?: string;
}

/**
 * ToolCall — a tool call collapsed to one line: a chevron, a shimmering label
 * while it runs, the primary argument as a chip, and a checkmark once settled.
 * Clicking reveals the raw request and result in mono blocks inside a
 * height-animated disclosure.
 */
export function ToolCall({
  label,
  activeLabel,
  query,
  request,
  result,
  running,
  open,
  onOpenChange,
  className,
}: ToolCallProps) {
  const panelId = useId();

  return (
    <div className={cn('w-full', className)} data-slot="tool-call">
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
        {running ? (
          <ShimmerLabel className="min-w-0 truncate text-sm">{activeLabel}</ShimmerLabel>
        ) : (
          <span className="min-w-0 truncate text-sm text-zinc-200">{label}</span>
        )}
        <span
          className={cn(
            field,
            mono,
            'min-w-0 max-w-[60%] shrink truncate px-1.5 py-0.5 text-[11px] text-zinc-400',
          )}
        >
          {query}
        </span>
        {/* The checkmark only replaces the empty space once running is false. */}
        {running ? (
          <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-400/90" />
        )}
      </button>

      <Collapse open={open}>
        <div id={panelId} className="space-y-2 px-2 pb-2 pl-[1.375rem]">
          <section>
            <div className={cn(mono, 'px-1 text-[10px] uppercase tracking-[0.15em] text-zinc-600')}>
              Request
            </div>
            <pre
              className={cn(
                codeSurface,
                codeScroll,
                'mt-1 whitespace-pre-wrap break-words p-3 leading-relaxed text-zinc-300',
              )}
            >
              {request}
            </pre>
          </section>
          <div className="border-t border-white/5" />
          <section>
            <div className={cn(mono, 'px-1 text-[10px] uppercase tracking-[0.15em] text-zinc-600')}>
              Result
            </div>
            <pre
              className={cn(
                codeSurface,
                codeScroll,
                'mt-1 whitespace-pre-wrap break-words p-3 leading-relaxed text-zinc-300',
              )}
            >
              {result}
            </pre>
          </section>
        </div>
      </Collapse>
    </div>
  );
}

'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim, collapseInner, collapsePanel, collapsePanelOpen, paper, ShimmerLabel } from './surfaces';

export interface ThinkingReasoningProps {
  /** The reasoning sentences received so far; the array itself is the reveal. */
  sentences: readonly string[];
  /** "thinking" keeps the block open and shimmering; "done" folds it into a summary. */
  phase: 'thinking' | 'done';
  /** Total thinking time in ms — becomes "Thought for Ns" (min 1s) when done. */
  elapsedMs: number;
  /** Merged onto the root. */
  className?: string;
}

const VIEWPORT_MAX = 180; // px — the sentence stack scrolls beyond this height
const FADE = 16; // px — top/bottom fade once the viewport is capped

/**
 * ThinkingReasoning — the live version of the collapsible thinking block: a
 * shimmering "Thinking…" label while reasoning streams in (sentences appear as
 * the `sentences` prop grows), then a "Thought for Ns" header once done that
 * is clickable to toggle the stack open/collapsed. The open stack renders in a
 * capped 180px viewport that scrolls with top/bottom fade masks when capped.
 *
 * Unlike the canned demo, this component has NO internal timers — it is purely
 * driven by props: `sentences` grows as reasoning streams, and `phase` +
 * `elapsedMs` land when thinking finishes.
 */
export function ThinkingReasoning({ sentences, phase, elapsedMs, className }: ThinkingReasoningProps) {
  const done = phase === 'done';
  // While thinking the reasoning is always open; once done it folds into the
  // summary and the user can toggle it back open.
  const [open, setOpen] = useState(false);
  const [fade, setFade] = useState({ capped: false, top: false, bottom: true });
  const viewportRef = useRef<HTMLDivElement>(null);

  const expanded = done ? open : true;

  const measure = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      capped: el.scrollHeight > el.clientHeight + 1,
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  // Prop-driven only: keep the freshest sentence in view while thinking, and
  // re-measure the cap/fades whenever the content or expansion changes.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!done) el.scrollTop = el.scrollHeight;
    measure();
  }, [sentences.length, done, expanded, measure]);

  const toggle = () => {
    const next = !open;
    if (next && viewportRef.current) viewportRef.current.scrollTop = 0;
    setOpen(next);
  };

  const seconds = Number.isFinite(elapsedMs) ? Math.max(1, Math.round(elapsedMs / 1000)) : 1;

  const mask = fade.capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? FADE : 0}px, #000 calc(100% - ${fade.bottom ? FADE : 0}px), transparent 100%)`
    : undefined;

  return (
    <div className={cn(paper, 'w-full max-w-md p-2.5', className)} data-slot="thinking-reasoning">
      {done ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label="Toggle thought"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]"
        >
          <span className="text-xs text-zinc-300">Thought for {seconds}s</span>
          <ChevronDown
            aria-hidden
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
              expanded && 'rotate-180',
            )}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2 px-2 py-1.5">
          <ShimmerLabel className="text-xs text-zinc-300">Thinking…</ShimmerLabel>
        </div>
      )}

      <div className={cn(collapsePanel, expanded && collapsePanelOpen)}>
        <div
          className={cn(
            collapseInner,
            'transition-opacity duration-300',
            expanded ? 'opacity-100' : 'opacity-0',
          )}
        >
          <div
            ref={viewportRef}
            onScroll={measure}
            className="custom-scrollbar space-y-1.5 px-2 pb-1 pt-1.5"
            style={{
              maxHeight: VIEWPORT_MAX,
              overflowY: 'auto',
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
          >
            {sentences.map((sentence, i) => (
              <p key={i} className={cn(anim.rowIn, 'text-[13px] leading-relaxed text-zinc-400')}>
                {sentence}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

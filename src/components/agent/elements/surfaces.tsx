'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import styles from './surfaces.module.css';

/* ── Shared surface tokens (Red Noir) ──────────────────────────────────────
 * Every element in this folder reads its surfaces from here, so retheming
 * these tokens restyles the whole library at once.
 */

/** Monospace token — labels, chips, counts, code. */
export const mono = 'font-mono';

/** Inset field surface — chips, pills, request/result blocks. */
export const field = 'rounded-lg border border-white/5 bg-white/[0.03]';

/** Card surface — element containers. */
export const paper = 'rounded-2xl border border-white/10 bg-white/[0.02]';

/** Quiet action button — hover actions, Restore, Discard. */
export const ghostButton =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs text-zinc-400 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40';

/** Horizontal code scroll region. */
export const codeScroll = 'overflow-x-auto custom-scrollbar';

/** Code surface — request/result blocks and code bodies. */
export const codeSurface = 'rounded-lg border border-white/5 bg-black/40 font-mono text-xs';

/* ── Height-animated disclosure (grid-template-rows 0fr → 1fr) ──────────────
 * No height measuring: the grid track animates between 0fr and 1fr and the
 * inner overflow-hidden child collapses with it.
 */

export const collapsePanel =
  'grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]';
export const collapsePanelOpen = 'grid-rows-[1fr]';
export const collapseInner = 'overflow-hidden';

/** Shared keyframe classes (see surfaces.module.css). */
export const anim = {
  blink: styles.blink,
  labelIn: styles.labelIn,
  rowIn: styles.rowIn,
  slideIn: styles.slideIn,
  wordIn: styles.wordIn,
} as const;

/** Clamp a reveal count: floors it, bounds it to `max`, NaN/negative → 0. */
export function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

/**
 * ShimmerLabel — the shared shimmering text treatment: a zinc-500 → zinc-200 →
 * zinc-500 gradient sweeping behind clipped text. Because the sweep is a
 * background animation, never merge `field`/`bg-*` classes onto this span
 * (they would be clipped to the glyphs); wrap it inside the chip instead.
 */
export function ShimmerLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn(styles.shimmerText, className)}>{children}</span>;
}

/**
 * Collapse — height-animated disclosure panel. Content is mounted while open
 * and held through the close transition (~340ms) before unmounting, so both
 * directions animate without ever jumping.
 */
export function Collapse({
  open,
  className,
  innerClassName,
  children,
}: {
  open: boolean;
  className?: string;
  innerClassName?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      // Microtask-deferred so the effect body stays free of synchronous
      // setState; still lands before the next paint, so the grid track's
      // 0fr → 1fr transition and the content mount read as one frame.
      queueMicrotask(() => setMounted(true));
      return;
    }
    // Hold the content through the close transition, then unmount it.
    const id = window.setTimeout(() => setMounted(false), 340);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <div className={cn(collapsePanel, open && collapsePanelOpen, className)}>
      <div
        className={cn(
          collapseInner,
          'transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
          innerClassName,
        )}
      >
        {mounted ? children : null}
      </div>
    </div>
  );
}

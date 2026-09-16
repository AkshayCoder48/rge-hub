'use client';

/**
 * UI-block primitives — the shared shell + defensive payload accessors every
 * structured-UI renderer is built on (Red Noir).
 *
 * The agent streams `UiBlockState` payloads whose `data` fields are produced
 * by an LLM — every field may be missing or wrong-typed. Nothing in this
 * library may throw on bad payloads: every accessor below coerces to a
 * sensible default instead.
 */

import React, { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';
import type { UiBlockState } from '@/lib/agent/ui-protocol';

/** Props every UI-block renderer receives (re-exported by the registry). */
export interface BlockProps {
  block: UiBlockState;
  streaming: boolean;
}

/* ── Host actions (downloads …) ──────────────────────────────────────────── */

/** Actions the host view offers to blocks. Renderers must treat these as optional. */
export interface UiBlockActions {
  downloadFile?: (path: string) => void;
}

/**
 * Provided by the host view (agent chat). Lives here — not in the registry —
 * so renderer modules never import the registry (no import cycle).
 */
export const UiBlockActionsContext: React.Context<UiBlockActions> = createContext<UiBlockActions>({});

/** Access host actions; every field may be undefined (renderers degrade gracefully). */
export function useUiBlockActions(): UiBlockActions {
  return useContext(UiBlockActionsContext);
}

/* ── Shared Red Noir tokens ──────────────────────────────────────────────── */

/** Signature easing used across the agent chat. */
export const EASE = 'duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]';

/** Card surface — every block's outer shell. */
export const blockCard = `rounded-xl border border-white/10 bg-white/[0.02] transition-colors ${EASE} hover:bg-white/[0.04]`;

/** Section label — tiny uppercase manrope. */
export const labelCls = 'font-manrope text-[10px] uppercase tracking-[0.15em] text-zinc-500';

/** Mono body text — paths, code, ids. */
export const monoCls = 'font-mono text-[11px]';

/** Inset field surface — chips, inputs, sub-cards. */
export const fieldCls = 'rounded-lg border border-white/5 bg-white/[0.03]';

/* ── Defensive payload accessors ─────────────────────────────────────────── */

/** `unknown` → `unknown[]` (never null, never throws). */
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** `unknown` → plain object record (arrays and null → `{}`). */
export function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** `unknown` → string. Finite numbers stringify; everything else → fallback. */
export function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

/** `unknown` → finite number | undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** `unknown` → boolean | undefined (only a real boolean passes). */
export function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/** `unknown[]`-ish → string[] (each entry coerced, non-strings kept as text). */
export function strArr(v: unknown): string[] {
  return arr(v).map((entry) => str(entry));
}

/** Render a table cell / metric value from any unknown JSON value. */
export function cellText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v) ?? '';
    } catch {
      return '[object]';
    }
  }
  return String(v);
}

/** Clamp to [min, max]; NaN → min. */
export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/**
 * Stable React key: first usable field wins, index always suffixes so keys
 * stay unique even when field values repeat. Append-grown arrays keep every
 * earlier key stable because indices never shift.
 */
export function stableKey(index: number, ...fields: (string | number | undefined)[]): string {
  const primary = fields.find((f) =>
    typeof f === 'number' ? Number.isFinite(f) : typeof f === 'string' && f.length > 0,
  );
  return primary !== undefined ? `${String(primary)}#${index}` : String(index);
}

/** Human-readable byte size; invalid input → '' (callers render it conditionally). */
export function fmtBytes(bytes: unknown): string {
  const b = num(bytes);
  if (b === undefined || b < 0) return '';
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ── Status dot ──────────────────────────────────────────────────────────── */

/** Live/done indicator — pulsing red while streaming, dim zinc once settled. */
export function Dot({ streaming, className }: { streaming: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        streaming ? 'animate-pulse bg-[#ef233c] motion-reduce:animate-none' : 'bg-zinc-700',
        className,
      )}
      style={streaming ? { animationDuration: '1.5s' } : undefined}
    />
  );
}

/* ── Consistent block shell ──────────────────────────────────────────────── */

/**
 * BlockShell — the one card every renderer sits inside: a `rounded-xl` Red
 * Noir surface with an optional header row (title from the block or an
 * override, plus the status dot). Full-bleed bodies (tables, terminals, code)
 * pass `padded={false}` and pad themselves.
 */
export function BlockShell({
  block,
  streaming,
  title,
  className,
  bodyClassName,
  padded = true,
  children,
}: {
  block: UiBlockState;
  streaming: boolean;
  /** Overrides block.title; empty string hides the header entirely. */
  title?: string;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  children: React.ReactNode;
}) {
  const heading = title !== undefined ? title : block.title;
  return (
    <div className={cn(blockCard, 'w-full overflow-hidden', className)} data-ui-block={block.uiType}>
      {heading ? (
        <div className="flex items-center gap-2.5 border-b border-white/5 px-3 py-2.5">
          <Dot streaming={streaming} />
          <span className="min-w-0 truncate text-xs font-medium text-zinc-200">{heading}</span>
        </div>
      ) : null}
      <div className={cn(padded && 'p-3', bodyClassName)}>{children}</div>
    </div>
  );
}

/* ── Scroll + empty states ───────────────────────────────────────────────── */

/** Capped vertical scroll region with the app's slim red scrollbar. */
export function ScrollBox({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('max-h-96 overflow-y-auto custom-scrollbar', className)} {...rest}>
      {children}
    </div>
  );
}

/** Dim "waiting for data…" placeholder for empty/absent payloads. */
export function EmptyHint({
  hint,
  streaming,
  className,
}: {
  hint?: string;
  streaming?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-5', className)}>
      {streaming ? <Dot streaming /> : null}
      <span className="text-xs text-zinc-600">{hint ?? 'waiting for data…'}</span>
    </div>
  );
}

/* ── Callout tones ───────────────────────────────────────────────────────── */

export type CalloutVariant = 'info' | 'warning' | 'error' | 'success';

/** Border/tint/icon classes for the callout + status families. */
export const toneClasses: Record<
  CalloutVariant | 'working' | 'neutral',
  { frame: string; icon: string; dot: string }
> = {
  info: {
    frame: 'border-sky-400/25 bg-sky-400/[0.06]',
    icon: 'text-sky-400',
    dot: 'bg-sky-400',
  },
  warning: {
    frame: 'border-amber-400/25 bg-amber-400/[0.06]',
    icon: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  error: {
    frame: 'border-red-400/25 bg-red-400/[0.06]',
    icon: 'text-red-400',
    dot: 'bg-red-400',
  },
  success: {
    frame: 'border-emerald-400/25 bg-emerald-400/[0.06]',
    icon: 'text-emerald-400',
    dot: 'bg-emerald-400',
  },
  working: {
    frame: 'border-[#ef233c]/25 bg-[#ef233c]/[0.08]',
    icon: 'text-[#ef233c]',
    dot: 'bg-[#ef233c]',
  },
  neutral: {
    frame: 'border-white/10 bg-white/[0.03]',
    icon: 'text-zinc-400',
    dot: 'bg-zinc-500',
  },
};

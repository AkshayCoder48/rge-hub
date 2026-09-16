'use client';

/**
 * Basic UI-block renderers (types 1–26): tables, metrics, progress rails,
 * callouts, disclosure blocks and summary cards. Every renderer receives a
 * `UiBlockState` whose `data` is LLM-produced — all access goes through the
 * defensive primitives, so a malformed payload always renders something.
 */

import React, { useState } from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Info,
  LoaderCircle,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { anim } from '../elements/surfaces';
import {
  BlockShell,
  EmptyHint,
  ScrollBox,
  arr,
  bool,
  cellText,
  clamp,
  labelCls,
  monoCls,
  num,
  rec,
  stableKey,
  str,
  strArr,
  toneClasses,
  type BlockProps,
  type CalloutVariant,
} from './primitives';

/* ── Shared bits ─────────────────────────────────────────────────────────── */

type StatusKind = 'success' | 'error' | 'warning' | 'info' | 'working' | 'neutral';

const STATUS_KINDS: readonly string[] = ['success', 'error', 'warning', 'info', 'working'];

function statusKind(v: unknown): StatusKind {
  return STATUS_KINDS.includes(v as string) ? (v as StatusKind) : 'neutral';
}

const STATUS_ICON: Record<StatusKind, LucideIcon> = {
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
  working: LoaderCircle,
  neutral: Info,
};

function StatusIcon({ kind, className }: { kind: StatusKind; className?: string }) {
  const Icon = STATUS_ICON[kind];
  const tone = toneClasses[kind];
  return (
    <Icon
      aria-hidden
      className={cn('h-4 w-4 shrink-0', tone.icon, kind === 'working' && 'animate-spin motion-reduce:animate-none', className)}
    />
  );
}

/** Delta / trend tint: "+x" green, "−x"/"-x" red, everything else zinc. */
function deltaTone(delta: string): string {
  const d = delta.trim();
  if (d.startsWith('+')) return 'text-emerald-400';
  if (d.startsWith('-') || d.startsWith('−')) return 'text-red-400';
  return 'text-zinc-400';
}

/** Dark search input shared by searchable-list / filterable-table. */
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-white/10 bg-black/30 pl-8 pr-3 text-xs text-zinc-200 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] placeholder:text-zinc-600 focus:border-[#ef233c]/40 focus:outline-none"
      />
    </div>
  );
}

/* ── Plain table core (table / filterable-table / sortable-table) ────────── */

function PlainTable({
  columns,
  rows,
  headerCell,
  cellTint,
}: {
  columns: string[];
  rows: unknown[][];
  /** Optional custom header renderer (sort buttons). */
  headerCell?: (col: string, index: number) => React.ReactNode;
  /** Optional per-cell tint (comparison / highlight). */
  cellTint?: (col: number, row: number) => string;
}) {
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col, i) => (
              <th key={stableKey(i, col)} className={cn(labelCls, 'whitespace-nowrap px-2.5 py-2 font-normal', cellTint?.(i, -1))}>
                {headerCell ? headerCell(col, i) : col || `Col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr
              key={stableKey(r, cellText(row[0]))}
              className={cn(
                anim.rowIn,
                'border-b border-white/5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] last:border-0 hover:bg-white/[0.02]',
              )}
            >
              {columns.map((_, c) => {
                const cell = row[c];
                const isNum = typeof cell === 'number';
                return (
                  <td
                    key={c}
                    className={cn(
                      'whitespace-nowrap px-2.5 py-1.5',
                      c === 0 ? 'font-medium text-zinc-200' : isNum ? 'text-zinc-300' : 'text-zinc-400',
                      isNum && monoCls,
                      cellTint?.(c, r),
                    )}
                  >
                    {cellText(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 1. table ────────────────────────────────────────────────────────────── */

export function TableBlock({ block, streaming }: BlockProps) {
  const columns = strArr(block.data.columns);
  const rows = arr(block.data.rows).map((r) => arr(r));
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {columns.length === 0 && rows.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <PlainTable columns={columns} rows={rows} />
      )}
    </BlockShell>
  );
}

/* ── 2. data-table ───────────────────────────────────────────────────────── */

export function DataTableBlock({ block, streaming }: BlockProps) {
  const columns = arr(block.data.columns).map((raw, i) => {
    const c = rec(raw);
    return {
      key: str(c.key, `col${i}`),
      label: str(c.label) || str(c.key, `Col ${i + 1}`),
      mono: bool(c.mono) === true,
      keyId: stableKey(i, str(c.key), str(c.label)),
    };
  });
  const rows = arr(block.data.rows).map((raw) => rec(raw));
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {columns.length === 0 && rows.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-white/10">
                {columns.map((c) => (
                  <th key={c.keyId} className={cn(labelCls, 'whitespace-nowrap px-2.5 py-2 font-normal')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr
                  key={stableKey(r, cellText(row[columns[0]?.key ?? '']))}
                  className="border-b border-white/5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] last:border-0 hover:bg-white/[0.02]"
                >
                  {columns.map((c) => (
                    <td
                      key={c.keyId}
                      className={cn(
                        'whitespace-nowrap px-2.5 py-1.5',
                        c.mono ? cn(monoCls, 'text-zinc-300') : 'text-zinc-400',
                      )}
                    >
                      {cellText(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BlockShell>
  );
}

/* ── 3. comparison-table ─────────────────────────────────────────────────── */

export function ComparisonTableBlock({ block, streaming }: BlockProps) {
  const columns = strArr(block.data.columns);
  const rows = arr(block.data.rows).map((r) => arr(r));
  const highlight = num(block.data.highlightColumn);
  // 2nd+ columns read as base vs modified — subtly tinted; the highlighted
  // column gets the red accent.
  const tint = (col: number): string => {
    if (highlight !== undefined && col === highlight) return 'bg-[#ef233c]/[0.07] text-red-200';
    if (col >= 1) return 'bg-white/[0.02]';
    return '';
  };
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {columns.length === 0 && rows.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <PlainTable columns={columns} rows={rows} cellTint={(col) => tint(col)} />
      )}
    </BlockShell>
  );
}

/* ── 4. key-value ────────────────────────────────────────────────────────── */

export function KeyValueBlock({ block, streaming }: BlockProps) {
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    return {
      key: str(e.key, '—'),
      value: cellText(e.value),
      mono: bool(e.mono) === true,
      keyId: stableKey(i, str(e.key)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {entries.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <dl className="divide-y divide-white/5">
          {entries.map((e) => (
            <div key={e.keyId} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-xs text-zinc-500">{e.key}</dt>
              <dd
                className={cn(
                  'min-w-0 break-words text-right',
                  e.mono ? cn(monoCls, 'text-zinc-300') : 'text-xs text-zinc-200',
                )}
              >
                {e.value || '—'}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </BlockShell>
  );
}

/* ── 5. stats ────────────────────────────────────────────────────────────── */

export function StatsBlock({ block, streaming }: BlockProps) {
  const metrics = arr(block.data.metrics).map((raw, i) => {
    const m = rec(raw);
    return {
      label: str(m.label, 'Metric'),
      value: cellText(m.value) || '—',
      unit: str(m.unit),
      delta: str(m.delta),
      keyId: stableKey(i, str(m.label)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {metrics.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div
              key={m.keyId}
              className={cn(anim.rowIn, 'rounded-lg border border-white/5 bg-white/[0.03] p-3')}
            >
              <div className={labelCls}>{m.label}</div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-xl font-semibold text-zinc-100">{m.value}</span>
                {m.unit ? <span className="text-[11px] text-zinc-500">{m.unit}</span> : null}
              </div>
              {m.delta ? (
                <div className={cn(monoCls, 'mt-1', deltaTone(m.delta))}>{m.delta}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 6. progress ─────────────────────────────────────────────────────────── */

const PROGRESS_FILL: Record<string, string> = {
  done: 'bg-emerald-400',
  active: 'bg-[#ef233c]',
  pending: 'bg-zinc-600',
};

export function ProgressBlock({ block, streaming }: BlockProps) {
  const items = arr(block.data.items).map((raw, i) => {
    const it = rec(raw);
    const value = clamp(num(it.value) ?? 0, 0, 100);
    const status =
      it.status === 'done' || it.status === 'active' || it.status === 'pending'
        ? it.status
        : value >= 100
          ? 'done'
          : value > 0
            ? 'active'
            : 'pending';
    return {
      label: str(it.label, `Item ${i + 1}`),
      value,
      status,
      keyId: stableKey(i, str(it.label)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {items.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.keyId}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-zinc-300">{it.label}</span>
                <span className={cn(monoCls, 'shrink-0 text-zinc-500')}>{Math.round(it.value)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                    PROGRESS_FILL[it.status],
                  )}
                  style={{ width: `${it.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 7. checklist ────────────────────────────────────────────────────────── */

export function ChecklistBlock({ block, streaming }: BlockProps) {
  const items = arr(block.data.items).map((raw, i) => {
    const it = rec(raw);
    return {
      text: str(it.text, `Item ${i + 1}`),
      done: bool(it.done) === true,
      keyId: stableKey(i, str(it.text)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {items.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.keyId} className={cn(anim.rowIn, 'flex items-start gap-2.5')}>
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  it.done ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/15 bg-white/[0.02]',
                )}
              >
                {it.done ? <Check className="h-3 w-3 text-emerald-400" /> : null}
              </span>
              <span
                className={cn(
                  'min-w-0 break-words text-xs leading-relaxed',
                  it.done ? 'text-zinc-600 line-through' : 'text-zinc-300',
                )}
              >
                {it.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </BlockShell>
  );
}

/* ── 8. steps ────────────────────────────────────────────────────────────── */

export function StepsBlock({ block, streaming }: BlockProps) {
  const steps = arr(block.data.steps).map((raw, i) => {
    const s = rec(raw);
    return {
      label: str(s.label, `Step ${i + 1}`),
      detail: str(s.detail),
      keyId: stableKey(i, str(s.label)),
    };
  });
  const active = clamp(Math.trunc(num(block.data.activeIndex) ?? 0), 0, steps.length);
  return (
    <BlockShell block={block} streaming={streaming}>
      {steps.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ol>
          {steps.map((s, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : 'pending';
            return (
              <li key={s.keyId} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
                      state === 'done' && 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400',
                      state === 'active' && 'animate-pulse border-[#ef233c]/60 bg-[#ef233c]/15 text-[#ff6b6b] motion-reduce:animate-none',
                      state === 'pending' && 'border-white/10 bg-white/[0.02] text-zinc-600',
                    )}
                  >
                    {state === 'done' ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {i < steps.length - 1 ? <span className="w-px flex-1 bg-white/5" /> : null}
                </div>
                <div className={cn('min-w-0 pb-4', i === steps.length - 1 && 'pb-1')}>
                  <div
                    className={cn(
                      'text-xs font-medium',
                      state === 'active' ? 'text-zinc-100' : state === 'done' ? 'text-zinc-300' : 'text-zinc-500',
                    )}
                  >
                    {s.label}
                  </div>
                  {s.detail ? <div className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-600">{s.detail}</div> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </BlockShell>
  );
}

/* ── 9. timeline ─────────────────────────────────────────────────────────── */

const TIMELINE_DOT: Record<string, string> = {
  done: 'bg-emerald-400',
  active: 'bg-[#ef233c] animate-pulse motion-reduce:animate-none',
  pending: 'bg-zinc-700',
  error: 'bg-red-400',
};

export function TimelineBlock({ block, streaming }: BlockProps) {
  const events = arr(block.data.events).map((raw, i) => {
    const e = rec(raw);
    const status =
      e.status === 'done' || e.status === 'active' || e.status === 'pending' || e.status === 'error'
        ? e.status
        : 'done';
    return {
      label: str(e.label, `Event ${i + 1}`),
      detail: str(e.detail),
      time: str(e.time),
      status,
      keyId: stableKey(i, str(e.label), str(e.time)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {events.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <ol>
            {events.map((e, i) => (
              <li key={e.keyId} className={cn(anim.rowIn, 'flex gap-3')}>
                <div className="flex flex-col items-center">
                  <span aria-hidden className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', TIMELINE_DOT[e.status])} />
                  {i < events.length - 1 ? <span className="w-px flex-1 bg-white/5" /> : null}
                </div>
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pb-4">
                  <div className="min-w-0">
                    <div className="break-words text-xs font-medium text-zinc-200">{e.label}</div>
                    {e.detail ? (
                      <div className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-600">{e.detail}</div>
                    ) : null}
                  </div>
                  {e.time ? <span className={cn(monoCls, 'shrink-0 text-zinc-600')}>{e.time}</span> : null}
                </div>
              </li>
            ))}
          </ol>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 10. status ──────────────────────────────────────────────────────────── */

export function StatusBlock({ block, streaming }: BlockProps) {
  const kind = statusKind(block.data.state);
  const label = str(block.data.label, 'Working…');
  const detail = str(block.data.detail);
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="flex items-start gap-3">
        <StatusIcon kind={kind} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          {detail ? (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-500">{detail}</div>
          ) : null}
        </div>
      </div>
    </BlockShell>
  );
}

/* ── 11–15. callout + variant aliases ───────────────────────────────────── */

const CALLOUT_VARIANTS: readonly string[] = ['info', 'warning', 'error', 'success'];

function calloutIcon(variant: CalloutVariant): LucideIcon {
  return variant === 'warning' ? TriangleAlert : variant === 'error' ? CircleX : variant === 'success' ? CircleCheck : Info;
}

/** Builds a callout renderer; `fixed` locks the variant (warning/error/success/info types). */
function makeCalloutBlock(fixed?: CalloutVariant) {
  return function CalloutBlock({ block, streaming }: BlockProps) {
    const variant =
      fixed ?? (CALLOUT_VARIANTS.includes(block.data.variant as string) ? (block.data.variant as CalloutVariant) : 'info');
    const tone = toneClasses[variant];
    const Icon = calloutIcon(variant);
    const title = str(block.data.title);
    const text = str(block.data.text);
    return (
      <BlockShell block={block} streaming={streaming}>
        <div className={cn('flex items-start gap-2.5 rounded-lg border p-3', tone.frame)}>
          <Icon aria-hidden className={cn('mt-0.5 h-4 w-4 shrink-0', tone.icon)} />
          <div className="min-w-0 flex-1">
            {title ? <div className="text-xs font-medium text-zinc-100">{title}</div> : null}
            {text ? (
              <div className={cn('whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400', !title && 'mt-0')}>
                {text}
              </div>
            ) : null}
            {!title && !text ? <span className="text-xs text-zinc-600">…</span> : null}
          </div>
        </div>
      </BlockShell>
    );
  };
}

export const CalloutBlock = makeCalloutBlock();
export const WarningBlock = makeCalloutBlock('warning');
export const ErrorBlock = makeCalloutBlock('error');
export const SuccessBlock = makeCalloutBlock('success');
export const InfoBlock = makeCalloutBlock('info');

/* ── 16. badges ──────────────────────────────────────────────────────────── */

const BADGE_TONES: Record<string, string> = {
  default: 'border-white/10 bg-white/[0.04] text-zinc-300',
  red: 'border-[#ef233c]/25 bg-[#ef233c]/10 text-red-300',
  green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  amber: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  zinc: 'border-white/10 bg-white/[0.02] text-zinc-500',
};

export function BadgesBlock({ block, streaming }: BlockProps) {
  const badges = arr(block.data.badges).map((raw, i) => {
    const b = rec(raw);
    return {
      label: str(b.label, '—'),
      tone: BADGE_TONES[str(b.tone)] ?? BADGE_TONES.default,
      keyId: stableKey(i, str(b.label)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {badges.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span
              key={b.keyId}
              className={cn(anim.rowIn, 'rounded-full border px-2.5 py-0.5 text-[11px] leading-5', b.tone)}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 17. card-grid ───────────────────────────────────────────────────────── */

export function CardGridBlock({ block, streaming }: BlockProps) {
  const cards = arr(block.data.cards).map((raw, i) => {
    const c = rec(raw);
    return {
      title: str(c.title, 'Card'),
      value: cellText(c.value),
      text: str(c.text),
      keyId: stableKey(i, str(c.title)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {cards.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div
              key={c.keyId}
              className={cn(anim.rowIn, 'rounded-lg border border-white/5 bg-white/[0.02] p-3 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.04]')}
            >
              <div className={labelCls}>{c.title}</div>
              {c.value ? <div className="mt-1.5 text-lg font-semibold text-zinc-100">{c.value}</div> : null}
              {c.text ? <div className="mt-1 break-words text-xs leading-relaxed text-zinc-500">{c.text}</div> : null}
            </div>
          ))}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 18. accordion ───────────────────────────────────────────────────────── */

export function AccordionBlock({ block, streaming }: BlockProps) {
  const sections = arr(block.data.sections).map((raw, i) => {
    const s = rec(raw);
    return {
      title: str(s.title, `Section ${i + 1}`),
      content: str(s.content),
      keyId: stableKey(i, str(s.title)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {sections.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <Accordion type="single" collapsible className="px-1">
          {sections.map((s, i) => (
            <AccordionItem key={s.keyId} value={`section-${i}`} className="border-white/5">
              <AccordionTrigger className="py-2.5 text-xs font-medium text-zinc-200 hover:no-underline">
                {s.title}
              </AccordionTrigger>
              <AccordionContent className="pb-3 text-xs leading-relaxed text-zinc-400">
                <span className="whitespace-pre-wrap break-words">{s.content || '—'}</span>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </BlockShell>
  );
}

/* ── 19. tabs ────────────────────────────────────────────────────────────── */

export function TabsBlock({ block, streaming }: BlockProps) {
  const tabs = arr(block.data.tabs).map((raw, i) => {
    const t = rec(raw);
    return {
      label: str(t.label, `Tab ${i + 1}`),
      content: str(t.content),
      keyId: stableKey(i, str(t.label)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {tabs.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <Tabs defaultValue="tab-0" className="gap-2 p-3">
          <TabsList className="h-8 border border-white/5 bg-black/30 p-0.5">
            {tabs.map((t, i) => (
              <TabsTrigger
                key={t.keyId}
                value={`tab-${i}`}
                className="h-full rounded-md px-2.5 text-xs text-zinc-400 data-[state=active]:border-white/10 data-[state=active]:bg-white/10 data-[state=active]:text-zinc-100"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t, i) => (
            <TabsContent key={t.keyId} value={`tab-${i}`} className="pt-1">
              <ScrollBox>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">
                  {t.content || '—'}
                </p>
              </ScrollBox>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </BlockShell>
  );
}

/* ── 20. expandable ──────────────────────────────────────────────────────── */

export function ExpandableBlock({ block, streaming }: BlockProps) {
  const [open, setOpen] = useState(false);
  const title = str(block.data.title, 'Details');
  const content = str(block.data.content);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.02]">
          <ChevronRight
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[state=open]:rotate-90"
          />
          <span className="min-w-0 truncate text-xs font-medium text-zinc-200">{title}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollBox className="px-3 pb-3">
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">
              {content || '—'}
            </p>
          </ScrollBox>
        </CollapsibleContent>
      </Collapsible>
    </BlockShell>
  );
}

/* ── 21. searchable-list ─────────────────────────────────────────────────── */

export function SearchableListBlock({ block, streaming }: BlockProps) {
  const [query, setQuery] = useState('');
  const items = arr(block.data.items).map((raw, i) => {
    const it = rec(raw);
    return {
      label: str(it.label, `Item ${i + 1}`),
      detail: str(it.detail),
      keyId: stableKey(i, str(it.label)),
    };
  });
  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter((it) => it.label.toLowerCase().includes(q) || it.detail.toLowerCase().includes(q))
    : items;
  return (
    <BlockShell block={block} streaming={streaming}>
      {items.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="space-y-2.5">
          <SearchInput value={query} onChange={setQuery} placeholder="Search…" />
          {q ? (
            <div className={cn(monoCls, 'text-zinc-600')}>
              {visible.length} / {items.length}
            </div>
          ) : null}
          {visible.length === 0 ? (
            <EmptyHint hint="no matches" />
          ) : (
            <ScrollBox>
              <ul className="space-y-1">
                {visible.map((it) => (
                  <li
                    key={it.keyId}
                    className="rounded-lg px-2 py-1.5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]"
                  >
                    <div className="truncate text-[13px] text-zinc-200">{it.label}</div>
                    {it.detail ? <div className="mt-0.5 break-words text-[11px] text-zinc-500">{it.detail}</div> : null}
                  </li>
                ))}
              </ul>
            </ScrollBox>
          )}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 22. filterable-table ────────────────────────────────────────────────── */

export function FilterableTableBlock({ block, streaming }: BlockProps) {
  const [query, setQuery] = useState('');
  const columns = strArr(block.data.columns);
  const rows = arr(block.data.rows).map((r) => arr(r));
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((row) => row.map(cellText).join(' ').toLowerCase().includes(q)) : rows;
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {columns.length === 0 && rows.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="space-y-2.5 p-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Filter rows…" />
          {visible.length === 0 ? (
            <EmptyHint hint={q ? 'no matching rows' : undefined} />
          ) : (
            <PlainTable columns={columns} rows={visible} />
          )}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 23. sortable-table ──────────────────────────────────────────────────── */

export function SortableTableBlock({ block, streaming }: BlockProps) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const columns = strArr(block.data.columns);
  const rows = arr(block.data.rows).map((r) => arr(r));
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const an = num(a[sort.col]);
        const bn = num(b[sort.col]);
        const cmp =
          an !== undefined && bn !== undefined
            ? an - bn
            : cellText(a[sort.col]).localeCompare(cellText(b[sort.col]));
        return cmp * sort.dir;
      })
    : rows;
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {columns.length === 0 && rows.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <PlainTable
          columns={columns}
          rows={sorted}
          headerCell={(col, i) => (
            <button
              type="button"
              onClick={() =>
                setSort((prev) => (prev && prev.col === i ? { col: i, dir: prev.dir === 1 ? -1 : 1 } : { col: i, dir: 1 }))
              }
              className={cn(
                'inline-flex items-center gap-1 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-zinc-300',
                sort?.col === i && 'text-[#ff6b6b]',
              )}
            >
              {col || `Col ${i + 1}`}
              <ArrowUpDown aria-hidden className="h-3 w-3 opacity-60" />
            </button>
          )}
        />
      )}
    </BlockShell>
  );
}

/* ── 24. activity ────────────────────────────────────────────────────────── */

export function ActivityBlock({ block, streaming }: BlockProps) {
  const events = arr(block.data.events).map((raw, i) => {
    const e = rec(raw);
    return {
      text: str(e.text, '…'),
      time: str(e.time),
      keyId: stableKey(i, str(e.text), str(e.time)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {events.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <ul className="space-y-2.5">
            {events.map((e) => (
              <li key={e.keyId} className={cn(anim.rowIn, 'flex items-baseline gap-2.5')}>
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                <span className="min-w-0 flex-1 break-words text-xs text-zinc-300">{e.text}</span>
                {e.time ? <span className={cn(monoCls, 'shrink-0 text-zinc-600')}>{e.time}</span> : null}
              </li>
            ))}
          </ul>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 25. result-summary ──────────────────────────────────────────────────── */

export function ResultSummaryBlock({ block, streaming }: BlockProps) {
  const kind = statusKind(block.data.status);
  const headline = str(block.data.headline, 'Result');
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    return {
      key: str(e.key, '—'),
      value: cellText(e.value),
      keyId: stableKey(i, str(e.key)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="flex items-start gap-2.5">
        <StatusIcon kind={kind} className="mt-0.5" />
        <div className="min-w-0 flex-1 break-words text-sm font-medium text-zinc-100">{headline}</div>
      </div>
      {entries.length > 0 ? (
        <dl className="mt-3 divide-y divide-white/5 border-t border-white/5 pt-1">
          {entries.map((e) => (
            <div key={e.keyId} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-xs text-zinc-500">{e.key}</dt>
              <dd className="min-w-0 break-words text-right text-xs text-zinc-200">{e.value || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </BlockShell>
  );
}

/* ── 26. empty ───────────────────────────────────────────────────────────── */

export function EmptyBlock({ block, streaming }: BlockProps) {
  const hint = str(block.data.hint);
  return (
    <BlockShell block={block} streaming={streaming} className="border-dashed" bodyClassName="py-2">
      <div className="flex items-center justify-center gap-2 py-3 text-center">
        <ChevronDown aria-hidden className="h-3 w-3 text-zinc-700" />
        <span className="text-xs text-zinc-600">{hint || 'Nothing to show yet'}</span>
      </div>
    </BlockShell>
  );
}

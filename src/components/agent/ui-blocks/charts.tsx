'use client';

/**
 * Chart UI-block renderers (types 56–60) — recharts on the Red Noir palette
 * (accent #ef233c, dim #27272a grid, dark tooltips) plus one dependency-free
 * SVG progress ring. Charts render only when data is present; empty payloads
 * show the dim waiting hint so a streaming block still reads as alive.
 */

import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  BlockShell,
  EmptyHint,
  arr,
  clamp,
  labelCls,
  monoCls,
  num,
  rec,
  str,
  type BlockProps,
} from './primitives';

const ACCENT = '#ef233c';
const GRID = '#27272a';
const AXIS_TICK = { fill: '#71717a', fontSize: 10 };

const TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: '#18181b',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    fontSize: '11px',
    color: '#e4e4e7',
    boxShadow: 'none',
    padding: '6px 10px',
  },
  labelStyle: { color: '#a1a1aa' },
  itemStyle: { color: ACCENT },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
} as const;

/** Coerce `data: {label, value}[]` defensively. */
function toPoints(v: unknown): { label: string; value: number }[] {
  return arr(v).map((raw, i) => {
    const r = rec(raw);
    return {
      label: str(r.label, `#${i + 1}`),
      value: num(r.value) ?? 0,
    };
  });
}

/* ── 56. bar-chart ───────────────────────────────────────────────────────── */

export function BarChartBlock({ block, streaming }: BlockProps) {
  const points = toPoints(block.data.data);
  const unit = str(block.data.unit);
  return (
    <BlockShell block={block} streaming={streaming}>
      {points.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: GRID }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v: number | string) => [`${v}${unit ? ` ${unit}` : ''}`, 'value']} />
              <Bar dataKey="value" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </BlockShell>
  );
}

/* ── 57. line-chart ──────────────────────────────────────────────────────── */

export function LineChartBlock({ block, streaming }: BlockProps) {
  const points = toPoints(block.data.data);
  const unit = str(block.data.unit);
  return (
    <BlockShell block={block} streaming={streaming}>
      {points.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: GRID }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v: number | string) => [`${v}${unit ? ` ${unit}` : ''}`, 'value']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={ACCENT}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ fill: ACCENT, r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </BlockShell>
  );
}

/* ── 58. pie-chart ───────────────────────────────────────────────────────── */

const PIE_PALETTE = ['#ef233c', '#ff6b6b', '#c81d35', '#ff8fa3', '#fca5a5', '#a1a1aa', '#71717a', '#52525b'];

export function PieChartBlock({ block, streaming }: BlockProps) {
  const points = toPoints(block.data.data);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  return (
    <BlockShell block={block} streaming={streaming}>
      {points.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <div className="h-56 w-full max-w-[14rem] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip {...TOOLTIP_PROPS} />
                <Pie
                  data={points}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {points.map((p, i) => (
                    <Cell key={p.label} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex w-full min-w-0 flex-col gap-1.5">
            {points.map((p, i) => (
              <li key={p.label} className="flex items-center gap-2 text-xs text-zinc-400">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PIE_PALETTE[i % PIE_PALETTE.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{p.label}</span>
                <span className={cn(monoCls, 'shrink-0 text-zinc-500')}>
                  {p.value}
                  {total > 0 ? <span className="text-zinc-700"> · {Math.round((p.value / total) * 100)}%</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </BlockShell>
  );
}

/* ── 59. progress-chart (SVG ring — no recharts) ─────────────────────────── */

export function ProgressChartBlock({ block, streaming }: BlockProps) {
  const value = clamp(num(block.data.value) ?? 0, 0, 100);
  const label = str(block.data.label);
  const size = 128;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (value / 100) * circumference;
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="flex flex-col items-center gap-2 py-1">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={GRID}
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={ACCENT}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference - dash}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ transition: 'stroke-dasharray 0.5s cubic-bezier(0.23, 1, 0.32, 1)' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-xl font-semibold text-zinc-100">{Math.round(value)}%</span>
          </div>
        </div>
        {label ? <div className={labelCls}>{label}</div> : null}
      </div>
    </BlockShell>
  );
}

/* ── 60. metric-trend ────────────────────────────────────────────────────── */

function deltaTone(delta: string): string {
  const d = delta.trim();
  if (d.startsWith('+')) return 'text-emerald-400';
  if (d.startsWith('-') || d.startsWith('−')) return 'text-red-400';
  return 'text-zinc-400';
}

export function MetricTrendBlock({ block, streaming }: BlockProps) {
  const gradId = `spark-fill-${useId()}`;
  const label = str(block.data.label, 'Metric');
  const value = str(block.data.value, '—');
  const delta = str(block.data.delta);
  const points = arr(block.data.points)
    .map((p) => num(p))
    .filter((p): p is number => p !== undefined)
    .map((p, i) => ({ v: p, i }));
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className={labelCls}>{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-zinc-100">{value}</span>
        {delta ? <span className={cn(monoCls, deltaTone(delta))}>{delta}</span> : null}
      </div>
      {points.length > 1 ? (
        <div className="mt-2 h-12 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip {...TOOLTIP_PROPS} formatter={(v: number | string) => [v, label]} />
              <Area
                type="monotone"
                dataKey="v"
                stroke={ACCENT}
                strokeWidth={1.5}
                fill={`url(#${gradId})`}
                dot={false}
                activeDot={{ fill: ACCENT, r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </BlockShell>
  );
}

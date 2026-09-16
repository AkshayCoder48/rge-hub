'use client';

/**
 * Code / execution UI-block renderers (types 42–55): code, JSON, YAML, CSV,
 * a live terminal, logs, diffs and validation surfaces. Streaming blocks grow
 * in place (append ops concat `lines` / `entries`), so every list renders
 * whatever has arrived and animates only newly-mounted rows.
 */

import React, { useEffect, useRef } from 'react';
import {
  CircleCheck,
  CircleX,
  FilePenLine,
  LoaderCircle,
  Minus,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim } from '../elements/surfaces';
import {
  BlockShell,
  EmptyHint,
  ScrollBox,
  arr,
  bool,
  cellText,
  labelCls,
  monoCls,
  num,
  rec,
  stableKey,
  str,
  type BlockProps,
} from './primitives';

const LINE_CAP = 400;

/** "… N more lines" footer for capped code bodies. */
function MoreLines({ count }: { count: number }) {
  return (
    <div className={cn(monoCls, 'border-t border-white/5 px-3 py-2 text-zinc-600')}>
      … {count} more lines
    </div>
  );
}

/* ── 42. code ────────────────────────────────────────────────────────────── */

export function CodeBlock({ block, streaming }: BlockProps) {
  const code = str(block.data.code);
  const language = str(block.data.language);
  const filename = str(block.data.filename);
  const lines = code ? code.split('\n') : [];
  const visible = lines.slice(0, LINE_CAP);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {lines.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <>
          {filename || language ? (
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
              {filename ? (
                <span className={cn(monoCls, 'min-w-0 truncate text-zinc-300')}>{filename}</span>
              ) : null}
              {language ? (
                <span className={cn(monoCls, 'ml-auto shrink-0 rounded border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-zinc-500')}>
                  {language}
                </span>
              ) : null}
            </div>
          ) : null}
          <ScrollBox>
            <div className={cn(monoCls, 'min-w-max py-2 leading-relaxed')}>
              {visible.map((line, i) => (
                <div key={i} className="flex px-3 hover:bg-white/[0.02]">
                  <span className="w-8 shrink-0 select-none pr-3 text-right text-zinc-700">{i + 1}</span>
                  <span className="whitespace-pre text-zinc-300">{line || ' '}</span>
                </div>
              ))}
            </div>
          </ScrollBox>
          {lines.length > LINE_CAP ? <MoreLines count={lines.length - LINE_CAP} /> : null}
        </>
      )}
    </BlockShell>
  );
}

/* ── 43. json ────────────────────────────────────────────────────────────── */

/** Token spans for one pretty-printed JSON line (dependency-free two-tone). */
function JsonLine({ line }: { line: string }) {
  const parts: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parts.push(<span key={parts.length} className="text-zinc-600">{line.slice(last, m.index)}</span>);
    }
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        parts.push(
          <span key={parts.length}>
            <span className="text-amber-200/80">{m[1]}</span>
            <span className="text-zinc-600">{m[2]}</span>
          </span>,
        );
      } else {
        parts.push(
          <span key={parts.length} className="text-emerald-300/80">{m[1]}</span>,
        );
      }
    } else if (m[3] !== undefined) {
      parts.push(
        <span key={parts.length} className="text-[#ff8fa3] italic">{m[3]}</span>,
      );
    } else if (m[4] !== undefined) {
      parts.push(
        <span key={parts.length} className="text-[#ff8fa3]">{m[4]}</span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    parts.push(<span key={parts.length} className="text-zinc-600">{line.slice(last)}</span>);
  }
  return <>{parts}</>;
}

export function JsonBlock({ block, streaming }: BlockProps) {
  let text = '';
  const hasData = 'data' in block.data && block.data.data !== undefined;
  const content = str(block.data.content);
  if (content) {
    try {
      text = JSON.stringify(JSON.parse(content), null, 2) ?? content;
    } catch {
      text = content;
    }
  } else if (hasData) {
    try {
      text = JSON.stringify(block.data.data, null, 2) ?? '';
    } catch {
      text = String(block.data.data);
    }
  }
  const lines = text ? text.split('\n') : [];
  const visible = lines.slice(0, LINE_CAP);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {lines.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <>
          <ScrollBox>
            <pre className={cn(monoCls, 'min-w-max py-2 leading-relaxed')}>
              {visible.map((line, i) => (
                <div key={i} className="px-3">
                  <JsonLine line={line} />
                </div>
              ))}
            </pre>
          </ScrollBox>
          {lines.length > LINE_CAP ? <MoreLines count={lines.length - LINE_CAP} /> : null}
        </>
      )}
    </BlockShell>
  );
}

/* ── 44. yaml ────────────────────────────────────────────────────────────── */

/** One YAML line: key amber, value zinc, comments dim. */
function YamlLine({ line }: { line: string }) {
  const m = /^(\s*(?:-\s+)?)([^\s#:-][^:]*)(:)(\s*)(.*)$/.exec(line);
  if (!m) {
    return <span className="text-zinc-500">{line || ' '}</span>;
  }
  const [, indent, key, colon, gap, value] = m;
  return (
    <>
      <span className="text-zinc-600">{indent}</span>
      <span className="text-amber-200/80">{key}</span>
      <span className="text-zinc-600">{colon}</span>
      <span className="text-zinc-600">{gap}</span>
      {value.startsWith('#') ? (
        <span className="text-zinc-600 italic">{value}</span>
      ) : (
        <span className="text-zinc-300">{value}</span>
      )}
    </>
  );
}

export function YamlBlock({ block, streaming }: BlockProps) {
  const content = str(block.data.content);
  const lines = content ? content.split('\n') : [];
  const visible = lines.slice(0, LINE_CAP);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {lines.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <>
          <ScrollBox>
            <pre className={cn(monoCls, 'min-w-max py-2 leading-relaxed')}>
              {visible.map((line, i) => (
                <div key={i} className="px-3">
                  <YamlLine line={line} />
                </div>
              ))}
            </pre>
          </ScrollBox>
          {lines.length > LINE_CAP ? <MoreLines count={lines.length - LINE_CAP} /> : null}
        </>
      )}
    </BlockShell>
  );
}

/* ── 45. csv ─────────────────────────────────────────────────────────────── */

/** Minimal CSV parser — handles quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const CSV_ROW_CAP = 200;

export function CsvBlock({ block, streaming }: BlockProps) {
  const explicitColumns = arr(block.data.columns).map((c) => str(c));
  const explicitRows = arr(block.data.rows).map((r) => arr(r).map((c) => str(c)));
  let columns = explicitColumns;
  let rows = explicitRows;
  if (columns.length === 0 && rows.length === 0) {
    const parsed = parseCsv(str(block.data.content));
    if (parsed.length > 0) {
      columns = parsed[0];
      rows = parsed.slice(1);
    }
  }
  const visible = rows.slice(0, CSV_ROW_CAP);
  const colCount = Math.max(columns.length, ...visible.map((r) => r.length), 0);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {columns.length === 0 && rows.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-white/10">
                {Array.from({ length: colCount }, (_, i) => (
                  <th key={i} className={cn(labelCls, 'whitespace-nowrap px-2.5 py-2 font-normal')}>
                    {columns[i] || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, r) => (
                <tr
                  key={stableKey(r, row[0])}
                  className="border-b border-white/5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] last:border-0 hover:bg-white/[0.02]"
                >
                  {Array.from({ length: colCount }, (_, c) => (
                    <td
                      key={c}
                      className={cn('whitespace-nowrap px-2.5 py-1.5', c === 0 ? 'text-zinc-200' : 'text-zinc-400')}
                    >
                      {row[c] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > CSV_ROW_CAP ? (
            <div className={cn(monoCls, 'px-3 py-2 text-zinc-600')}>+{rows.length - CSV_ROW_CAP} more rows</div>
          ) : null}
        </div>
      )}
    </BlockShell>
  );
}

/* ── 46. terminal ────────────────────────────────────────────────────────── */

export function TerminalBlock({ block, streaming }: BlockProps) {
  const command = str(block.data.command);
  const lines = arr(block.data.lines).map((l) => cellText(l));
  const boxRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom while the agent streams; leave the user's scroll
  // position alone once the block settles.
  useEffect(() => {
    const el = boxRef.current;
    if (el && streaming) el.scrollTop = el.scrollHeight;
  }, [lines, streaming]);

  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      <div className="rounded-xl bg-[#0a0a0b] p-3">
        {command ? (
          <div className={cn(monoCls, 'mb-2 break-all text-emerald-300/90')}>
            <span className="mr-1.5 text-zinc-600">$</span>
            {command}
          </div>
        ) : null}
        <div
          ref={boxRef}
          className="max-h-96 overflow-y-auto custom-scrollbar"
        >
          <pre className={cn(monoCls, 'min-w-max whitespace-pre leading-relaxed text-zinc-300')}>
            {lines.map((line, i) => (
              <div key={stableKey(i, line)} className={cn(anim.rowIn)}>
                {line || ' '}
              </div>
            ))}
            {streaming ? (
              <span className={cn(anim.blink, 'mt-0.5 inline-block h-3.5 w-2 bg-zinc-300 align-middle')} aria-hidden />
            ) : null}
          </pre>
        </div>
      </div>
    </BlockShell>
  );
}

/* ── 47. execution-log ───────────────────────────────────────────────────── */

const LOG_LEVEL_CLS: Record<string, string> = {
  info: 'text-zinc-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
};

export function ExecutionLogBlock({ block, streaming }: BlockProps) {
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    const level = e.level === 'warn' || e.level === 'error' ? e.level : 'info';
    return {
      time: str(e.time),
      text: str(e.text, '…'),
      level,
      keyId: stableKey(i, str(e.text), str(e.time)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {entries.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <div className={cn(monoCls, 'space-y-1 py-2.5 leading-relaxed')}>
            {entries.map((e) => (
              <div key={e.keyId} className={cn(anim.rowIn, 'flex gap-3 px-3')}>
                {e.time ? <span className="shrink-0 text-zinc-600">{e.time}</span> : null}
                <span className={cn('min-w-0 break-all', LOG_LEVEL_CLS[e.level])}>{e.text}</span>
              </div>
            ))}
          </div>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 48. error-output ────────────────────────────────────────────────────── */

export function ErrorOutputBlock({ block, streaming }: BlockProps) {
  const message = str(block.data.message, 'Error');
  const detail = str(block.data.detail);
  const lines = arr(block.data.lines).map((l) => cellText(l));
  return (
    <BlockShell block={block} streaming={streaming} className="border-red-400/25 bg-red-400/[0.04]">
      <div className="flex items-start gap-2.5">
        <CircleX aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1 break-words text-sm font-medium text-red-200">{message}</div>
      </div>
      {detail ? (
        <div className="mt-1.5 break-words pl-[1.6rem] text-xs leading-relaxed text-zinc-500">{detail}</div>
      ) : null}
      {lines.length > 0 ? (
        <div className="mt-2.5 rounded-lg border border-red-400/15 bg-black/40">
          <ScrollBox>
            <pre className={cn(monoCls, 'min-w-max whitespace-pre p-2.5 leading-relaxed text-red-200/80')}>
              {lines.map((line, i) => (
                <div key={stableKey(i, line)} className={cn(anim.rowIn)}>
                  {line || ' '}
                </div>
              ))}
            </pre>
          </ScrollBox>
        </div>
      ) : null}
    </BlockShell>
  );
}

/* ── 49. diff ────────────────────────────────────────────────────────────── */

const DIFF_ROW_CLS: Record<string, string> = {
  context: 'text-zinc-500',
  added: 'bg-emerald-500/[0.08] text-emerald-200',
  removed: 'bg-red-500/[0.08] text-red-200',
};

const DIFF_SIGN: Record<string, string> = { context: ' ', added: '+', removed: '−' };
const DIFF_SIGN_CLS: Record<string, string> = {
  context: 'text-zinc-700',
  added: 'text-emerald-400',
  removed: 'text-red-400',
};

function diffKind(v: unknown): 'context' | 'added' | 'removed' {
  return v === 'added' || v === 'removed' ? v : 'context';
}

export function DiffBlock({ block, streaming }: BlockProps) {
  const filename = str(block.data.filename);
  const lines = arr(block.data.lines).map((raw, i) => {
    const l = rec(raw);
    return { kind: diffKind(l.kind), text: str(l.text), keyId: stableKey(i, str(l.text), diffKind(l.kind)) };
  });
  const additions = num(block.data.additions) ?? lines.filter((l) => l.kind === 'added').length;
  const deletions = num(block.data.deletions) ?? lines.filter((l) => l.kind === 'removed').length;
  const visible = lines.slice(0, LINE_CAP);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {lines.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/5 px-3 py-2">
            <span className={cn(monoCls, 'min-w-0 truncate text-zinc-300')}>{filename || 'diff'}</span>
            <span className={cn(monoCls, 'flex shrink-0 items-center gap-2')}>
              <span className="text-emerald-400">+{additions}</span>
              <span className="text-red-400">−{deletions}</span>
            </span>
          </div>
          <ScrollBox>
            <div className={cn(monoCls, 'min-w-max py-1 leading-5')}>
              {visible.map((l) => (
                <div key={l.keyId} className={cn(anim.rowIn, 'flex items-start px-3', DIFF_ROW_CLS[l.kind])}>
                  <span aria-hidden className={cn('w-4 shrink-0 select-none text-center', DIFF_SIGN_CLS[l.kind])}>
                    {DIFF_SIGN[l.kind]}
                  </span>
                  <span className="whitespace-pre">{l.text || ' '}</span>
                </div>
              ))}
            </div>
          </ScrollBox>
          {lines.length > LINE_CAP ? <MoreLines count={lines.length - LINE_CAP} /> : null}
        </>
      )}
    </BlockShell>
  );
}

/* ── 50. before-after ────────────────────────────────────────────────────── */

function TextPane({ label, content }: { label: string; content: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/5 bg-black/30">
      <div className={cn(labelCls, 'border-b border-white/5 px-3 py-1.5')}>{label}</div>
      <ScrollBox>
        <pre className={cn(monoCls, 'min-w-max whitespace-pre p-3 leading-relaxed text-zinc-300')}>
          {content || '—'}
        </pre>
      </ScrollBox>
    </div>
  );
}

export function BeforeAfterBlock({ block, streaming }: BlockProps) {
  const before = rec(block.data.before);
  const after = rec(block.data.after);
  const language = str(block.data.language);
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <TextPane label={str(before.label, 'Before')} content={str(before.content)} />
        <TextPane
          label={str(after.label, 'After') + (language ? ` · ${language}` : '')}
          content={str(after.content)}
        />
      </div>
    </BlockShell>
  );
}

/* ── 51. changed-files ───────────────────────────────────────────────────── */

const FILE_STATUS: Record<string, { label: string; cls: string }> = {
  modified: { label: 'M', cls: 'border-amber-400/40 bg-amber-400/10 text-amber-300' },
  added: { label: 'A', cls: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' },
  removed: { label: 'D', cls: 'border-red-400/40 bg-red-400/10 text-red-300' },
};

export function ChangedFilesBlock({ block, streaming }: BlockProps) {
  const files = arr(block.data.files).map((raw, i) => {
    const f = rec(raw);
    const status = f.status === 'added' || f.status === 'removed' || f.status === 'modified' ? f.status : 'modified';
    return {
      path: str(f.path, `file-${i}`),
      additions: num(f.additions),
      deletions: num(f.deletions),
      status,
      keyId: stableKey(i, str(f.path)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {files.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <ul className="space-y-1">
            {files.map((f) => {
              const s = FILE_STATUS[f.status];
              return (
                <li
                  key={f.keyId}
                  className={cn(anim.rowIn, 'flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]')}
                >
                  <span
                    aria-hidden
                    className={cn(monoCls, 'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold', s.cls)}
                  >
                    {s.label}
                  </span>
                  <span className={cn(monoCls, 'min-w-0 flex-1 truncate text-zinc-300')} title={f.path}>
                    {f.path}
                  </span>
                  {(f.additions !== undefined || f.deletions !== undefined) && (
                    <span className={cn(monoCls, 'flex shrink-0 items-center gap-1.5')}>
                      {f.additions !== undefined ? <span className="text-emerald-400">+{f.additions}</span> : null}
                      {f.deletions !== undefined ? <span className="text-red-400">−{f.deletions}</span> : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 52. change-summary ──────────────────────────────────────────────────── */

function SummaryChip({ icon, text, cls }: { icon: React.ReactNode; text: string; cls: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]', cls)}>
      {icon}
      {text}
    </span>
  );
}

export function ChangeSummaryBlock({ block, streaming }: BlockProps) {
  const added = num(block.data.added);
  const removed = num(block.data.removed);
  const modified = num(block.data.modified);
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    return {
      path: str(e.path, `file-${i}`),
      change: str(e.change),
      keyId: stableKey(i, str(e.path)),
    };
  });
  const hasCounts = added !== undefined || removed !== undefined || modified !== undefined;
  return (
    <BlockShell block={block} streaming={streaming}>
      {hasCounts ? (
        <div className="flex flex-wrap gap-1.5">
          {added !== undefined ? (
            <SummaryChip
              icon={<Plus aria-hidden className="h-3 w-3" />}
              text={`${added} added`}
              cls="border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
            />
          ) : null}
          {removed !== undefined ? (
            <SummaryChip
              icon={<Minus aria-hidden className="h-3 w-3" />}
              text={`${removed} removed`}
              cls="border-red-400/25 bg-red-400/10 text-red-300"
            />
          ) : null}
          {modified !== undefined ? (
            <SummaryChip
              icon={<FilePenLine aria-hidden className="h-3 w-3" />}
              text={`${modified} modified`}
              cls="border-amber-400/25 bg-amber-400/10 text-amber-300"
            />
          ) : null}
        </div>
      ) : null}
      {entries.length > 0 ? (
        <ScrollBox className={hasCounts ? 'mt-2.5' : undefined}>
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.keyId} className={cn(anim.rowIn, 'flex items-baseline justify-between gap-3 rounded px-1 py-1')}>
                <span className={cn(monoCls, 'min-w-0 truncate text-zinc-300')} title={e.path}>
                  {e.path}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">{e.change}</span>
              </li>
            ))}
          </ul>
        </ScrollBox>
      ) : null}
      {!hasCounts && entries.length === 0 ? <EmptyHint streaming={streaming} /> : null}
    </BlockShell>
  );
}

/* ── 53 + 54. validation / validation-checklist ──────────────────────────── */

function ValidationBlockImpl({ block, streaming }: BlockProps) {
  const results = arr(block.data.results).map((raw, i) => {
    const r = rec(raw);
    return {
      check: str(r.check, `Check ${i + 1}`),
      passed: bool(r.passed),
      detail: str(r.detail),
      keyId: stableKey(i, str(r.check)),
    };
  });
  const passedCount = results.filter((r) => r.passed === true).length;
  return (
    <BlockShell block={block} streaming={streaming}>
      {results.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="space-y-2.5">
          <ScrollBox>
            <ul className="space-y-1.5">
              {results.map((r) => (
                <li key={r.keyId} className={cn(anim.rowIn, 'flex items-start gap-2.5')}>
                  <span className="mt-0.5 shrink-0" aria-hidden>
                    {r.passed === true ? (
                      <CircleCheck className="h-4 w-4 text-emerald-400" />
                    ) : r.passed === false ? (
                      <CircleX className="h-4 w-4 text-red-400" />
                    ) : (
                      <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500 motion-reduce:animate-none" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'break-words text-xs',
                        r.passed === true ? 'text-zinc-300' : r.passed === false ? 'text-red-200' : 'text-zinc-400',
                      )}
                    >
                      {r.check}
                    </div>
                    {r.detail ? (
                      <div className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-600">{r.detail}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollBox>
          <div className={cn(monoCls, 'border-t border-white/5 pt-2 text-zinc-500')}>
            {passedCount}/{results.length} passed
          </div>
        </div>
      )}
    </BlockShell>
  );
}

export const ValidationBlock = ValidationBlockImpl;
export const ValidationChecklistBlock = ValidationBlockImpl;

/* ── 55. processing-progress ─────────────────────────────────────────────── */

const STAGE_ICON_CLS: Record<string, { icon: React.ReactNode; label: string; line?: string }> = {
  done: {
    icon: <CircleCheck aria-hidden className="h-4 w-4 text-emerald-400" />,
    label: 'text-zinc-300',
  },
  active: {
    icon: (
      <LoaderCircle aria-hidden className="h-4 w-4 animate-spin text-[#ef233c] motion-reduce:animate-none" />
    ),
    label: 'text-zinc-100',
    line: 'text-red-300/70',
  },
  pending: {
    icon: (
      <span
        aria-hidden
        className="block h-2.5 w-2.5 rounded-full border border-zinc-700"
      />
    ),
    label: 'text-zinc-600',
  },
  failed: {
    icon: <CircleX aria-hidden className="h-4 w-4 text-red-400" />,
    label: 'text-red-300',
  },
};

function stageStatus(v: unknown): 'pending' | 'active' | 'done' | 'failed' {
  return v === 'active' || v === 'done' || v === 'failed' ? v : 'pending';
}

export function ProcessingProgressBlock({ block, streaming }: BlockProps) {
  const stages = arr(block.data.stages).map((raw, i) => {
    const s = rec(raw);
    return {
      label: str(s.label, `Stage ${i + 1}`),
      status: stageStatus(s.status),
      keyId: stableKey(i, str(s.label)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {stages.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ol>
          {stages.map((s, i) => {
            const view = STAGE_ICON_CLS[s.status];
            return (
              <li key={s.keyId} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">{view.icon}</span>
                  {i < stages.length - 1 ? <span className="w-px flex-1 bg-white/5" /> : null}
                </div>
                <div className={cn('min-w-0 pb-4', i === stages.length - 1 && 'pb-1')}>
                  <div className={cn('text-xs font-medium', view.label)}>{s.label}</div>
                  {s.status === 'active' ? (
                    <div className={cn(monoCls, 'mt-0.5', view.line)}>running…</div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </BlockShell>
  );
}


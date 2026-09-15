'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Copy,
  Check,
  Download,
  ExternalLink,
  Braces,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface XmlViewerProps {
  url: string;          // the file URL (supports HTTP Range requests)
  fileName: string;
  fileSize?: number;    // bytes, when known
}

// ============ Constants ============

const RANGE_LIMIT = 256 * 1024; // first 256 KB
const SEARCH_DEBOUNCE_MS = 200;
const COPY_RESET_MS = 1500;

/** Ghost button style shared by every toolbar control (Red Noir). */
const BTN_CLS =
  'h-8 px-3 rounded-lg bg-white/[0.05] border border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white text-xs flex items-center gap-1.5 transition-all shrink-0 disabled:opacity-40 disabled:pointer-events-none';
const NAV_BTN_CLS =
  'p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:pointer-events-none';

// ============ Syntax highlighting (regex/hand-rolled — no dependencies) ============

type TokenType = 'tag' | 'attr' | 'string' | 'comment' | 'cdata' | 'punct' | 'text';

interface Token {
  type: TokenType;
  text: string;
}

/** State carried across lines so multi-line comments/CDATA highlight correctly. */
interface HighlightState {
  inComment: boolean;
  inCdata: boolean;
}

const TOKEN_CLS: Record<TokenType, string> = {
  tag: 'text-[#ff6b6b]',
  attr: 'text-amber-200',
  string: 'text-emerald-300',
  comment: 'text-zinc-600 italic',
  cdata: 'text-fuchsia-300',
  punct: 'text-zinc-500',
  text: 'text-zinc-300',
};

/** Matches a full tag, tolerating `>` inside quoted attribute values. */
const TAG_RE = /^<(?:[^>"']|"[^"]*"|'[^']*')*>/;
/**
 * Token stream for the conservative pretty-printer: declarations, comments,
 * CDATA, closing tags, opening/self-closing tags, and text runs.
 */
const PRETTY_TOKEN_RE =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/(?:[^>"']|"[^"]*"|'[^']*')*>|<(?:[^>"']|"[^"]*"|'[^']*')*\/?>|[^<]+/g;

/** Color the inside of a single tag: <name attr="value" …> */
function tokenizeTag(tag: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  // Opening punctuation: '<', '</', '<?' or '<!'
  let prefix = '<';
  i = 1;
  const c = tag[i];
  if (c === '/' || c === '!' || c === '?') {
    prefix += c;
    i += 1;
  }
  out.push({ type: 'punct', text: prefix });
  // Element / declaration name
  let name = '';
  while (i < tag.length && !/[\s/>]/.test(tag[i])) {
    name += tag[i];
    i += 1;
  }
  if (name) out.push({ type: 'tag', text: name });
  // Attributes: names, quoted values, punctuation/whitespace runs
  while (i < tag.length) {
    const ch = tag[i];
    if (ch === '"' || ch === "'") {
      const end = tag.indexOf(ch, i + 1);
      const seg = end === -1 ? tag.slice(i) : tag.slice(i, end + 1);
      out.push({ type: 'string', text: seg });
      i += seg.length;
    } else if (/[\w:.\-]/.test(ch)) {
      let word = '';
      while (i < tag.length && /[\w:.\-]/.test(tag[i])) {
        word += tag[i];
        i += 1;
      }
      out.push({ type: 'attr', text: word });
    } else {
      let punct = '';
      while (i < tag.length && !/[\w:.\-]/.test(tag[i]) && tag[i] !== '"' && tag[i] !== "'") {
        punct += tag[i];
        i += 1;
      }
      if (punct) out.push({ type: 'punct', text: punct });
    }
  }
  return out;
}

/**
 * Tokenize one line. Mutates `state` so multi-line comments/CDATA started on
 * this line continue on the next one. Never throws (caller still guards).
 */
function tokenizeLine(line: string, state: HighlightState): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) {
      tokens.push({ type: 'text', text: buf });
      buf = '';
    }
  };

  while (i < line.length) {
    if (state.inComment) {
      const end = line.indexOf('-->', i);
      if (end === -1) {
        tokens.push({ type: 'comment', text: line.slice(i) });
        i = line.length;
      } else {
        tokens.push({ type: 'comment', text: line.slice(i, end + 3) });
        i = end + 3;
        state.inComment = false;
      }
      continue;
    }
    if (state.inCdata) {
      const end = line.indexOf(']]>', i);
      if (end === -1) {
        tokens.push({ type: 'cdata', text: line.slice(i) });
        i = line.length;
      } else {
        tokens.push({ type: 'cdata', text: line.slice(i, end + 3) });
        i = end + 3;
        state.inCdata = false;
      }
      continue;
    }
    if (line.startsWith('<!--', i)) {
      flush();
      const end = line.indexOf('-->', i + 4);
      if (end === -1) {
        tokens.push({ type: 'comment', text: line.slice(i) });
        state.inComment = true;
        i = line.length;
      } else {
        tokens.push({ type: 'comment', text: line.slice(i, end + 3) });
        i = end + 3;
      }
      continue;
    }
    if (line.startsWith('<![CDATA[', i)) {
      flush();
      const end = line.indexOf(']]>', i + 9);
      if (end === -1) {
        tokens.push({ type: 'cdata', text: line.slice(i) });
        state.inCdata = true;
        i = line.length;
      } else {
        tokens.push({ type: 'cdata', text: line.slice(i, end + 3) });
        i = end + 3;
      }
      continue;
    }
    if (line[i] === '<') {
      const rest = line.slice(i);
      const m = TAG_RE.exec(rest);
      if (m) {
        flush();
        tokens.push(...tokenizeTag(m[0]));
        i += m[0].length;
      } else {
        // Unterminated tag (e.g. content cut at the 256 KB boundary) — plain text
        buf += rest;
        i = line.length;
      }
      continue;
    }
    buf += line[i];
    i += 1;
  }
  flush();
  return tokens;
}

/** tokenizeLine with a hard guarantee: falls back to one plain-text token. */
function tokenizeLineSafe(line: string, state: HighlightState): Token[] {
  try {
    return tokenizeLine(line, state);
  } catch {
    return [{ type: 'text', text: line }];
  }
}

// ============ Conservative display-only pretty-printer ============

/**
 * Re-indents by tag depth WITHOUT altering text content: one tag per line,
 * text-only elements (<a>text</a>) kept inline, comments/CDATA/declarations
 * on their own lines. Throws (→ caller falls back to Original) when the
 * tokenizer cannot account for every character, so content is never lost.
 */
function prettyPrintXml(src: string): string {
  const tokens = src.match(PRETTY_TOKEN_RE) ?? [];
  const covered = tokens.reduce((n, t) => n + t.length, 0);
  if (covered !== src.length) {
    throw new Error('pretty-print: token coverage mismatch');
  }
  const out: string[] = [];
  let depth = 0;
  const pad = () => '  '.repeat(Math.max(0, depth));

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('<?') || tok.startsWith('<!--') || tok.startsWith('<![')) {
      // Declaration, comment or CDATA — own line, no depth change
      out.push(pad() + tok);
      continue;
    }
    if (tok.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push(pad() + tok);
      continue;
    }
    if (tok.startsWith('<')) {
      const isDoctype = tok.startsWith('<!');
      const selfClosing = tok.endsWith('/>');
      // Text-only element stays on one line: <name>value</name>
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (
        !isDoctype &&
        !selfClosing &&
        next !== undefined &&
        after !== undefined &&
        !next.startsWith('<') &&
        after.startsWith('</')
      ) {
        const text = next.replace(/\s+/g, ' ').trim();
        if (text) {
          out.push(pad() + tok + text + after);
          i += 2;
          continue;
        }
      }
      out.push(pad() + tok);
      if (!isDoctype && !selfClosing) depth += 1;
      continue;
    }
    // Text node — collapse whitespace; skip pure-whitespace runs
    const text = tok.replace(/\s+/g, ' ').trim();
    if (text) out.push(pad() + text);
  }
  return out.join('\n');
}

/** Net depth change of one line (folding heuristics — display only). */
function lineDepthDelta(line: string): number {
  const tags = line.match(PRETTY_TOKEN_RE) ?? [];
  let delta = 0;
  for (const t of tags) {
    if (t.startsWith('</')) {
      delta -= 1;
    } else if (t.startsWith('<')) {
      // Declarations, comments, CDATA, DOCTYPE and self-closing tags are depth-neutral
      if (t.startsWith('<?') || t.startsWith('<!') || t.endsWith('/>')) continue;
      delta += 1;
    }
  }
  return delta;
}

// ============ Helpers ============

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 10 ? Math.round(kb).toString() : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 10 ? Math.round(mb).toString() : mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb >= 10 ? Math.round(gb).toString() : gb.toFixed(1)} GB`;
}

// ============ Component ============

export function XmlViewer({ url, fileName, fileSize }: XmlViewerProps) {
  const { toast } = useToast();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Fetch state
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | undefined>(undefined);
  const [retryTick, setRetryTick] = useState(0);

  // Viewer state
  const [viewMode, setViewMode] = useState<'pretty' | 'original'>('original');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  // ---- Fetch (first 256 KB via Range; whole file when small) ----
  useEffect(() => {
    let cancelled = false;
    // Deferred so no setState runs synchronously inside the effect body.
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setText(null);
      fetch(url, {
        headers: { Range: `bytes=0-${RANGE_LIMIT - 1}` },
        cache: 'no-store',
      })
        .then(async (res) => {
          // 416 (Range Not Satisfiable) can happen for empty files — fetch plainly.
          if (res.status === 416) {
            res = await fetch(url, { cache: 'no-store' });
          }
          const buf = await res.arrayBuffer();
          if (cancelled) return;
          if (!res.ok) {
            setError(`Server responded ${res.status}`);
            setLoading(false);
            return;
          }
          const decoded = new TextDecoder('utf-8').decode(buf);
          const bytes = buf.byteLength;
          // Total size: Content-Range total, else the fileSize prop
          let total: number | undefined = fileSize;
          const contentRange = res.headers.get('content-range');
          if (contentRange) {
            const m = /\/(\d+)\s*$/.exec(contentRange.trim());
            if (m) total = parseInt(m[1], 10);
          }
          const isTruncated = total !== undefined ? bytes < total : res.status === 206;
          // Default view: Pretty for minified/single-line files
          const newlineCount = (decoded.match(/\n/g) || []).length;
          const tagCount = (decoded.match(/</g) || []).length;
          setViewMode(tagCount > 0 && newlineCount < 0.3 * tagCount ? 'pretty' : 'original');
          setText(decoded);
          setLoadedBytes(bytes);
          setTotalBytes(total);
          setTruncated(isTruncated);
          setCollapsed(new Set());
          setMatchIndex(0);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error && err.message ? err.message : 'Network error';
          setError(msg);
          setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [url, retryTick, fileSize]);

  // ---- Debounced search ----
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // ---- Derived content ----

  // Pretty view: display-only re-indent; silent fallback to the exact original
  const prettyText = useMemo(() => {
    if (!text) return '';
    try {
      return prettyPrintXml(text);
    } catch {
      return text;
    }
  }, [text]);

  const displayLines = useMemo(() => {
    if (!text) return [];
    return (viewMode === 'pretty' ? prettyText : text).split('\n');
  }, [text, viewMode, prettyText]);

  // Tokenized lines (state machine across lines for comments/CDATA)
  const tokenizedLines = useMemo(() => {
    const state: HighlightState = { inComment: false, inCdata: false };
    return displayLines.map((line) => tokenizeLineSafe(line, state));
  }, [displayLines]);

  // Search matches: per-line [start, end] ranges + flat list for navigation
  const matchData = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const rangesByLine = new Map<number, Array<[number, number]>>();
    const flat: Array<{ line: number; start: number }> = [];
    if (q) {
      displayLines.forEach((line, idx) => {
        if (!line) return;
        const lower = line.toLowerCase();
        let at = lower.indexOf(q, 0);
        while (at !== -1) {
          const ranges = rangesByLine.get(idx) ?? [];
          ranges.push([at, at + q.length]);
          rangesByLine.set(idx, ranges);
          flat.push({ line: idx, start: at });
          at = lower.indexOf(q, at + q.length);
        }
      });
    }
    return { rangesByLine, flat, count: flat.length };
  }, [displayLines, debouncedSearch]);

  const matchCount = matchData.count;
  const safeIdx = matchCount > 0 ? ((matchIndex % matchCount) + matchCount) % matchCount : 0;
  const currentMatch = matchCount > 0 ? matchData.flat[safeIdx] : null;

  // Fold structure (Pretty view only): a line is foldable when it opens children
  const foldInfo = useMemo(() => {
    if (viewMode !== 'pretty' || displayLines.length === 0) return null;
    const n = displayLines.length;
    const foldable: boolean[] = new Array(n).fill(false);
    const closeLine: Array<number | null> = new Array(n).fill(null);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      const delta = lineDepthDelta(displayLines[i]);
      if (delta > 0) {
        foldable[i] = true;
        stack.push(i);
      } else if (delta < 0) {
        for (let k = 0; k < -delta && stack.length > 0; k++) {
          const openIdx = stack.pop();
          if (openIdx !== undefined) closeLine[openIdx] = i;
        }
      }
    }
    let count = 0;
    for (let i = 0; i < n; i++) if (foldable[i]) count += 1;
    return { foldable, closeLine, count };
  }, [viewMode, displayLines]);

  // Lines hidden by active folds
  const hiddenLines = useMemo(() => {
    const hidden = new Set<number>();
    if (!foldInfo) return hidden;
    collapsed.forEach((i) => {
      const close = foldInfo.closeLine[i];
      if (close === null || close <= i) return;
      for (let j = i + 1; j <= close; j++) hidden.add(j);
    });
    return hidden;
  }, [collapsed, foldInfo]);

  // ---- Handlers ----

  const handleRetry = () => {
    setRetryTick((t) => t + 1);
  };

  const toggleFold = (lineIdx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(lineIdx)) {
        next.delete(lineIdx);
      } else {
        next.add(lineIdx);
      }
      return next;
    });
  };

  const handleViewToggle = () => {
    setViewMode((m) => (m === 'pretty' ? 'original' : 'pretty'));
    setCollapsed(new Set());
    setMatchIndex(0);
  };

  const handleCollapseAll = () => {
    if (!foldInfo || foldInfo.count === 0) return;
    const next = new Set<number>();
    for (let i = 0; i < foldInfo.foldable.length; i++) {
      if (foldInfo.foldable[i]) next.add(i);
    }
    setCollapsed(next);
  };

  const handleExpandAll = () => {
    setCollapsed(new Set());
  };

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        toast({
          title: 'Copied',
          description: truncated ? 'Loaded portion copied to clipboard' : 'File content copied to clipboard',
        });
        setTimeout(() => setCopied(false), COPY_RESET_MS);
      })
      .catch(() => {
        toast({ title: 'Copy failed', description: 'Clipboard is unavailable', variant: 'destructive' });
      });
  };

  const scrollToLine = (lineNo: number) => {
    bodyRef.current?.querySelector(`[data-line="${lineNo}"]`)?.scrollIntoView({ block: 'center' });
  };

  const jumpTo = (rawIdx: number) => {
    if (matchCount === 0) return;
    const idx = ((rawIdx % matchCount) + matchCount) % matchCount;
    setMatchIndex(idx);
    const target = matchData.flat[idx].line;
    if (viewMode === 'pretty' && hiddenLines.has(target)) {
      // Expand the folded ancestors hiding this match, then scroll once rendered
      setCollapsed((prev) => {
        const next = new Set(prev);
        prev.forEach((i) => {
          const close = foldInfo?.closeLine[i];
          if (close != null && target > i && target <= close) next.delete(i);
        });
        return next;
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToLine(target));
      });
      return;
    }
    scrollToLine(target);
  };

  // ---- Render helpers ----

  /** Token spans for one line, with search matches marked. */
  const renderTokens = (lineIdx: number): React.ReactNode => {
    const tokens = tokenizedLines[lineIdx] ?? [];
    const ranges = matchData.rangesByLine.get(lineIdx);
    const currentStart = currentMatch !== null && currentMatch.line === lineIdx ? currentMatch.start : null;
    if (!ranges || ranges.length === 0) {
      return tokens.map((t, k) => (
        <span key={k} className={TOKEN_CLS[t.type]}>
          {t.text}
        </span>
      ));
    }
    let offset = 0;
    const nodes: React.ReactNode[] = [];
    tokens.forEach((tok, k) => {
      const tokStart = offset;
      const tokEnd = offset + tok.text.length;
      offset = tokEnd;
      const cls = TOKEN_CLS[tok.type];
      const overlapping = ranges.filter(([rs, re]) => rs < tokEnd && re > tokStart);
      if (overlapping.length === 0) {
        nodes.push(
          <span key={k} className={cls}>
            {tok.text}
          </span>,
        );
        return;
      }
      const parts: Array<{ text: string; mark: 'none' | 'match' | 'current' }> = [];
      let cursor = tokStart;
      for (const [rs, re] of overlapping) {
        if (rs > cursor) {
          parts.push({ text: tok.text.slice(cursor - tokStart, rs - tokStart), mark: 'none' });
        }
        const s = Math.max(rs, tokStart);
        const e = Math.min(re, tokEnd);
        parts.push({
          text: tok.text.slice(s - tokStart, e - tokStart),
          mark: currentStart !== null && rs === currentStart ? 'current' : 'match',
        });
        cursor = e;
      }
      if (cursor < tokEnd) {
        parts.push({ text: tok.text.slice(cursor - tokStart), mark: 'none' });
      }
      nodes.push(
        <span key={k} className={cls}>
          {parts.map((p, j) =>
            p.mark === 'none' ? (
              <React.Fragment key={j}>{p.text}</React.Fragment>
            ) : (
              <mark
                key={j}
                className={
                  p.mark === 'current'
                    ? 'bg-[#ef233c]/60 text-inherit rounded'
                    : 'bg-[#ef233c]/30 text-inherit rounded'
                }
              >
                {p.text}
              </mark>
            ),
          )}
        </span>,
      );
    });
    return nodes;
  };

  // ---- Render ----

  // Loading: 6 shimmering skeleton bars
  if (loading) {
    return (
      <div className="w-full bg-black/40 border border-white/5 rounded-xl p-4 space-y-3">
        {[72, 45, 60, 38, 66, 50].map((w, i) => (
          <div key={i} className="h-3 rounded bg-zinc-800 animate-pulse" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  // Fetch failure: honest error panel + retry
  if (error) {
    return (
      <div className="w-full bg-black/40 border border-white/5 rounded-xl p-8 flex flex-col items-center gap-3">
        <AlertTriangle className="w-8 h-8 text-[#ef233c]" />
        <p className="font-inter text-sm text-zinc-400 text-center">
          Couldn&apos;t load this file — {error}
        </p>
        <button onClick={handleRetry} className={BTN_CLS}>
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const truncatedNotice = truncated
    ? `Loaded first ${formatBytes(loadedBytes)}${
        totalBytes !== undefined ? ` of a ${formatBytes(totalBytes)} file` : ''
      } — download for the full contents.`
    : '';

  return (
    <div className="w-full">
      {/* Partial-load notice (large files — first 256 KB fetched) */}
      {truncatedNotice && (
        <div className="flex items-start gap-2 p-2.5 mb-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />
          <p className="text-[11px] font-inter text-amber-400/90 leading-relaxed">{truncatedNotice}</p>
        </div>
      )}

      {/* Viewer body — toolbar pinned to the top of the scroll area */}
      <div
        ref={bodyRef}
        className="max-h-[50vh] overflow-auto custom-scrollbar bg-black/40 border border-white/5 rounded-xl font-mono text-xs leading-5"
      >
        {/* Toolbar (sticky top-left of the scrollport, stays put while code scrolls) */}
        <div className="sticky top-0 left-0 z-20 bg-black/60 backdrop-blur-sm border-b border-white/5 font-manrope px-3 py-2 flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-0 h-8 px-3 rounded-lg bg-white/[0.05] border border-white/5 focus-within:border-[#ef233c]/40 transition-colors">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) {
                    jumpTo(safeIdx - 1);
                  } else {
                    jumpTo(safeIdx + 1);
                  }
                }
              }}
              placeholder="Search…"
              aria-label="Search in file"
              className="flex-1 min-w-0 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none font-inter"
            />
          </div>

          {/* Match count + navigation */}
          {debouncedSearch.trim() !== '' && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-mono text-[10px] text-zinc-500 whitespace-nowrap">
                {matchCount} {matchCount === 1 ? 'match' : 'matches'}
                {truncated ? ' in loaded part' : ''}
              </span>
              <button
                onClick={() => jumpTo(safeIdx - 1)}
                disabled={matchCount === 0}
                title="Previous match (Shift+Enter)"
                className={NAV_BTN_CLS}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => jumpTo(safeIdx + 1)}
                disabled={matchCount === 0}
                title="Next match (Enter)"
                className={NAV_BTN_CLS}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Format toggle */}
          <button onClick={handleViewToggle} className={BTN_CLS} title="Toggle Pretty / Original formatting">
            <Braces className="w-3.5 h-3.5" />
            {viewMode === 'pretty' ? 'Pretty' : 'Original'}
          </button>

          {/* Copy (full loaded text) */}
          <button onClick={handleCopy} disabled={!text} className={BTN_CLS} title="Copy content">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          {/* Download (plain anchor) */}
          <a href={url} download={fileName} className={BTN_CLS} title={`Download ${fileName}`}>
            <Download className="w-3.5 h-3.5" /> Download
          </a>

          {/* Open raw */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={BTN_CLS}
            title="Open raw file in a new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Raw
          </a>

          {/* Collapse all / Expand all (Pretty view only) */}
          {viewMode === 'pretty' && (
            <button
              onClick={collapsed.size > 0 ? handleExpandAll : handleCollapseAll}
              disabled={!foldInfo || foldInfo.count === 0}
              className={BTN_CLS}
              title={collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
            >
              {collapsed.size > 0 ? (
                <ChevronsUpDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronsDownUp className="w-3.5 h-3.5" />
              )}
              {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>

        {/* Code — one row per line, sticky line-number gutter */}
        <div className="min-w-max py-4 pr-4">
          {displayLines.map((line, i) => {
            if (hiddenLines.has(i)) return null;
            const isFoldable = viewMode === 'pretty' && foldInfo !== null && foldInfo.foldable[i] === true;
            const isCollapsed = isFoldable && collapsed.has(i);
            const close = foldInfo !== null ? foldInfo.closeLine[i] : null;
            const isCurrent = currentMatch !== null && currentMatch.line === i;
            return (
              <div
                key={i}
                data-line={i}
                className={`flex items-start${isCurrent ? ' bg-white/[0.03]' : ''}${
                  isFoldable ? ' cursor-pointer hover:bg-white/[0.02]' : ''
                }`}
                onClick={isFoldable ? () => toggleFold(i) : undefined}
                title={isFoldable ? (isCollapsed ? 'Expand section' : 'Collapse section') : undefined}
              >
                <span className="sticky left-0 z-10 w-16 shrink-0 pl-4 pr-3 text-right text-zinc-500 select-none bg-[#0b0b0b]">
                  {i + 1}
                </span>
                <span className="whitespace-pre pr-8">
                  {renderTokens(i)}
                  {isCollapsed && close !== null && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFold(i);
                      }}
                      className="ml-2 inline-flex items-center bg-white/5 hover:bg-white/10 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded font-manrope transition-all"
                    >
                      … {close - i} lines
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

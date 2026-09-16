'use client';

/**
 * Resource UI-block renderers (types 27–41): files, archives, XML inspection
 * and download affordances. RGE Hub is an editing-resources platform (XMLs,
 * ZIPs, images, clips) so these blocks surface what the agent is doing with
 * the user's media. All payload access is defensive — LLM data may be partial.
 */

import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  FileArchive,
  FileCode2,
  FileImage,
  FileText,
  Film,
  Folder,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { anim } from '../elements/surfaces';
import {
  BlockShell,
  EmptyHint,
  ScrollBox,
  arr,
  cellText,
  fmtBytes,
  labelCls,
  monoCls,
  num,
  rec,
  stableKey,
  str,
  useUiBlockActions,
  type BlockProps,
} from './primitives';

/* ── Extension → icon (matches the agent workspace conventions) ──────────── */

/** File glyph by extension — zip/image/clip/code, FileText fallback. */
function FileGlyph({ name, className }: { name: string; className?: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <FileArchive aria-hidden className={className} />;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) return <FileImage aria-hidden className={className} />;
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return <Film aria-hidden className={className} />;
  if (['xml', 'json', 'txt'].includes(ext)) return <FileCode2 aria-hidden className={className} />;
  return <FileText aria-hidden className={className} />;
}

/** One archive/file entry row: icon, name, size right. */
function EntryRow({ name, size, dim }: { name: string; size?: number; dim?: boolean }) {
  const sizeText = fmtBytes(size);
  return (
    <div
      className={cn(
        anim.rowIn,
        'flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]',
      )}
    >
      <FileGlyph name={name} className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
      <span className={cn('min-w-0 flex-1 truncate text-xs', dim ? 'text-zinc-500' : 'text-zinc-300')}>{name}</span>
      {sizeText ? <span className={cn(monoCls, 'shrink-0 text-zinc-600')}>{sizeText}</span> : null}
    </div>
  );
}

/** "+N more" dim overflow row shared by capped lists. */
function MoreRow({ count }: { count: number }) {
  return (
    <div className={cn(monoCls, 'px-1.5 pt-1 text-zinc-600')}>+{count} more</div>
  );
}

/* ── 27. file-card ───────────────────────────────────────────────────────── */

export function FileCardBlock({ block, streaming }: BlockProps) {
  const f = rec(block.data.file);
  const name = str(f.name, 'file');
  const size = num(f.size);
  const path = str(f.path);
  const note = str(block.data.note);
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03]">
          <FileGlyph name={name} className="h-4 w-4 text-zinc-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{name}</div>
          {path ? <div className={cn(monoCls, 'mt-0.5 truncate text-zinc-600')}>{path}</div> : null}
          {note ? <div className="mt-1 text-xs leading-relaxed text-zinc-500">{note}</div> : null}
        </div>
        {size !== undefined ? (
          <span className={cn(monoCls, 'shrink-0 rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-zinc-400')}>
            {fmtBytes(size)}
          </span>
        ) : null}
      </div>
    </BlockShell>
  );
}

/* ── 28. file-list ───────────────────────────────────────────────────────── */

const FILE_LIST_CAP = 50;

export function FileListBlock({ block, streaming }: BlockProps) {
  const files = arr(block.data.files).map((raw, i) => {
    const f = rec(raw);
    return {
      name: str(f.name, `file-${i}`),
      path: str(f.path),
      size: num(f.size),
      keyId: stableKey(i, str(f.name), str(f.path)),
    };
  });
  const visible = files.slice(0, FILE_LIST_CAP);
  return (
    <BlockShell block={block} streaming={streaming}>
      {files.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <div className="space-y-0.5">
            {visible.map((f) => (
              <div key={f.keyId} title={f.path || undefined}>
                <EntryRow name={f.name} size={f.size} />
              </div>
            ))}
            {files.length > FILE_LIST_CAP ? <MoreRow count={files.length - FILE_LIST_CAP} /> : null}
          </div>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 29. folder-tree ─────────────────────────────────────────────────────── */

export function FolderTreeBlock({ block, streaming }: BlockProps) {
  const nodes = arr(block.data.nodes).map((raw, i) => {
    const n = rec(raw);
    return {
      path: str(n.path),
      name: str(n.name, str(n.path, `node-${i}`)),
      depth: clampInt(n.depth),
      kind: n.kind === 'folder' ? 'folder' : 'file',
      size: num(n.size),
      keyId: stableKey(i, str(n.path), str(n.name)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {nodes.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <ul className="space-y-0.5 py-2">
            {nodes.map((n) => {
              const text = n.path || n.name;
              return (
                <li
                  key={n.keyId}
                  style={{ paddingLeft: `${n.depth * 0.85}rem` }}
                  className={cn(anim.rowIn, 'flex items-center gap-2 rounded-md pr-2')}
                >
                  {n.kind === 'folder' ? (
                    <Folder aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  ) : (
                    <FileGlyph name={n.name} className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  )}
                  <span
                    className={cn(
                      monoCls,
                      'min-w-0 flex-1 truncate',
                      n.kind === 'folder' ? 'text-zinc-300' : 'text-zinc-500',
                    )}
                  >
                    {text}
                  </span>
                  {n.kind === 'file' && n.size !== undefined ? (
                    <span className={cn(monoCls, 'shrink-0 text-zinc-600')}>{fmtBytes(n.size)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

function clampInt(v: unknown): number {
  const n = num(v);
  if (n === undefined) return 0;
  return Math.max(0, Math.min(64, Math.trunc(n)));
}

/* ── 30 + 31. zip-contents / archive-preview ─────────────────────────────── */

const ZIP_CAP = 100;

export function ZipContentsBlock({ block, streaming }: BlockProps) {
  const archive = str(block.data.archive);
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    return {
      name: str(e.name, `entry-${i}`),
      size: num(e.size),
      keyId: stableKey(i, str(e.name)),
    };
  });
  const visible = entries.slice(0, ZIP_CAP);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {entries.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-3 pb-2">
            {archive ? (
              <span className={cn(monoCls, 'min-w-0 truncate text-zinc-500')}>{archive}</span>
            ) : (
              <span className={labelCls}>Archive</span>
            )}
            <span
              className={cn(
                monoCls,
                'shrink-0 text-zinc-400',
                streaming && 'animate-pulse motion-reduce:animate-none',
              )}
              style={streaming ? { animationDuration: '1.5s' } : undefined}
            >
              {entries.length} files
            </span>
          </div>
          <ScrollBox>
            <div className="space-y-0.5">
              {visible.map((e) => (
                <EntryRow key={e.keyId} name={e.name} size={e.size} />
              ))}
              {entries.length > ZIP_CAP ? <MoreRow count={entries.length - ZIP_CAP} /> : null}
            </div>
          </ScrollBox>
        </div>
      )}
    </BlockShell>
  );
}

/* ── 32. extraction-result ───────────────────────────────────────────────── */

export function ExtractionResultBlock({ block, streaming }: BlockProps) {
  const archive = str(block.data.archive, 'archive');
  const dest = str(block.data.dest);
  const count = num(block.data.count) ?? arr(block.data.files).length;
  const files = arr(block.data.files).map((raw, i) => {
    const f = rec(raw);
    return {
      name: str(f.name, `file-${i}`),
      size: num(f.size),
      keyId: stableKey(i, str(f.name)),
    };
  });
  const visible = files.slice(0, FILE_LIST_CAP);
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="flex items-center gap-2 pb-1">
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-400/90" />
        <span className={cn(monoCls, 'min-w-0 flex-1 truncate text-zinc-300')}>{archive}</span>
        {dest ? (
          <>
            <ArrowRight aria-hidden className="h-3 w-3 shrink-0 text-zinc-600" />
            <span className={cn(monoCls, 'min-w-0 max-w-[45%] truncate text-zinc-500')}>{dest}</span>
          </>
        ) : null}
      </div>
      <div className={cn(monoCls, 'pb-2 text-zinc-600')}>
        {count} file{count === 1 ? '' : 's'} extracted
      </div>
      {files.length === 0 ? (
        streaming ? <EmptyHint streaming /> : null
      ) : (
        <ScrollBox>
          <div className="space-y-0.5">
            {visible.map((f) => (
              <EntryRow key={f.keyId} name={f.name} size={f.size} dim />
            ))}
            {files.length > FILE_LIST_CAP ? <MoreRow count={files.length - FILE_LIST_CAP} /> : null}
          </div>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 33. xml-tree ────────────────────────────────────────────────────────── */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

function coerceXmlNode(v: unknown): XmlNode {
  const r = rec(v);
  const rawAttrs = rec(r.attrs);
  const attrs: Record<string, string> = {};
  for (const [k, val] of Object.entries(rawAttrs)) {
    attrs[k] = str(val);
  }
  return {
    tag: str(r.tag, 'node'),
    attrs,
    text: str(r.text),
    children: arr(r.children).map(coerceXmlNode),
  };
}

const XML_CHILD_CAP = 200;
const XML_ATTR_CAP = 20;
const XML_DEPTH_CAP = 64;

/** One `<tag attr="v">` mono row — red-tinted tag, dim attrs, quoted text. */
function XmlNodeRow({ node, depth }: { node: XmlNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const attrs = Object.entries(node.attrs);
  const visibleAttrs = attrs.slice(0, XML_ATTR_CAP);
  const visibleChildren = node.children.slice(0, XML_CHILD_CAP);
  const beyondDepth = depth >= XML_DEPTH_CAP;

  if (beyondDepth) {
    return (
      <div className={cn(monoCls, 'py-0.5 text-zinc-600')}>… deeper levels folded</div>
    );
  }

  const header = (
    <span className={cn(monoCls, 'min-w-0 break-all leading-relaxed')}>
      <span className="text-zinc-600">&lt;</span>
      <span className="text-[#ff6b6b]">{node.tag}</span>
      {visibleAttrs.map(([k, v]) => (
        <span key={k}>
          {' '}
          <span className="text-amber-200/60">{k}</span>
          <span className="text-zinc-600">=</span>
          <span className="text-emerald-300/80">&quot;{v}&quot;</span>
        </span>
      ))}
      {attrs.length > XML_ATTR_CAP ? (
        <span className="text-zinc-600"> +{attrs.length - XML_ATTR_CAP} attrs</span>
      ) : null}
      {!hasChildren && node.text ? (
        <span className="text-emerald-300/80"> {`"${node.text}"`}</span>
      ) : null}
      <span className="text-zinc-600">{hasChildren ? '>' : ' />'}</span>
    </span>
  );

  if (!hasChildren) {
    return <div className={cn(anim.rowIn, 'py-0.5 pl-3')}>{header}</div>;
  }

  return (
    <div className={cn(anim.rowIn, 'py-0.5')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-1 rounded px-1 py-0.5 text-left transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'mt-0.5 h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
            open && 'rotate-90',
          )}
        />
        {header}
      </button>
      {open ? (
        <div className="ml-[1.1rem] border-l border-white/5 pl-2">
          {node.text ? (
            <div className={cn(monoCls, 'py-0.5 text-emerald-300/80')}>{`"${node.text}"`}</div>
          ) : null}
          {visibleChildren.map((child, i) => (
            <XmlNodeRow key={stableKey(i, child.tag)} node={child} depth={depth + 1} />
          ))}
          {node.children.length > XML_CHILD_CAP ? (
            <div className={cn(monoCls, 'py-0.5 text-zinc-600')}>+{node.children.length - XML_CHILD_CAP} more</div>
          ) : null}
          <div className={cn(monoCls, 'py-0.5 text-zinc-600')}>
            <span>&lt;/</span>
            <span className="text-[#ff6b6b]">{node.tag}</span>
            <span>&gt;</span>
          </div>
        </div>
      ) : (
        <div className={cn(monoCls, 'pl-[1.35rem] text-zinc-600')}>… {node.children.length} children collapsed</div>
      )}
    </div>
  );
}

export function XmlTreeBlock({ block, streaming }: BlockProps) {
  const root = coerceXmlNode(block.data.root);
  const empty = root.tag === 'node' && !root.text && root.children.length === 0 && Object.keys(root.attrs).length === 0;
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {empty ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <div className="py-2 pr-3">
            <XmlNodeRow node={root} depth={0} />
          </div>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 34 + 35. xml-preview / xml ──────────────────────────────────────────── */

const PREVIEW_LINE_CAP = 400;

/** Light two-tone XML line: tag segments red-tinted, text dim. */
function XmlLine({ line }: { line: string }) {
  const parts = line.split(/(<[^>]*>)/g).filter((p) => p.length > 0);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('<') ? (
          <span key={i} className="text-[#ff6b6b]/90">
            {part}
          </span>
        ) : (
          <span key={i} className="text-zinc-400">
            {part}
          </span>
        ),
      )}
    </>
  );
}

function XmlPreviewBlockImpl({ block, streaming }: BlockProps) {
  const filename = str(block.data.filename);
  const content = str(block.data.content);
  const lines = content ? content.split('\n') : [];
  const visible = lines.slice(0, PREVIEW_LINE_CAP);
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {lines.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <>
          {filename ? (
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
              <FileCode2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className={cn(monoCls, 'min-w-0 truncate text-zinc-300')}>{filename}</span>
              <span className={cn(monoCls, 'ml-auto shrink-0 text-zinc-600')}>{lines.length} lines</span>
            </div>
          ) : null}
          <ScrollBox>
            <pre className={cn(monoCls, 'min-w-max py-2 pr-3 leading-relaxed')}>
              {visible.map((line, i) => (
                <div key={i} className="px-3">
                  <XmlLine line={line} />
                </div>
              ))}
            </pre>
          </ScrollBox>
          {lines.length > PREVIEW_LINE_CAP ? (
            <div className={cn(monoCls, 'border-t border-white/5 px-3 py-2 text-zinc-600')}>
              … {lines.length - PREVIEW_LINE_CAP} more lines
            </div>
          ) : null}
        </>
      )}
    </BlockShell>
  );
}

export const XmlPreviewBlock = XmlPreviewBlockImpl;
export const XmlBlock = XmlPreviewBlockImpl;

/* ── 36. xml-attributes ──────────────────────────────────────────────────── */

export function XmlAttributesBlock({ block, streaming }: BlockProps) {
  const tag = str(block.data.tag);
  const attributes = arr(block.data.attributes).map((raw, i) => {
    const a = rec(raw);
    return {
      key: str(a.key, `attr${i}`),
      value: str(a.value),
      keyId: stableKey(i, str(a.key)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming}>
      {tag ? (
        <div className={cn(monoCls, 'pb-2')}>
          <span className="text-zinc-600">&lt;</span>
          <span className="text-[#ff6b6b]">{tag}</span>
          <span className="text-zinc-600">&gt;</span>
          <span className="ml-2 text-zinc-600">attributes</span>
        </div>
      ) : (
        <div className={cn(labelCls, 'pb-2')}>Attributes</div>
      )}
      {attributes.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
          <dl className="divide-y divide-white/5">
            {attributes.map((a) => (
              <div key={a.keyId} className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className={cn(monoCls, 'shrink-0 text-amber-200/70')}>{a.key}</dt>
                <dd className={cn(monoCls, 'min-w-0 break-all text-right text-emerald-300/80')}>{`"${a.value}"`}</dd>
              </div>
            ))}
          </dl>
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 37. xml-node ────────────────────────────────────────────────────────── */

export function XmlNodeBlock({ block, streaming }: BlockProps) {
  const tag = str(block.data.tag, 'node');
  const path = str(block.data.path);
  const attributes = arr(block.data.attributes).map((raw, i) => {
    const a = rec(raw);
    return { key: str(a.key, `attr${i}`), value: str(a.value), keyId: stableKey(i, str(a.key)) };
  });
  const text = str(block.data.text);
  const childrenCount = num(block.data.childrenCount);
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className={cn(monoCls, 'break-all')}>
        <span className="text-zinc-600">&lt;</span>
        <span className="text-[#ff6b6b]">{tag}</span>
        <span className="text-zinc-600">&gt;</span>
      </div>
      {path ? <div className={cn(monoCls, 'mt-1 truncate text-zinc-600')}>{path}</div> : null}
      {attributes.length > 0 ? (
        <ScrollBox className="mt-2">
          <div className="divide-y divide-white/5 rounded-lg border border-white/5 bg-black/20">
            {attributes.map((a) => (
              <div key={a.keyId} className="flex items-baseline justify-between gap-4 px-2.5 py-1.5">
                <span className={cn(monoCls, 'shrink-0 text-amber-200/70')}>{a.key}</span>
                <span className={cn(monoCls, 'min-w-0 break-all text-right text-zinc-300')}>{a.value}</span>
              </div>
            ))}
          </div>
        </ScrollBox>
      ) : null}
      {text ? (
        <div className="mt-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5">
          <span className={cn(monoCls, 'break-all text-emerald-300/80')}>{`"${text}"`}</span>
        </div>
      ) : null}
      {childrenCount !== undefined ? (
        <div className="mt-2">
          <span className={cn(monoCls, 'rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-zinc-400')}>
            {childrenCount} children
          </span>
        </div>
      ) : null}
    </BlockShell>
  );
}

/* ── 38. resource-metadata ───────────────────────────────────────────────── */

export function ResourceMetadataBlock({ block, streaming }: BlockProps) {
  const title = str(block.data.title);
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    return {
      key: str(e.key, '—'),
      value: cellText(e.value),
      mono: e.mono === true,
      keyId: stableKey(i, str(e.key)),
    };
  });
  return (
    <BlockShell
      block={block}
      streaming={streaming}
      className="border-[#ef233c]/15 bg-[#ef233c]/[0.02]"
    >
      {title ? (
        <div className={cn(labelCls, 'pb-2 text-red-300/70')}>{title}</div>
      ) : null}
      {entries.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <ScrollBox>
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
        </ScrollBox>
      )}
    </BlockShell>
  );
}

/* ── 39. resource-comparison ─────────────────────────────────────────────── */

export function ResourceComparisonBlock({ block, streaming }: BlockProps) {
  const entries = arr(block.data.entries).map((raw, i) => {
    const e = rec(raw);
    return {
      key: str(e.key, '—'),
      base: cellText(e.base),
      modified: cellText(e.modified),
      changed: e.changed === true,
      keyId: stableKey(i, str(e.key)),
    };
  });
  return (
    <BlockShell block={block} streaming={streaming} padded={false}>
      {entries.length === 0 ? (
        <EmptyHint streaming={streaming} />
      ) : (
        <div className="overflow-x-auto custom-scrollbar">
          <div className="min-w-max p-3">
            <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)] gap-x-4 border-b border-white/10 pb-2">
              <span className={labelCls}>Field</span>
              <span className={labelCls}>Base</span>
              <span className={labelCls}>Modified</span>
            </div>
            <div className="divide-y divide-white/5">
              {entries.map((e) => (
                <div
                  key={e.keyId}
                  className={cn(
                    anim.rowIn,
                    'grid grid-cols-[minmax(7rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)] gap-x-4 rounded px-1 py-1.5 transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
                    e.changed && 'bg-[#ef233c]/[0.06]',
                  )}
                >
                  <span className="truncate text-xs text-zinc-300" title={e.key}>
                    {e.key}
                  </span>
                  <span className={cn(monoCls, 'truncate text-zinc-500')} title={e.base}>
                    {e.base || '—'}
                  </span>
                  <span
                    className={cn(monoCls, 'truncate', e.changed ? 'text-red-200' : 'text-zinc-200')}
                    title={e.modified}
                  >
                    {e.modified || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </BlockShell>
  );
}

/* ── 40. generated-file ──────────────────────────────────────────────────── */

export function GeneratedFileBlock({ block, streaming }: BlockProps) {
  const actions = useUiBlockActions();
  const f = rec(block.data.file);
  const name = str(f.name, 'file');
  const path = str(f.path);
  const size = num(f.size);
  const note = str(block.data.note);
  const canDownload = !!path && !!actions.downloadFile;
  return (
    <BlockShell
      block={block}
      streaming={streaming}
      className="border-emerald-400/25 bg-emerald-400/[0.04] hover:bg-emerald-400/[0.06]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-400/10">
          <Check aria-hidden className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn(labelCls, 'text-emerald-300/70')}>Generated</div>
          <div className="mt-1 truncate text-sm font-medium text-zinc-100">{name}</div>
          {path ? <div className={cn(monoCls, 'mt-0.5 truncate text-zinc-500')}>{path}</div> : null}
          {note ? <div className="mt-1 text-xs leading-relaxed text-zinc-400">{note}</div> : null}
          {size !== undefined ? (
            <div className={cn(monoCls, 'mt-1 text-zinc-600')}>{fmtBytes(size)}</div>
          ) : null}
          {path ? (
            <button
              type="button"
              disabled={!canDownload}
              onClick={() => actions.downloadFile?.(path)}
              className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 text-xs text-emerald-300 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-emerald-400/20 disabled:pointer-events-none disabled:opacity-40"
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              Download
            </button>
          ) : null}
        </div>
      </div>
    </BlockShell>
  );
}

/* ── 41. download ────────────────────────────────────────────────────────── */

export function DownloadBlock({ block, streaming }: BlockProps) {
  const actions = useUiBlockActions();
  const path = str(block.data.path);
  const label = str(block.data.label, 'Download file');
  const note = str(block.data.note);
  return (
    <BlockShell block={block} streaming={streaming}>
      <div className="space-y-2">
        {note ? <div className="text-xs leading-relaxed text-zinc-500">{note}</div> : null}
        <button
          type="button"
          disabled={!path || !actions.downloadFile}
          onClick={() => path && actions.downloadFile?.(path)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#ef233c] px-4 text-sm font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#d61e33] disabled:pointer-events-none disabled:opacity-40"
        >
          <Download aria-hidden className="h-4 w-4" />
          {label}
        </button>
        {path ? <div className={cn(monoCls, 'truncate text-center text-zinc-600')}>{path}</div> : null}
      </div>
    </BlockShell>
  );
}

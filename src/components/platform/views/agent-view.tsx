/**
 * RGE Agent view — the multi-round AI agent chat with a REAL web container.
 *
 * Layout (inside the platform shell, next to the main left sidebar):
 *   ┌───────────────────────────────────────┬──────────────────┐
 *   │  chat timeline (streaming)            │  workspace       │
 *   │  · thinking panels                    │  explorer        │
 *   │  · ONE agent-activity card            │  + container     │
 *   │  · structured UI blocks (60 types)    │    status        │
 *   │  · live terminal exec blocks          │  (toggleable)    │
 *   │  composer (send / stop)               │                  │
 *   └───────────────────────────────────────┴──────────────────┘
 *
 * The agent engine runs in the browser: text, tool activity and structured
 * UI render in the EXACT stream order; the workspace is the per-chat web
 * container (Pyodide) whose files appear here live.
 */
'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Bot,
  Send,
  Square,
  RotateCcw,
  PanelRightOpen,
  PanelRightClose,
  FileText,
  FileCode2,
  FileArchive,
  FileImage,
  Film,
  Trash2,
  Download,
  Folder,
  FolderOpen,
  Settings2,
  Sparkles,
  X,
  Check,
  Loader2,
  ChevronRight,
  Search,
  RefreshCw,
  Box,
  CircleAlert,
} from 'lucide-react';
import { useAgentStore, liveToolCalls, type LiveTurn } from '@/lib/agent-store';
import type { AgentMessage, AssistantSegment } from '@/lib/agent/types';
import type { ContainerFileNode } from '@/lib/agent/container-types';
import { getContainer, sanitizeWsId } from '@/lib/agent/container-client';
import { UIBlockHost, UiBlockActionsContext } from '@/components/agent/ui-blocks';
import { Markdown } from '@/components/agent/markdown';
import {
  AgentPlan,
  TodoList,
  StoppedRun,
  ThinkingReasoning,
  ShimmerLabel,
  Collapse,
} from '@/components/agent/elements';

// ────────────────────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileIconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) return FileImage;
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return Film;
  if (['xml', 'json', 'txt', 'csv', 'md', 'srt', 'vtt', 'edl'].includes(ext)) return FileCode2;
  return FileText;
}

const TEXT_EXTS = ['xml', 'json', 'txt', 'csv', 'md', 'yaml', 'yml', 'srt', 'vtt', 'edl', 'py', 'js', 'ts', 'ini', 'cfg', 'log'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];

function previewKindFor(name: string): 'text' | 'image' | 'zip' | 'binary' {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'zip') return 'zip';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'binary';
}

/** A friendly label + chip query for each tool call. */
function toolDisplay(tc: { name: string; args: Record<string, unknown> }): { label: string; query: string } {
  const a = tc.args || {};
  const str = (k: string) => String(a[k] || '');
  switch (tc.name) {
    case 'set_plan':
      return { label: 'Plan the work', query: `${(a.steps as string[])?.length ?? 0} steps` };
    case 'write_todos':
      return { label: 'Track todos', query: `${(a.items as unknown[])?.length ?? 0} items` };
    case 'emit_ui':
      return { label: 'Render UI', query: str('uiType') };
    case 'hub_list_resources':
      return { label: 'List hub resources', query: str('type') || 'all' };
    case 'hub_fetch_resource':
      return { label: 'Fetch resource', query: str('resourceId') };
    case 'workspace_list':
      return { label: 'List workspace', query: str('path') || 'root' };
    case 'workspace_read':
      return { label: 'Read file', query: str('path') };
    case 'workspace_write':
      return { label: 'Write file', query: str('path') };
    case 'workspace_edit':
      return { label: 'Edit file', query: str('path') };
    case 'workspace_delete':
      return { label: 'Delete', query: str('path') };
    case 'workspace_mkdir':
      return { label: 'Make directory', query: str('path') };
    case 'workspace_extract_zip':
      return { label: 'Extract archive', query: str('path') };
    case 'workspace_create_zip':
      return { label: 'Create archive', query: str('dest') };
    case 'workspace_search':
      return { label: 'Search workspace', query: String(a.query || '').slice(0, 40) };
    case 'workspace_file_info':
      return { label: 'File info', query: str('path') };
    case 'execute_code':
      return { label: 'Run code', query: a.file ? str('file') : 'python' };
    case 'run_terminal':
      return { label: 'Terminal', query: str('command').slice(0, 40) };
    case 'update_resource':
      return { label: 'Update resource', query: str('resourceId') };
    case 'speedramp_clip':
      return { label: 'Speed ramp clip', query: str('resourceId') };
    // legacy names (old chats)
    case 'fetch_resource':
      return { label: 'Fetch resource', query: str('resourceId') };
    case 'read_file':
      return { label: 'Read file', query: str('path') };
    case 'write_file':
      return { label: 'Write file', query: str('path') };
    case 'edit_file':
      return { label: 'Edit file', query: str('path') };
    case 'list_files':
      return { label: 'List workspace', query: 'files' };
    case 'delete_file':
      return { label: 'Delete file', query: str('path') };
    case 'unzip_file':
      return { label: 'Unzip archive', query: str('path') };
    case 'zip_files':
      return { label: 'Zip files', query: str('dest') };
    default:
      return { label: tc.name, query: '' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tool activity row — ONE plain line per call: status icon + "Ran <tool_name>".
// No specialized per-tool cards, no request/result disclosures — the details
// live in the structured UI blocks (terminal/diff/table) the agent emits.
// ────────────────────────────────────────────────────────────────────────────

function ActivityRow({ tc }: { tc: ActivityCall }) {
  if (tc.status === 'running') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5" data-slot="tool-row" data-status="running">
        <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-[#ef233c]" />
        <span className="min-w-0 truncate font-mono text-[12.5px] text-zinc-200">
          Ran <span className="text-zinc-400">{tc.name}</span>
        </span>
      </div>
    );
  }
  if (tc.status === 'error') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5" data-slot="tool-row" data-status="error" title={tc.result?.slice(0, 300) || 'failed'}>
        <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-red-400" />
        <span className="min-w-0 truncate font-mono text-[12.5px] text-red-300">
          Ran <span className="text-red-200/80">{tc.name}</span>
        </span>
        <span className="ml-auto shrink-0 text-[10px] font-manrope uppercase tracking-[0.12em] text-red-400/80">
          failed
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5" data-slot="tool-row" data-status="ok" title={tc.result?.slice(0, 300) || undefined}>
      <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-400/90" />
      <span className="min-w-0 truncate font-mono text-[12.5px] text-zinc-300">
        Ran <span className="text-zinc-500">{tc.name}</span>
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tool activity — THE single unified component for a whole agent run.
// ────────────────────────────────────────────────────────────────────────────

interface ActivityCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'ok' | 'error';
  result?: string;
  meta?: any;
}

function ToolActivityBlock({
  calls,
  streaming,
  defaultOpen = false,
}: {
  calls: ActivityCall[];
  /** True while the owning run is still in progress. */
  streaming: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(streaming ? true : defaultOpen);
  const prevStreaming = useRef(streaming);

  useEffect(() => {
    if (prevStreaming.current !== streaming) {
      prevStreaming.current = streaming;
      queueMicrotask(() => setOpen(streaming));
    }
  }, [streaming]);

  if (calls.length === 0) return null;

  const runningCall = calls.find((c) => c.status === 'running');
  const failed = calls.some((c) => c.status === 'error');
  const activeLabel = runningCall ? `${toolDisplay(runningCall).label}…` : 'Agent activity';

  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden"
      data-slot="tool-activity"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/[0.03]"
      >
        <ChevronRight
          aria-hidden
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            open ? 'rotate-90' : ''
          }`}
        />
        {streaming && runningCall ? (
          <ShimmerLabel className="min-w-0 truncate text-sm">{activeLabel}</ShimmerLabel>
        ) : (
          <span className="min-w-0 truncate text-sm font-manrope text-zinc-200">Agent activity</span>
        )}
        <span className="ml-2 shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
          {calls.length} {calls.length === 1 ? 'call' : 'calls'}
        </span>
        <span className="ml-auto shrink-0 flex items-center">
          {streaming && runningCall ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-[#ef233c]" />
          ) : failed ? (
            <X aria-hidden className="h-3.5 w-3.5 text-red-400" />
          ) : (
            <Check aria-hidden className="h-3.5 w-3.5 text-emerald-400/90" />
          )}
        </span>
      </button>

      <Collapse open={open}>
        <div className="space-y-0.5 border-t border-white/5 px-2 pt-2 pb-2">
          {calls.map((tc) => (
            <ActivityRow key={tc.id} tc={tc} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Message renderers
// ────────────────────────────────────────────────────────────────────────────

function UserBubble({ message }: { message: AgentMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#ef233c]/15 border border-[#ef233c]/25 px-4 py-2.5 text-sm text-white whitespace-pre-wrap break-words">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: AgentMessage }) {
  const hasReasoning = !!message.reasoning?.trim();
  // Preserve the recorded execution timeline. Legacy messages (persisted
  // before segments existed) fall back to one activity box + trailing text.
  const segments: AssistantSegment[] =
    message.segments && message.segments.length > 0
      ? message.segments
      : [
          ...(message.toolCalls && message.toolCalls.length > 0
            ? [
                {
                  kind: 'tools' as const,
                  id: `${message.id}_tools`,
                  calls: message.toolCalls,
                },
              ]
            : []),
          ...(message.content
            ? [{ kind: 'text' as const, id: `${message.id}_text`, text: message.content }]
            : []),
        ];
  return (
    <div className="space-y-3">
      {hasReasoning && (
        <ThinkingReasoning
          sentences={(message.reasoning || '').split(/(?<=[.!?])\s+/).filter(Boolean)}
          phase="done"
          elapsedMs={Math.max(1000, (message.reasoning || '').length * 12)}
        />
      )}
      {segments.map((seg) => {
        if (seg.kind === 'text') {
          return seg.text ? <Markdown key={seg.id} text={seg.text} /> : null;
        }
        if (seg.kind === 'tools') {
          return <ToolActivityBlock key={seg.id} calls={seg.calls} streaming={false} />;
        }
        return <UIBlockHost key={seg.id} block={seg.block} streaming={false} />;
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Live streaming block (the turn in progress)
// ────────────────────────────────────────────────────────────────────────────

function TextSegmentView({ text, active }: { text: string; active: boolean }) {
  return (
    <div>
      <Markdown text={text} />
      {active && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 animate-pulse rounded-[1px] bg-[#ef233c]"
        />
      )}
    </div>
  );
}

function LiveTurnBlock({
  live,
  streaming,
}: {
  live: LiveTurn;
  streaming: boolean;
}) {
  const calls = liveToolCalls(live);
  const showLoader = live.timeline.length === 0 && !live.error;
  const lastIdx = live.timeline.length - 1;
  return (
    <div className="space-y-3">
      {live.reasoning && (
        <ThinkingReasoning
          sentences={live.reasoningSentences}
          phase={streaming ? 'thinking' : 'done'}
          elapsedMs={Date.now() - live.startedAt}
        />
      )}

      {live.plan && live.plan.steps.length > 0 && (
        <AgentPlan
          steps={live.plan.steps}
          activeIndex={
            streaming
              ? Math.min(live.plan.activeIndex + calls.length, live.plan.steps.length)
              : live.plan.steps.length
          }
        />
      )}

      {live.todos && live.todos.length > 0 && <TodoList items={live.todos} />}

      {/* The run timeline, rendered EXACTLY in the order the stream produced
          it: text segments, the single tool-activity component and structured
          UI blocks interleaved. */}
      {live.timeline.map((seg, i) => {
        if (seg.kind === 'text') {
          return <TextSegmentView key={seg.id} text={seg.text} active={streaming && i === lastIdx} />;
        }
        if (seg.kind === 'tools') {
          return <ToolActivityBlock key={seg.id} calls={seg.calls} streaming={streaming} />;
        }
        const block = live.blocks[seg.blockId];
        return block ? (
          <UIBlockHost key={seg.id} block={block} streaming={streaming && block.status === 'streaming'} />
        ) : null;
      })}

      {/* Basic thinking text — a plain, quiet line while the agent has
          nothing to show yet (no dot matrix, no status pill). */}
      {showLoader && streaming && !live.reasoning && (
        <p className="py-1 text-sm text-zinc-500 animate-pulse" data-slot="thinking-text">
          {live.statusLabel || 'Thinking'}…
        </p>
      )}

      {live.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-300">
          {live.error}
        </div>
      )}

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Workspace explorer (right sidebar) — the per-chat web container filesystem
// ────────────────────────────────────────────────────────────────────────────

interface PreviewState {
  path: string;
  name: string;
  kind: 'text' | 'image' | 'zip' | 'binary';
  loading: boolean;
  content?: string;
  truncated?: boolean;
  url?: string;
  entries?: { name: string; size: number }[];
  error?: string;
}

function WorkspaceExplorer({
  nodes,
  loading,
  status,
}: {
  nodes: ContainerFileNode[];
  loading: boolean;
  status: string;
}) {
  const activeChatId = useAgentStore((s) => s.activeChatId);
  const deleteFile = useAgentStore((s) => s.deleteWorkspaceFile);
  const downloadFile = useAgentStore((s) => s.downloadWorkspaceFile);
  const loadWorkspace = useAgentStore((s) => s.loadWorkspace);

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const ws = activeChatId ? sanitizeWsId(activeChatId) : 'draft';

  const openPreview = useCallback(
    async (node: ContainerFileNode) => {
      const kind = previewKindFor(node.name);
      setPreview({ path: node.path, name: node.name, kind, loading: true });
      const container = getContainer();
      try {
        if (kind === 'text') {
          const r = await container.read(ws, node.path, 131072);
          setPreview((p) =>
            p && p.path === node.path
              ? { ...p, loading: false, content: r.content ?? '(binary file — download to view)', truncated: r.truncated }
              : p
          );
        } else if (kind === 'image') {
          const buf = await container.readBytes(ws, node.path);
          const url = URL.createObjectURL(new Blob([buf]));
          setPreview((p) => (p && p.path === node.path ? { ...p, loading: false, url } : p));
        } else if (kind === 'zip') {
          const r = await container.zipList(ws, node.path);
          setPreview((p) => (p && p.path === node.path ? { ...p, loading: false, entries: r.entries.slice(0, 500) } : p));
        } else {
          setPreview((p) => (p && p.path === node.path ? { ...p, loading: false } : p));
        }
      } catch (err) {
        setPreview((p) =>
          p && p.path === node.path
            ? { ...p, loading: false, error: err instanceof Error ? err.message : 'Failed to load file.' }
            : p
        );
      }
    },
    [ws]
  );

  const closePreview = useCallback(() => {
    setPreview((p) => {
      if (p?.url) URL.revokeObjectURL(p.url);
      return null;
    });
  }, []);

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Search filter + collapsed-folder filtering.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes.filter((n) => {
      if (q && !n.path.toLowerCase().includes(q)) return false;
      if (q) return true; // search shows everything matching, ignoring collapse
      // hide nodes whose ancestor folder is collapsed
      const parts = n.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (collapsed.has(parts.slice(0, i).join('/'))) return false;
      }
      return true;
    });
  }, [nodes, search, collapsed]);

  return (
    <>
      {/* Toolbar */}
      <div className="px-3 py-2.5 space-y-2 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-2 py-1.5 focus-within:border-white/20 transition-colors">
            <Search className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspace…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-zinc-200 placeholder:text-zinc-600"
              aria-label="Search workspace"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-zinc-600 hover:text-zinc-300" aria-label="Clear search">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={() => void loadWorkspace()}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
            title="Refresh workspace"
            aria-label="Refresh workspace"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {/* Container status */}
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              status === 'ready'
                ? 'bg-emerald-400'
                : status === 'booting'
                  ? 'bg-amber-400 animate-pulse'
                  : status === 'error'
                    ? 'bg-red-400'
                    : 'bg-zinc-600'
            }`}
            aria-hidden
          />
          <span className="font-manrope uppercase tracking-[0.12em]">
            {status === 'ready'
              ? 'Web container · Python 3.12'
              : status === 'booting'
                ? 'Booting web container…'
                : status === 'error'
                  ? 'Container failed to boot'
                  : 'Container idle'}
          </span>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {loading && nodes.length === 0 ? (
          <div className="text-[11px] text-zinc-600 px-2 py-6 text-center">Loading workspace…</div>
        ) : status === 'error' ? (
          <div className="space-y-3 px-2 py-6 text-center">
            <CircleAlert className="w-5 h-5 text-red-400 mx-auto" aria-hidden />
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              The web container could not boot (Pyodide loads from the CDN — check your connection).
            </p>
            <button
              onClick={() => {
                getContainer().reset();
                void loadWorkspace();
              }}
              className="mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[10px] text-zinc-300 hover:bg-white/[0.08] transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry boot
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-[11px] text-zinc-600 px-2 py-6 text-center leading-relaxed">
            {search
              ? 'No files match your search.'
              : 'No files yet. Ask the agent to fetch a hub resource or create a file — everything it touches lands here.'}
          </div>
        ) : (
          <div className="space-y-px max-h-full">
            {visible.map((n) => {
              const depth = n.path.split('/').length - 1;
              if (n.dir) {
                const isCollapsed = collapsed.has(n.path);
                const Icon = isCollapsed ? Folder : FolderOpen;
                return (
                  <button
                    key={n.path}
                    onClick={() => toggleFolder(n.path)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    aria-expanded={!isCollapsed}
                  >
                    <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden />
                    <span className="truncate text-[11px] font-manrope uppercase tracking-wider text-zinc-400">
                      {n.name}
                    </span>
                  </button>
                );
              }
              const Icon = fileIconFor(n.name);
              return (
                <div
                  key={n.path}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                  style={{ paddingLeft: `${8 + depth * 14}px` }}
                >
                  <Icon className="w-3.5 h-3.5 text-[#ef233c]/70 shrink-0" aria-hidden />
                  <button
                    onClick={() => void openPreview(n)}
                    className="flex-1 min-w-0 text-left text-xs text-zinc-300 hover:text-white truncate"
                    title={n.path}
                  >
                    {n.name}
                  </button>
                  <span className="text-[9px] font-mono text-zinc-600 shrink-0 group-hover:hidden">
                    {n.size ? fmtKB(n.size) : ''}
                  </span>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => void downloadFile(n.path)}
                      className="p-1 rounded text-zinc-600 hover:text-emerald-400 transition-colors"
                      title="Download file"
                      aria-label={`Download ${n.name}`}
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirmDelete === n.path) {
                          void deleteFile(n.path);
                          setConfirmDelete(null);
                        } else {
                          setConfirmDelete(n.path);
                          setTimeout(() => setConfirmDelete((p) => (p === n.path ? null : p)), 2500);
                        }
                      }}
                      className={`p-1 rounded transition-colors ${
                        confirmDelete === n.path ? 'text-red-400 bg-red-500/10' : 'text-zinc-600 hover:text-red-400'
                      }`}
                      title={confirmDelete === n.path ? 'Click again to confirm' : 'Delete file'}
                      aria-label={`Delete ${n.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* File preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closePreview}
        >
          <div
            className="w-full max-w-3xl max-h-[80vh] rounded-2xl bg-zinc-950 border border-white/10 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
              <div className="flex items-center gap-2.5 min-w-0">
                {preview.kind === 'zip' ? (
                  <FileArchive className="w-4 h-4 text-[#ef233c] shrink-0" aria-hidden />
                ) : (
                  <FileCode2 className="w-4 h-4 text-[#ef233c] shrink-0" aria-hidden />
                )}
                <span className="text-sm font-manrope text-white truncate">{preview.path}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void downloadFile(preview.path)}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                  title="Download"
                  aria-label="Download file"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={closePreview}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Close preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5 custom-scrollbar">
              {preview.loading ? (
                <div className="text-xs text-zinc-500 py-8 text-center">Loading…</div>
              ) : preview.error ? (
                <div className="text-xs text-red-300 py-4">{preview.error}</div>
              ) : preview.kind === 'image' && preview.url ? (
                 
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="max-w-full max-h-[60vh] mx-auto rounded-lg border border-white/10"
                />
              ) : preview.kind === 'zip' && preview.entries ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-manrope uppercase tracking-[0.15em] text-zinc-500 mb-2">
                    {preview.entries.length} entries
                  </div>
                  {preview.entries.map((e) => (
                    <div key={e.name} className="flex items-center gap-2 text-[11px] font-mono">
                      <FileCode2 className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0 truncate text-zinc-300">{e.name}</span>
                      <span className="text-zinc-600 shrink-0">{fmtKB(e.size)}</span>
                    </div>
                  ))}
                </div>
              ) : preview.kind === 'binary' ? (
                <div className="text-xs text-zinc-500 py-8 text-center">Binary file — download to view.</div>
              ) : (
                <>
                  {preview.truncated && (
                    <div className="mb-3 text-[10px] text-amber-500/80">
                      Preview truncated — download for the full file.
                    </div>
                  )}
                  <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">
                    {preview.content}
                  </pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main view
// ────────────────────────────────────────────────────────────────────────────

export function AgentView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    messages,
    chatLoading,
    streaming,
    live,
    stoppedWords,
    wsTree,
    wsFiles,
    wsTotalBytes,
    wsLoading,
    containerStatus,
    rightPanelOpen,
    providerReady,
    sendMessage,
    regenerate,
    stop,
    continueStopped,
    discardStopped,
    loadWorkspace,
    loadChats,
    toggleRightPanel,
    refreshProviderReady,
    activeChatId,
    selectChat,
    newChat,
    downloadWorkspaceFile,
  } = useAgentStore();

  const [input, setInput] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  // Structured-UI download actions (generated-file / download blocks).
  const uiActions = useMemo(
    () => ({ downloadFile: (path: string) => void downloadWorkspaceFile(path) }),
    [downloadWorkspaceFile]
  );

  // Auto-scroll the thread as the run timeline grows (text tokens, new
  // segments, tool call status changes, UI block updates, reasoning).
  const liveSig = useMemo(() => {
    if (!live) return '';
    const seg = live.timeline
      .map((s) => {
        if (s.kind === 'text') return `t${s.text.length}`;
        if (s.kind === 'tools') return `c${s.calls.length}:${s.calls.map((c) => c.status[0]).join('')}`;
        const b = live.blocks[s.blockId];
        return `u${b ? `${b.uiType}:${Object.keys(b.data).map((k) => (b.data[k] as unknown[])?.length ?? 0).join(',')}` : 'x'}`;
      })
      .join('|');
    return `${seg}#r${live.reasoning.length}`;
  }, [live]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, liveSig]);

  useEffect(() => {
    loadChats();
    void loadWorkspace();
    refreshProviderReady();
  }, [loadChats, loadWorkspace, refreshProviderReady]);

  // Reopening the agent UI restores the active chat's thread (the persisted
  // activeChatId survives reloads — reload its messages once on mount).
  useEffect(() => {
    const s = useAgentStore.getState();
    if (s.activeChatId && s.messages.length === 0 && !s.streaming) {
      const chat = s.chats.find((c) => c.id === s.activeChatId);
      if (chat && chat.messages.length > 0) void s.selectChat(s.activeChatId);
    }
  }, []);

  const handleSend = useCallback(() => {
    if (!input.trim() || streaming) return;
    void sendMessage(input);
    setInput('');
  }, [input, streaming, sendMessage]);

  const wordsCount = useMemo(
    () => (stoppedWords ? stoppedWords.split(' ').filter(Boolean).length : 0),
    [stoppedWords]
  );
  void wordsCount;

  return (
    <UiBlockActionsContext.Provider value={uiActions}>
      <div className="-mx-4 sm:-mx-6 lg:-mx-10 -my-6 lg:-my-10 flex gap-0 h-[calc(100dvh-3rem)] lg:h-dvh">
        {/* ── Center: chat ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-5 lg:px-8 py-3.5 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#ef233c]/10 border border-[#ef233c]/25 flex items-center justify-center">
                <Bot className="w-4.5 h-4.5 text-[#ef233c]" />
              </div>
              <div>
                <div className="font-manrope font-semibold text-sm text-white flex items-center gap-2">
                  RGE Agent
                  <span className="text-[9px] font-manrope uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-400">
                    Beta
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500">
                  Resource workspace · web container · realtime UI
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {providerReady === false && (
                <button
                  onClick={onOpenSettings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  <Settings2 className="w-3 h-3" /> Configure AI
                </button>
              )}
              <button
                onClick={() => {
                  if (!activeChatId) {
                    newChat();
                  } else {
                    selectChat(activeChatId);
                    newChat();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[10px] text-zinc-300 hover:bg-white/[0.08] transition-colors"
                title="New chat"
              >
                <Sparkles className="w-3 h-3" /> New chat
              </button>
              <button
                onClick={() => toggleRightPanel()}
                className="hidden lg:flex p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                title={rightPanelOpen ? 'Hide workspace' : 'Show workspace'}
              >
                {rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Thread */}
          <div ref={threadRef} className="flex-1 overflow-y-auto custom-scrollbar px-5 lg:px-8 py-6">
            <div className="max-w-3xl mx-auto space-y-6 pb-4">
              {chatLoading && (
                <div className="text-center py-12">
                  <ShimmerLabel className="text-xs">Loading chat…</ShimmerLabel>
                </div>
              )}

              {!chatLoading && messages.length === 0 && !live && (
                <EmptyAgentState onPick={(q) => setInput(q)} />
              )}

              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserBubble key={m.id} message={m} />
                ) : (
                  <AssistantMessage key={m.id} message={m} />
                )
              )}

              {live && <LiveTurnBlock live={live} streaming={streaming} />}

              {stoppedWords && (
                <StoppedRun
                  words={stoppedWords.split(' ')}
                  reason="stopped by you"
                  onContinue={continueStopped}
                  onDiscard={discardStopped}
                />
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-white/5 px-5 lg:px-8 py-4">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-end gap-2 rounded-2xl bg-white/[0.03] border border-white/10 focus-within:border-[#ef233c]/40 transition-colors px-3 py-2.5">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Ask the agent to fetch, inspect, edit or generate resources… (Shift+Enter for a new line)"
                  className="flex-1 bg-transparent resize-none outline-none text-sm text-white placeholder:text-zinc-600 max-h-40 custom-scrollbar py-1"
                  style={{ height: 'auto' }}
                  disabled={streaming}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                />
                {streaming ? (
                  <button
                    onClick={stop}
                    className="shrink-0 w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-300 hover:bg-red-500/25 transition-colors"
                    title="Stop"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="shrink-0 w-9 h-9 rounded-xl bg-[#ef233c] flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-red-700 transition-colors shadow-[0_0_16px_-6px_rgba(239,35,60,0.7)]"
                    title="Send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-[10px] text-zinc-600">
                  Real web container — fetch hub resources, edit XMLs, unpack ZIPs, run code, live output.
                </span>
                {!streaming && messages.length > 0 && (
                  <button
                    onClick={() => void regenerate()}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Regenerate
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: workspace (web container) ────────────────────────────── */}
        {rightPanelOpen && (
          <aside className="hidden lg:flex w-72 xl:w-80 shrink-0 flex-col border-l border-white/5 bg-black/30 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b-0">
              <div className="flex items-center gap-2">
                <Box className="w-3.5 h-3.5 text-[#ef233c]" aria-hidden />
                <span className="font-manrope font-semibold text-xs text-white">Workspace</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                {wsFiles.length} files · {fmtKB(wsTotalBytes)}
              </span>
            </div>
            <WorkspaceExplorer nodes={wsTree} loading={wsLoading} status={containerStatus} />
            <div className="px-4 py-3 border-t border-white/5 text-[10px] text-zinc-600 leading-relaxed">
              Per-chat web container. Fetched resources land in{' '}
              <span className="text-zinc-400 font-mono">hub/</span>, archives unpack to{' '}
              <span className="text-zinc-400 font-mono">extracted/</span>, results in{' '}
              <span className="text-zinc-400 font-mono">output/</span>. Files persist across reloads.
            </div>
          </aside>
        )}
      </div>
    </UiBlockActionsContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'List my hub resources and show them as a table',
  'Extract my resource ZIP, edit the XML inside and repack it',
  'Fetch the XML resource, validate it and fix any broken values',
  'Analyze the PNG pack archive and organize its contents',
];

function EmptyAgentState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="pt-8 pb-4 text-center space-y-6">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-[#ef233c]/10 border border-[#ef233c]/25 flex items-center justify-center">
        <Bot className="w-7 h-7 text-[#ef233c]" />
      </div>
      <div className="space-y-1.5">
        <h3 className="font-manrope font-bold text-lg text-white">RGE Agent</h3>
        <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
          A multi-round agent with a real web container. It fetches your hub
          resources into a workspace, edits XMLs, unpacks and repacks ZIPs,
          runs code with live output — and renders rich UI as it works.
        </p>
      </div>
      <div className="grid gap-2 max-w-lg mx-auto">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-xs text-zinc-400 hover:text-white rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#ef233c]/25 px-4 py-3 transition-all duration-300"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

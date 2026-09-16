/**
 * RGE Agent view — the multi-round AI agent chat.
 *
 * Layout (inside the platform shell, next to the main left sidebar):
 *   ┌───────────────────────────────┬──────────────┐
 *   │  chat thread (streaming)      │  workspace   │
 *   │  · thinking panels            │  file tree   │
 *   │  · tool calls / diffs / trees │  + totals    │
 *   │  · plan / todos / artifacts   │  (toggleable)│
 *   │  composer (send / stop)       │              │
 *   └───────────────────────────────┴──────────────┘
 *
 * Chat history lives in the main LEFT sidebar (agent section only).
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
  Settings2,
  Sparkles,
  X,
  Check,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useAgentStore, liveToolCalls } from '@/lib/agent-store';
import type { AgentMessage, AssistantSegment, TreeNode } from '@/lib/agent/types';
import {
  ToolCall,
  CodeDiff,
  FileTree,
  AgentPlan,
  AgentStatus,
  ArtifactCard,
  TodoList,
  StreamingText,
  StoppedRun,
  ThinkingReasoning,
  GenerationLoader,
  ShimmerLabel,
  Collapse,
  Orb,
  field,
  mono,
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

/** A friendly label + chip query for each tool call. */
function toolDisplay(tc: { name: string; args: Record<string, unknown> }): { label: string; query: string } {
  const a = tc.args || {};
  switch (tc.name) {
    case 'set_plan':
      return { label: 'Plan the work', query: `${(a.steps as string[])?.length ?? 0} steps` };
    case 'write_todos':
      return { label: 'Track todos', query: `${(a.items as unknown[])?.length ?? 0} items` };
    case 'list_hub_resources':
      return { label: 'List hub resources', query: (a.type as string) || 'all' };
    case 'fetch_resource':
      return { label: 'Fetch resource', query: String(a.resourceId || '') };
    case 'read_file':
      return { label: 'Read file', query: String(a.path || '') };
    case 'write_file':
      return { label: 'Write file', query: String(a.path || '') };
    case 'edit_file':
      return { label: 'Edit file', query: String(a.path || '') };
    case 'list_files':
      return { label: 'List workspace', query: 'files' };
    case 'delete_file':
      return { label: 'Delete file', query: String(a.path || '') };
    case 'unzip_file':
      return { label: 'Unzip archive', query: String(a.path || '') };
    case 'zip_files':
      return { label: 'Zip files', query: String(a.dest || '') };
    case 'update_resource':
      return { label: 'Update resource', query: String(a.resourceId || '') };
    case 'publish_file':
      return { label: 'Publish to hub', query: String(a.path || '') };
    case 'speedramp_clip':
      return { label: 'Speed ramp clip', query: String(a.resourceId || '') };
    default:
      return { label: tc.name, query: '' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tool call block — one ToolCall element + rich meta below it when present.
// ────────────────────────────────────────────────────────────────────────────

function ToolCallBlock({
  tc,
  defaultOpen,
}: {
  tc: { id: string; name: string; args: Record<string, unknown>; status: string; result?: string; meta?: any };
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { label, query } = toolDisplay(tc);
  const running = tc.status === 'running';
  return (
    <div className="space-y-2">
      <ToolCall
        label={label}
        activeLabel={`${label}…`}
        query={query}
        request={JSON.stringify(tc.args, null, 2)}
        result={tc.result ?? (running ? '' : '(no output)')}
        running={running}
        open={open}
        onOpenChange={setOpen}
      />
      {tc.status === 'error' && (
        <div className="pl-2 -mt-1 flex items-center gap-1.5 text-[10px] font-manrope uppercase tracking-[0.15em] text-red-400">
          <X className="h-3 w-3" aria-hidden /> failed
        </div>
      )}
      {tc.meta?.diff && (
        <CodeDiff
          filename={tc.meta.diff.filename}
          additions={tc.meta.diff.additions}
          deletions={tc.meta.diff.deletions}
          lines={tc.meta.diff.lines}
          cycle={1}
          className="max-w-none"
        />
      )}
      {tc.meta?.tree && tc.meta.tree.length > 0 && (
        <FileTree
          nodes={tc.meta.tree}
          visibleCount={tc.meta.tree.length}
          totalAdditions={tc.meta.tree.reduce((s: number, n: any) => s + (n.additions || 0), 0)}
          totalDeletions={tc.meta.tree.reduce((s: number, n: any) => s + (n.deletions || 0), 0)}
          className="max-w-none"
        />
      )}
      {tc.meta?.artifact && (
        <ArtifactCard
          title={tc.meta.artifact.title}
          meta={tc.meta.artifact.meta || 'Workspace file'}
          generating={tc.meta.artifact.generating}
          words={tc.meta.artifact.words || 0}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tool activity — THE single unified component for a whole agent run.
// Every tool call of the run streams into this one card as a row (in
// execution order); rows settle running → ok/error and expand to inspect
// the raw request/result. Never rendered twice per run.
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

  // Live runs open the activity so calls stream in visibly; the finished
  // run collapses to a single line (still expandable). Only transitions
  // flip the state — manual toggles during a run are respected.
  useEffect(() => {
    if (prevStreaming.current !== streaming) {
      prevStreaming.current = streaming;
      // Deferred per the repo's set-state-in-effect convention.
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
        <span className={`${field} ${mono} shrink-0 px-1.5 py-0.5 text-[11px] text-zinc-400`}>
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
        <div className="space-y-1.5 border-t border-white/5 px-2 pt-2 pb-2">
          {calls.map((tc) => (
            <ToolCallBlock key={tc.id} tc={tc} />
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
      {segments.map((seg) =>
        seg.kind === 'text' ? (
          seg.text ? (
            <p
              key={seg.id}
              className="text-sm text-zinc-100 whitespace-pre-wrap break-words leading-relaxed"
            >
              {seg.text}
            </p>
          ) : null
        ) : (
          <ToolActivityBlock key={seg.id} calls={seg.calls} streaming={false} />
        )
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Live streaming block (the turn in progress)
// ────────────────────────────────────────────────────────────────────────────

/** One streamed text segment — tokens append into it until the model
 *  switches to a tool call; a NEW segment is only started when the model
 *  resumes speaking after tool results. */
function TextSegmentView({ text, active }: { text: string; active: boolean }) {
  const words = text.split(' ').filter(Boolean);
  return (
    <StreamingText
      segments={[{ text }]}
      count={words.length}
      streaming={active}
      className="max-w-none text-sm leading-relaxed"
    />
  );
}

function LiveTurnBlock({
  live,
  streaming,
  elapsedLabel,
}: {
  live: import('@/lib/agent-store').LiveTurn;
  streaming: boolean;
  elapsedLabel: string;
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
          it: text segments and the single tool-activity component interleaved. */}
      {live.timeline.map((seg, i) =>
        seg.kind === 'text' ? (
          <TextSegmentView key={seg.id} text={seg.text} active={streaming && i === lastIdx} />
        ) : (
          <ToolActivityBlock key={seg.id} calls={seg.calls} streaming={streaming} />
        )
      )}

      {showLoader && streaming && (
        <div className="flex items-center gap-3 py-2">
          <LiveLoaderTick label={live.statusLabel} />
        </div>
      )}

      {live.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-300">
          {live.error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <AgentStatus
          state={streaming ? (live.statusState === 'working' ? 'working' : 'waiting') : 'done'}
          label={streaming ? live.statusLabel : 'Finished'}
          elapsed={streaming ? elapsedLabel : undefined}
        />
      </div>
    </div>
  );
}

/** Loader with its own tick clock. */
function LiveLoaderTick({ label }: { label: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, []);
  return <GenerationLoader label={label} tick={tick} />;
}

/** Elapsed mm:ss for the live turn. */
function useElapsed(startedAt: number, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Workspace right sidebar
// ────────────────────────────────────────────────────────────────────────────

function WorkspaceTree({ nodes }: { nodes: TreeNode[] }) {
  const deleteFile = useAgentStore((s) => s.deleteWorkspaceFile);
  const [preview, setPreview] = useState<{ path: string; name: string } | null>(null);
  const [previewBody, setPreviewBody] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const openPreview = async (path: string, name: string) => {
    setPreview({ path, name });
    setPreviewLoading(true);
    setPreviewBody('');
    try {
      const res = await fetch(`/api/agent/workspace/file?path=${encodeURIComponent(path)}`);
      const body = await res.json();
      if (body?.success) {
        setPreviewTruncated(!!body.data?.truncated);
        setPreviewBody(body.data?.content ?? '(binary file — download to view)');
      } else {
        setPreviewBody(body?.error?.message || 'Failed to load file.');
      }
    } catch {
      setPreviewBody('Failed to load file.');
    } finally {
      setPreviewLoading(false);
    }
  };

  if (nodes.length === 0) {
    return (
      <div className="text-[11px] text-zinc-600 px-2 py-6 text-center leading-relaxed">
        No files yet. Ask the agent to fetch a resource or create a file —
        everything it touches lands here.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-px">
        {nodes.map((n) => {
          const Icon = n.kind === 'folder' ? Folder : fileIconFor(n.name);
          if (n.kind === 'folder') {
            return (
              <div
                key={n.path}
                className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-manrope uppercase tracking-wider text-zinc-500"
                style={{ paddingLeft: `${8 + n.depth * 14}px` }}
              >
                <Icon className="w-3.5 h-3.5 text-zinc-600" />
                <span className="truncate">{n.name}</span>
              </div>
            );
          }
          return (
            <div
              key={n.path}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
              style={{ paddingLeft: `${8 + n.depth * 14}px` }}
            >
              <Icon className="w-3.5 h-3.5 text-[#ef233c]/70 shrink-0" />
              <button
                onClick={() => openPreview(n.path, n.name)}
                className="flex-1 min-w-0 text-left text-xs text-zinc-300 hover:text-white truncate"
                title={n.path}
              >
                {n.name}
              </button>
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  onClick={() => {
                    if (confirmDelete === n.path) {
                      deleteFile(n.path);
                      setConfirmDelete(null);
                    } else {
                      setConfirmDelete(n.path);
                      setTimeout(() => setConfirmDelete((p) => (p === n.path ? null : p)), 2500);
                    }
                  }}
                  className={`p-1 rounded transition-colors ${
                    confirmDelete === n.path
                      ? 'text-red-400 bg-red-500/10'
                      : 'text-zinc-600 hover:text-red-400'
                  }`}
                  title={confirmDelete === n.path ? 'Click again to confirm' : 'Delete file'}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* File preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[80vh] rounded-2xl bg-zinc-950 border border-white/10 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileCode2 className="w-4 h-4 text-[#ef233c] shrink-0" />
                <span className="text-sm font-manrope text-white truncate">{preview.path}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/agent/workspace/file?path=${encodeURIComponent(preview.path)}&download=1`}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setPreview(null)}
                  className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5 custom-scrollbar">
              {previewLoading ? (
                <div className="text-xs text-zinc-500 py-8 text-center">Loading…</div>
              ) : (
                <>
                  {previewTruncated && (
                    <div className="mb-3 text-[10px] text-amber-500/80">
                      Preview truncated — download for the full file.
                    </div>
                  )}
                  <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">
                    {previewBody}
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
  } = useAgentStore();

  const [input, setInput] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(live?.startedAt ?? 0, streaming);

  // Auto-scroll the thread as the run timeline grows (text tokens, new
  // segments, tool call status changes, reasoning).
  const liveSig = useMemo(() => {
    if (!live) return '';
    const seg = live.timeline
      .map((s) =>
        s.kind === 'text'
          ? `t${s.text.length}`
          : `c${s.calls.length}:${s.calls.map((c) => c.status[0]).join('')}`
      )
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
    loadWorkspace();
    refreshProviderReady();
  }, [loadChats, loadWorkspace, refreshProviderReady]);

  const handleSend = useCallback(() => {
    if (!input.trim() || streaming) return;
    sendMessage(input);
    setInput('');
  }, [input, streaming, sendMessage]);

  const wordsCount = useMemo(
    () => (stoppedWords ? stoppedWords.split(' ').filter(Boolean).length : 0),
    [stoppedWords]
  );

  return (
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
                {streaming && <Orb pill size={14} label="Working" />}
              </div>
              <div className="text-[10px] text-zinc-500">
                Multi-round editing agent · workspace-persistent
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
              title={rightPanelOpen ? 'Hide files' : 'Show files'}
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
              <EmptyAgentState onPick={(q) => { setInput(q); }} />
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} message={m} />
              ) : (
                <AssistantMessage key={m.id} message={m} />
              )
            )}

            {live && <LiveTurnBlock live={live} streaming={streaming} elapsedLabel={elapsed} />}

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
                placeholder="Ask the agent to fetch, edit, create or publish… (Shift+Enter for a new line)"
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
                The agent can fetch hub files, edit XMLs, unzip, publish and speed-ramp — everything is verified and persisted.
              </span>
              {!streaming && messages.length > 0 && (
                <button
                  onClick={regenerate}
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Regenerate
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: workspace files ───────────────────────────────────────── */}
      {rightPanelOpen && (
        <aside className="hidden lg:flex w-72 xl:w-80 shrink-0 flex-col border-l border-white/5 bg-black/30 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Folder className="w-3.5 h-3.5 text-[#ef233c]" />
              <span className="font-manrope font-semibold text-xs text-white">Workspace</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">
              {wsFiles.length} files · {fmtKB(wsTotalBytes)}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
            {wsLoading && wsFiles.length === 0 ? (
              <div className="text-[11px] text-zinc-600 px-2 py-6 text-center">Loading workspace…</div>
            ) : (
              <WorkspaceTree nodes={wsTree} />
            )}
          </div>
          <div className="px-4 py-3 border-t border-white/5 text-[10px] text-zinc-600 leading-relaxed">
            Files persist per account. Fetched hub resources land in
            <span className="text-zinc-400 font-mono"> resources/</span>; agent edits stay here until published.
          </div>
        </aside>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Fetch my latest clip and speed-ramp it',
  'List my XML files and edit the titles',
  'Unzip my resource pack and create a new XML',
  'What do I have in the hub? Make a plan and organize it',
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
          A multi-round agent with a persistent workspace. It can see your hub
          resources, fetch and edit XMLs, unzip archives, update titles and
          links, publish new files and speed-ramp clips — with every tool call
          visible.
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

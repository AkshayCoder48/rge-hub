/**
 * RGE Agent — client store (zustand + localStorage persistence).
 *
 * The ENTIRE agent engine runs in the browser now:
 *   • chats + provider config persist to localStorage (server never stores them)
 *   • the multi-round loop drives /api/agent/completions (thin streaming proxy)
 *   • tools execute CLIENT-SIDE (web-container workspace, hub APIs, emit_ui)
 *   • the workspace is the per-chat web container (Pyodide), persisted via
 *     IndexedDB by the container client
 *
 * Surfaces: left sidebar (chat history, agent view only) · agent view
 * (streaming timeline + composer) · right sidebar (workspace explorer).
 */
'use client';

import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type {
  AgentChat,
  AgentMessage,
  AgentToolCall,
  AgentConfig,
  AssistantSegment,
} from '@/lib/agent/types';
import type { ParsedToolCall, CompletionsWireEvent } from '@/lib/agent/protocol';
import { buildProviderMessages } from '@/lib/agent/protocol';
import type { EmitUiArgs, UiBlockState } from '@/lib/agent/ui-protocol';
import { applyUiOperation, capBlockData } from '@/lib/agent/ui-protocol';
import type { ContainerFileNode, ContainerStatus } from '@/lib/agent/container-types';
import { getContainer, sanitizeWsId } from '@/lib/agent/container-client';
import { CLIENT_TOOLS, executeClientTool, type ClientToolContext } from '@/lib/agent/agent-tools';
import { buildSystemPrompt } from '@/lib/agent/prompts';
import {
  newChatId,
  autoTitle,
  capMessages,
  metaOf,
  sortChats,
  MAX_CHATS,
} from '@/lib/agent/chat-utils';
import { defaultAgentConfig, sanitizeConfig, isConfigured } from '@/lib/agent/config';

const MAX_ROUNDS = 16;

// ────────────────────────────────────────────────────────────────────────────
// Quota-safe localStorage — if the persisted state exceeds the storage quota
// (UI blocks make chats big), progressively drop the OLDEST chats (and, as a
// last resort, trim messages) instead of silently losing the newest turn.
// This is why UI blocks used to vanish after a reload: the quota write failed
// and the previous snapshot was restored instead.
// ────────────────────────────────────────────────────────────────────────────

function createAgentStorage(): PersistStorage<PersistedAgentState> {
  const write = (name: string, value: StorageValue<PersistedAgentState>): boolean => {
    try {
      localStorage.setItem(name, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  const withChats = (
    value: StorageValue<PersistedAgentState>,
    chats: AgentChat[]
  ): StorageValue<PersistedAgentState> => ({ ...value, state: { ...value.state, chats } });

  return {
    getItem: (name) => {
      try {
        const raw = localStorage.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<PersistedAgentState>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (write(name, value)) return;
      const chats = [...(value.state.chats ?? [])].sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      );
      // 1) Drop the oldest chats one at a time (keep at least the newest).
      for (let drop = 1; drop < chats.length; drop++) {
        if (write(name, withChats(value, chats.slice(drop)))) {
          console.warn(`[agent-storage] quota exceeded — dropped ${drop} oldest chat(s).`);
          return;
        }
      }
      // 2) Last resort: newest 3 chats, last 30 messages each.
      const slim = chats
        .slice(-3)
        .map((c) => ({ ...c, messages: c.messages.slice(-30) }));
      if (write(name, withChats(value, slim))) {
        console.warn('[agent-storage] quota exceeded — kept only the 3 newest chats (trimmed).');
        return;
      }
      console.warn('[agent-storage] unable to persist agent chats — storage quota exhausted.');
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Live streaming state (kept OUT of persisted messages while a turn runs)
// ────────────────────────────────────────────────────────────────────────────

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'ok' | 'error';
  result?: string;
  meta?: AgentToolCall['meta'];
}

export interface LiveTextSegment {
  kind: 'text';
  id: string;
  text: string;
}

export interface LiveToolsSegment {
  kind: 'tools';
  id: string;
  calls: LiveToolCall[];
}

export interface LiveUiSegment {
  kind: 'ui';
  id: string;
  /** Key into live.blocks — the block state itself. */
  blockId: string;
}

export type LiveSegment = LiveTextSegment | LiveToolsSegment | LiveUiSegment;

export interface LiveTurn {
  /** Ordered run timeline — rendered EXACTLY as it streamed: text segments,
   * the run's ONE tools segment and structured-UI blocks, in stream order. */
  timeline: LiveSegment[];
  /** Structured UI blocks by stable id (updated in place by emit_ui). */
  blocks: Record<string, UiBlockState>;
  /** Set when a tool event occurred after the last text token — the next
   * token must OPEN A NEW text segment instead of appending (the model
   * resumed speaking after tool activity). */
  splitNextText: boolean;
  reasoning: string;
  reasoningSentences: string[];
  statusState: 'thinking' | 'working';
  statusLabel: string;
  startedAt: number;
  plan?: { steps: string[]; activeIndex: number };
  todos?: { id: string; text: string; status: 'pending' | 'active' | 'done' }[];
  error?: string;
}

/** Concatenated assistant text of the run (all text segments, in order). */
export function liveTextContent(live: LiveTurn): string {
  let out = '';
  for (const seg of live.timeline) {
    if (seg.kind === 'text' && seg.text) out = out ? `${out}\n\n${seg.text}` : seg.text;
  }
  return out;
}

/** Flat view of every tool call in the run (execution order). */
export function liveToolCalls(live: LiveTurn): LiveToolCall[] {
  const out: LiveToolCall[] = [];
  for (const seg of live.timeline) if (seg.kind === 'tools') out.push(...seg.calls);
  return out;
}

let segSeq = 0;
function newSegmentId(): string {
  return `seg_${Date.now().toString(36)}_${(segSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** What gets persisted to localStorage. */
interface PersistedAgentState {
  chats: AgentChat[];
  activeChatId: string | null;
  config: AgentConfig;
}

interface AgentStore extends PersistedAgentState {
  messages: AgentMessage[];
  chatLoading: boolean;

  // streaming
  streaming: boolean;
  live: LiveTurn | null;
  stoppedWords: string | null;

  // workspace (web container — right sidebar)
  wsTree: ContainerFileNode[];
  wsFiles: ContainerFileNode[];
  wsTotalBytes: number;
  wsLoading: boolean;
  containerStatus: ContainerStatus;
  rightPanelOpen: boolean;

  // config summary for the header badge
  providerReady: boolean | null;

  // actions — chats (all local)
  loadChats: () => void;
  selectChat: (id: string) => void;
  newChat: () => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;

  // actions — config (local)
  saveConfig: (patch: Partial<AgentConfig>) => AgentConfig;

  // actions — streaming
  sendMessage: (text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
  continueStopped: () => void;
  discardStopped: () => void;

  // actions — workspace (web container)
  loadWorkspace: () => Promise<void>;
  refreshWorkspaceSoon: () => void;
  deleteWorkspaceFile: (path: string) => Promise<void>;
  downloadWorkspaceFile: (path: string) => Promise<void>;
  toggleRightPanel: (open?: boolean) => void;

  refreshProviderReady: () => void;
}

let abortController: AbortController | null = null;
let activeRunToken: { current: boolean } | null = null;

/** Parse an SSE body stream into wire events. */
async function* sseFrames(res: Response): AsyncGenerator<CompletionsWireEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          yield JSON.parse(payload) as CompletionsWireEvent;
        } catch {
          // ignore malformed frame
        }
      }
    }
  }
}

function splitReasoningSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  return {};
}

// ────────────────────────────────────────────────────────────────────────────
// Web-container wiring (status + fs events → store)
// ────────────────────────────────────────────────────────────────────────────

let containerWired = false;
let wsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function activeWorkspaceId(s: { activeChatId: string | null }): string {
  return s.activeChatId ? sanitizeWsId(s.activeChatId) : 'draft';
}

function wireContainerEvents(
  set: (partial: Partial<AgentStore>) => void,
  get: () => AgentStore
) {
  if (containerWired || typeof window === 'undefined') return;
  containerWired = true;
  const c = getContainer();
  c.subscribeStatus((status) => set({ containerStatus: status }));
  c.subscribeFs((workspace) => {
    // Refresh the explorer when the ACTIVE workspace changed (or a full
    // refresh marker arrives). Debounced — extraction fans out many events.
    const active = activeWorkspaceId(get());
    if (workspace === active || workspace === '*' || workspace === 'draft') {
      if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
      wsRefreshTimer = setTimeout(() => {
        wsRefreshTimer = null;
        void get().refreshWorkspaceSoon();
      }, 350);
    }
  });
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      config: defaultAgentConfig(),

      messages: [],
      chatLoading: false,

      streaming: false,
      live: null,
      stoppedWords: null,

      wsTree: [],
      wsFiles: [],
      wsTotalBytes: 0,
      wsLoading: false,
      containerStatus: 'idle',
      rightPanelOpen: true,

      providerReady: null,

      // ── chats (localStorage — no network) ──────────────────────────────

      loadChats: () => {
        set((s) => ({ chats: sortChats(s.chats) }));
      },

      selectChat: (id) => {
        if (get().streaming) return;
        const chat = get().chats.find((c) => c.id === id);
        set({
          activeChatId: id,
          messages: chat ? capMessages(chat.messages) : [],
          stoppedWords: null,
          chatLoading: false,
        });
        // switch the explorer to this chat's workspace
        void get().loadWorkspace();
      },

      newChat: () => {
        if (get().streaming) return;
        set({ activeChatId: null, messages: [], stoppedWords: null });
        void get().loadWorkspace();
      },

      deleteChat: (id) => {
        const wasActive = get().activeChatId === id;
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          ...(wasActive ? { activeChatId: null, messages: [] } : {}),
        }));
      },

      renameChat: (id, title) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id
              ? { ...c, title: (title || 'Untitled').trim().slice(0, 120) || 'Untitled', updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },

      // ── config (localStorage) ──────────────────────────────────────────

      saveConfig: (patch) => {
        // apiKey handling: undefined → keep; '' → clear; masked echo → keep.
        const current = get().config;
        const merged = { ...current, ...patch };
        if (patch.apiKey === '') {
          merged.apiKey = undefined;
        } else if (typeof patch.apiKey === 'string' && patch.apiKey.includes('…')) {
          merged.apiKey = current.apiKey;
        }
        const next = sanitizeConfig(merged);
        next.updatedAt = new Date().toISOString();
        set({ config: next, providerReady: isConfigured(next) });
        return next;
      },

      // ── streaming ──────────────────────────────────────────────────────

      sendMessage: async (text) => {
        const trimmed = text.trim();
        if (!trimmed || get().streaming || get().chatLoading) return;

        const userMsg: AgentMessage = {
          id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
        };

        // Resolve (or create) the local chat this turn belongs to.
        const existing = get().chats.find((c) => c.id === get().activeChatId) || null;
        const chatId = existing ? existing.id : newChatId();
        let history: AgentMessage[];
        if (!existing) {
          const chat: AgentChat = {
            id: chatId,
            title: autoTitle(trimmed),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
          };
          history = [userMsg];
          set((s) => ({ chats: [chat, ...s.chats].slice(0, MAX_CHATS) }));
        } else {
          history = capMessages([...existing.messages, userMsg]);
        }

        set({
          activeChatId: chatId,
          messages: history,
          streaming: true,
          stoppedWords: null,
          live: {
            timeline: [],
            blocks: {},
            splitNextText: false,
            reasoning: '',
            reasoningSentences: [],
            statusState: 'thinking',
            statusLabel: 'Thinking',
            startedAt: Date.now(),
          },
        });

        await runAgentTurn(chatId, history, set, get);
      },

      regenerate: async () => {
        if (get().streaming || get().chatLoading) return;
        const chat = get().chats.find((c) => c.id === get().activeChatId);
        if (!chat) return;
        const chatId = chat.id;
        const msgs = capMessages(chat.messages);
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        if (!lastUser) return;
        // drop trailing assistant messages after the last user message
        const idx = msgs.lastIndexOf(lastUser);
        const history = msgs.slice(0, idx + 1);
        set({
          messages: history,
          streaming: true,
          stoppedWords: null,
          live: {
            timeline: [],
            blocks: {},
            splitNextText: false,
            reasoning: '',
            reasoningSentences: [],
            statusState: 'thinking',
            statusLabel: 'Thinking',
            startedAt: Date.now(),
          },
        });
        await runAgentTurn(chatId, history, set, get);
      },

      stop: () => {
        const live = get().live;
        const words = live ? liveTextContent(live) : '';
        if (words) {
          set({ stoppedWords: words });
        }
        if (activeRunToken) activeRunToken.current = false;
        abortController?.abort();
        abortController = null;
        // settle any live UI blocks + tool rows so the frozen timeline is coherent
        set((s) => {
          if (!s.live) return {};
          const blocks: Record<string, UiBlockState> = {};
          for (const [id, b] of Object.entries(s.live.blocks)) blocks[id] = { ...b, status: 'done' };
          const timeline = s.live.timeline.map((seg) =>
            seg.kind === 'tools'
              ? {
                  ...seg,
                  calls: seg.calls.map((c) => (c.status === 'running' ? { ...c, status: 'error' as const, result: 'stopped by you' } : c)),
                }
              : seg
          );
          return { live: { ...s.live, blocks, timeline } };
        });
      },

      continueStopped: () => {
        const words = get().stoppedWords;
        if (!words) return;
        set({ stoppedWords: null });
        get().sendMessage('Continue exactly where you stopped.');
      },

      discardStopped: () => set({ stoppedWords: null }),

      // ── workspace (web container) ──────────────────────────────────────

      loadWorkspace: async () => {
        set({ wsLoading: true });
        try {
          wireContainerEvents(set, get);
          const c = getContainer();
          await c.boot();
          const ws = activeWorkspaceId(get());
          await c.ensureWorkspace(ws);
          const { nodes } = await c.list(ws);
          const files = nodes.filter((n) => !n.dir);
          set({
            wsTree: nodes,
            wsFiles: files,
            wsTotalBytes: files.reduce((s, f) => s + (f.size || 0), 0),
            wsLoading: false,
          });
        } catch {
          set({ wsLoading: false });
        }
      },

      refreshWorkspaceSoon: () => {
        if (!get().wsLoading) void get().loadWorkspace();
      },

      deleteWorkspaceFile: async (path) => {
        try {
          const c = getContainer();
          const ws = activeWorkspaceId(get());
          await c.delete(ws, path);
        } catch {
          /* refresh regardless */
        }
        await get().loadWorkspace();
      },

      downloadWorkspaceFile: async (path) => {
        const c = getContainer();
        const ws = activeWorkspaceId(get());
        const dl = await c.downloadFile(ws, path);
        const a = document.createElement('a');
        a.href = dl.url;
        a.download = dl.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => dl.revoke(), 30_000);
      },

      toggleRightPanel: (open) =>
        set((s) => ({ rightPanelOpen: open === undefined ? !s.rightPanelOpen : open })),

      refreshProviderReady: () => {
        set({ providerReady: isConfigured(get().config) });
      },
    }),
    {
      name: 'rge-agent-storage',
      version: 1,
      storage: createAgentStorage(),
      // SSR-safe: the initial client render matches the server (empty), then
      // PlatformApp's mount effect calls useAgentStore.persist.rehydrate().
      skipHydration: true,
      // Persist ONLY the durable data — never streaming/UI state.
      partialize: (s): PersistedAgentState => ({
        chats: s.chats,
        activeChatId: s.activeChatId,
        config: s.config,
      }),
    }
  )
);

// ────────────────────────────────────────────────────────────────────────────
// The agent engine — client-driven multi-round loop.
//
// Rounds: build system prompt (fresh workspace snapshot) + provider messages
// → stream ONE round from /api/agent/completions → text/thinking land in the
// timeline the instant they arrive → tool calls execute client-side (web
// container / hub / emit_ui) → results appended → next round. The timeline is
// the TRUE execution order — nothing is buffered until the end.
// ────────────────────────────────────────────────────────────────────────────

type SetState = (partial: Partial<AgentStore> | ((s: AgentStore) => Partial<AgentStore>)) => void;
type GetState = () => AgentStore;

/** Provider-history item shape consumed by buildProviderMessages. */
interface RunHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown>; status: string; result?: string }[];
}

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    set_plan: 'set plan',
    write_todos: 'track todos',
    emit_ui: 'render UI',
    hub_list_resources: 'hub resources',
    hub_fetch_resource: 'fetch resource',
    workspace_list: 'list workspace',
    workspace_read: 'read file',
    workspace_write: 'write file',
    workspace_edit: 'edit file',
    workspace_delete: 'delete file',
    workspace_mkdir: 'make directory',
    workspace_extract_zip: 'extract archive',
    workspace_create_zip: 'create archive',
    workspace_search: 'search workspace',
    workspace_file_info: 'file info',
    execute_code: 'run code',
    run_terminal: 'terminal',
    update_resource: 'update resource',
    speedramp_clip: 'speed-ramp clip',
  };
  return map[name] || name.replace(/_/g, ' ');
}

/** Tool calls for the provider history — derived from the persisted timeline
 * (segments) when present, else the legacy flattened `toolCalls` field. */
function deriveToolCalls(m: AgentMessage): AgentToolCall[] {
  if (m.segments?.some((s) => s.kind === 'tools')) {
    const calls: AgentToolCall[] = [];
    for (const seg of m.segments) if (seg.kind === 'tools') calls.push(...seg.calls);
    return calls;
  }
  return m.toolCalls ?? [];
}

/** Build the assistant message for the CURRENT live state (used for both the
 * per-round incremental commit and the final commit — same id, so the final
 * write cleanly replaces the partial one). */
function buildAssistantMessage(live: LiveTurn, id: string): AgentMessage {
  const finishedCalls = liveToolCalls(live);
  const segments: AssistantSegment[] = live.timeline
    .filter((s) =>
      s.kind === 'text' ? s.text.trim().length > 0 : s.kind === 'tools' ? s.calls.length > 0 : !!live.blocks[s.blockId]
    )
    .map((s) =>
      s.kind === 'text'
        ? { kind: 'text' as const, id: s.id, text: s.text }
        : s.kind === 'tools'
          ? {
              kind: 'tools' as const,
              id: s.id,
              calls: s.calls.map<AgentToolCall>((c) => ({
                id: c.id,
                name: c.name,
                args: c.args,
                status: c.status === 'error' ? ('error' as const) : ('ok' as const),
                result: c.result,
              })),
            }
          : {
              kind: 'ui' as const,
              id: s.id,
              block: { ...live.blocks[s.blockId], data: capBlockData(live.blocks[s.blockId].data) },
            }
    );
  return {
    id,
    role: 'assistant',
    content: liveTextContent(live),
    reasoning: live.reasoning || undefined,
    ...(finishedCalls.length > 0 ? { toolCalls: finishedCalls.map<AgentToolCall>((c) => ({
      id: c.id, name: c.name, args: c.args,
      status: c.status === 'error' ? ('error' as const) : ('ok' as const),
      result: c.result,
    })) } : {}),
    ...(segments.length > 0 ? { segments } : {}),
    createdAt: new Date().toISOString(),
  };
}

/** Snapshot the workspace for the system prompt (never throws). */
async function workspaceSnapshot(chatId: string): Promise<Parameters<typeof buildSystemPrompt>[0]> {
  try {
    const c = getContainer();
    await c.ensureWorkspace(chatId);
    const { nodes } = await c.list(chatId);
    const files = nodes.filter((n) => !n.dir);
    return {
      lines: files.slice(0, 60).map((f) => `- ${f.path} (${fmtKB(f.size)})`),
      fileCount: files.length,
      totalBytes: files.reduce((s, f) => s + (f.size || 0), 0),
      truncated: files.length > 60,
    };
  } catch {
    return null;
  }
}

async function runAgentTurn(
  chatId: string,
  history: AgentMessage[],
  set: SetState,
  get: GetState
) {
  abortController = new AbortController();
  const runToken = { current: true };
  activeRunToken = runToken;
  const config = get().config;

  const patchLive = (patch: Partial<LiveTurn>) =>
    set((s) => (s.live ? { live: { ...s.live, ...patch } } : {}));

  /** Commit messages + chat meta to the local (persisted) store. */
  const commitToChat = (msgs: AgentMessage[], fallbackTitle?: string) => {
    set((s) => ({
      messages: msgs,
      chats: sortChats(
        s.chats.map((c) => {
          if (c.id !== chatId) return c;
          const title = c.title === 'New chat' && fallbackTitle ? fallbackTitle : c.title;
          return {
            ...c,
            title,
            messages: capMessages(msgs),
            updatedAt: new Date().toISOString(),
          };
        })
      ),
    }));
  };

  // ── timeline mutation helpers ──────────────────────────────────────────

  const appendToken = (text: string) => {
    set((s) => {
      const live = s.live;
      if (!live) return {};
      const timeline = live.timeline.slice();
      const last = timeline[timeline.length - 1];
      if (!live.splitNextText && last && last.kind === 'text') {
        timeline[timeline.length - 1] = { ...last, text: last.text + text };
      } else {
        timeline.push({ kind: 'text', id: newSegmentId(), text });
      }
      return { live: { ...live, timeline, splitNextText: false } };
    });
  };

  const appendThinking = (text: string) => {
    set((s) => {
      const live = s.live;
      if (!live) return {};
      const reasoning = live.reasoning + text;
      return { live: { ...live, reasoning, reasoningSentences: splitReasoningSentences(reasoning) } };
    });
  };

  const toolStart = (callId: string, name: string, args: Record<string, unknown>) => {
    set((s) => {
      const live = s.live;
      if (!live) return {};
      const timeline = live.timeline.slice();
      const toolsIdx = timeline.findIndex((seg) => seg.kind === 'tools');
      const call: LiveToolCall = { id: callId, name, args, status: 'running' };
      if (toolsIdx >= 0) {
        const seg = timeline[toolsIdx] as LiveToolsSegment;
        timeline[toolsIdx] = { ...seg, calls: [...seg.calls, call] };
      } else {
        timeline.push({ kind: 'tools', id: newSegmentId(), calls: [call] });
      }
      return { live: { ...live, timeline, splitNextText: true } };
    });
  };

  const toolResultUpdate = (callId: string, ok: boolean, result: string, meta?: AgentToolCall['meta']) => {
    set((s) => {
      const live = s.live;
      if (!live) return {};
      const timeline = live.timeline.map((seg) =>
        seg.kind !== 'tools'
          ? seg
          : {
              ...seg,
              calls: seg.calls.map((c) =>
                c.id === callId
                  ? { ...c, status: ok ? ('ok' as const) : ('error' as const), result, meta }
                  : c
              ),
            }
      );
      return { live: { ...live, timeline, splitNextText: true } };
    });
  };

  /** emit_ui → update the block in place; first sighting opens a ui segment. */
  const applyEmit = (args: EmitUiArgs) => {
    set((s) => {
      const live = s.live;
      if (!live) return {};
      if (!args.id || !args.uiType) return {};
      const blocks = { ...live.blocks };
      const prev = blocks[args.id];
      blocks[args.id] = applyUiOperation(prev, args);
      const timeline = live.timeline.slice();
      if (!prev) {
        timeline.push({ kind: 'ui', id: newSegmentId(), blockId: args.id });
      }
      return { live: { ...live, blocks, timeline, splitNextText: true } };
    });
  };

  // ── tool execution context ─────────────────────────────────────────────

  const ctx: ClientToolContext = {
    chatId: sanitizeWsId(chatId),
    runToken,
    emitUi: applyEmit,
    setPlan: (steps) => patchLive({ plan: { steps, activeIndex: 0 } }),
    setTodos: (items) =>
      patchLive({ todos: items.map((it, i) => ({ id: `t${i}`, text: it.text, status: it.status })) }),
  };

  const runHistory: RunHistoryItem[] = history.map((m) => {
    const toolCalls = deriveToolCalls(m);
    return {
      role: m.role,
      content: m.content,
      ...(toolCalls.length
        ? {
            toolCalls: toolCalls.map((c) => ({
              id: c.id,
              name: c.name,
              args: c.args,
              status: c.status,
              result: c.result,
            })),
          }
        : {}),
    };
  });

  // The assistant message id is fixed for the whole turn — partial (per-round)
  // commits and the final commit reuse it, so the final write REPLACES the
  // partial instead of duplicating it.
  const assistantMsgId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /** Commit the CURRENT live timeline mid-run (after each round) — a reload
   *  mid-run keeps everything streamed so far instead of losing the turn. */
  const commitPartial = () => {
    const live = get().live;
    if (!live || live.timeline.length === 0) return;
    commitToChat([...history, buildAssistantMessage(live, assistantMsgId)]);
  };

  let rounds = 0;
  let hadError = false;

  try {
    if (!isConfigured(config)) {
      const why =
        config.provider === 'openai'
          ? 'The OpenAI-compatible provider needs a base URL — set it in Settings → Agent.'
          : 'The built-in provider is not available right now — configure an OpenAI-compatible provider in Settings → Agent.';
      throw new Error(why);
    }

    while (runToken.current && rounds < MAX_ROUNDS) {
      rounds++;
      patchLive({
        statusState: 'thinking',
        statusLabel: get().containerStatus === 'booting' ? 'Starting web container' : rounds === 1 ? 'Thinking' : 'Continuing',
      });

      // Fresh system prompt with the live workspace tree.
      const snapshot = await workspaceSnapshot(ctx.chatId);
      const system = buildSystemPrompt(snapshot);
      const providerMessages = buildProviderMessages(config.provider, runHistory, system);

      const res = await fetch('/api/agent/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({ config, messages: providerMessages, tools: CLIENT_TOOLS }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `Agent request failed (${res.status}).`);
      }

      let roundText = '';
      let calls: ParsedToolCall[] = [];
      let streamError: string | null = null;

      for await (const ev of sseFrames(res)) {
        if (!runToken.current) break;
        if (ev.type === 'token') {
          roundText += ev.text;
          appendToken(ev.text);
        } else if (ev.type === 'thinking') {
          appendThinking(ev.text);
        } else if (ev.type === 'tool_calls') {
          calls = ev.calls;
        } else if (ev.type === 'error') {
          streamError = ev.message;
        }
        // 'finish' — the for-await ends on its own
      }

      if (streamError) throw new Error(streamError);
      if (!runToken.current) break;

      // Plain reply (no tool calls) → the conversation turn is complete.
      if (calls.length === 0) break;

      // ── Execute every tool call this round, in order ──────────────────
      // (emit_ui included — every call gets a plain "Ran <tool>" activity row.)
      const executed: NonNullable<RunHistoryItem['toolCalls']> = [];
      for (const call of calls) {
        if (!runToken.current) break;
        const args = safeParseArgs(call.arguments);

        toolStart(call.id, call.name, args);
        patchLive({ statusState: 'working', statusLabel: `Running ${toolLabel(call.name)}` });
        const r = await executeClientTool(call.name, args, ctx);
        if (!runToken.current) break;
        toolResultUpdate(call.id, r.ok, r.result, r.meta);
        executed.push({
          id: call.id,
          name: call.name,
          args,
          status: r.ok ? 'ok' : 'error',
          result: r.result,
          ...(r.meta ? { meta: r.meta } : {}),
        });
      }

      // Record this round on the working history (assistant + results) —
      // the next round sees the tool results.
      runHistory.push({ role: 'assistant', content: roundText, toolCalls: executed });

      // Checkpoint: persist everything streamed so far (crash/reload safety).
      commitPartial();
    }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (!aborted) {
      hadError = true;
      patchLive({ error: err instanceof Error ? err.message : 'Agent stream failed.' });
    }
  }

  // ── Commit the finished assistant message to the local chat ────────────
  // The timeline is preserved 1:1 (segments incl. UI blocks), plus flattened
  // views (content/toolCalls) for the provider-history contract.
  const finished = get().live;

  if (finished && (finished.timeline.length > 0 || finished.error)) {
    commitToChat([...history, buildAssistantMessage(finished, assistantMsgId)]);
  } else {
    commitToChat(history);
  }

  void hadError;
  abortController = null;
  activeRunToken = null;
  set({ streaming: false, live: null });
  // Workspace may have changed through tool writes.
  get().refreshWorkspaceSoon();
  get().refreshProviderReady();
}

// Re-export for the sidebar/settings surfaces.
export { metaOf };

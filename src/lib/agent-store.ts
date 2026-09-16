/**
 * RGE Agent — client store (zustand + localStorage persistence).
 *
 * Shared state between the three surfaces of the agent feature:
 *   • left sidebar  — chat history (visible only inside the agent view)
 *   • agent view    — streaming chat thread + composer
 *   • right sidebar — workspace file explorer
 *
 * LOCAL STORAGE (per the platform's data policy — the server never stores
 * chats or provider keys): chats, messages AND the provider config are
 * persisted to the user's browser via zustand/persist. Each chat request
 * carries the full conversation + config; the server is stateless. The
 * workspace (real files) still lives on the server through /api/agent/workspace.
 */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AgentChat,
  AgentMessage,
  AgentToolCall,
  AgentEvent,
  AgentConfig,
  WorkspaceFileMeta,
  TreeNode,
  AssistantSegment,
} from '@/lib/agent/types';
import {
  newChatId,
  autoTitle,
  capMessages,
  metaOf,
  sortChats,
  MAX_CHATS,
} from '@/lib/agent/chat-utils';
import { defaultAgentConfig, sanitizeConfig, isConfigured } from '@/lib/agent/config';

// ────────────────────────────────────────────────────────────────────────────
// REST helper (workspace only — chats/config are local)
// ────────────────────────────────────────────────────────────────────────────

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request failed (${res.status})`);
  }
  return body.data as T;
}

// ────────────────────────────────────────────────────────────────────────────
// Streaming state (kept OUT of persisted messages while a turn is running)
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

export type LiveSegment = LiveTextSegment | LiveToolsSegment;

export interface LiveTurn {
  /** Ordered run timeline — rendered exactly as it streamed. Text segments
   * and ONE tools segment holding every call of the run, in stream order. */
  timeline: LiveSegment[];
  /** Set when a tool event occurred after the last text token — the next
   * token must OPEN A NEW text segment instead of appending (the model
   * resumed speaking after tool activity). */
  splitNextText: boolean;
  reasoning: string;
  reasoningSentences: string[];
  /** Latest status pill state. */
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

  // workspace (right sidebar)
  wsFiles: WorkspaceFileMeta[];
  wsTree: TreeNode[];
  wsTotalBytes: number;
  wsLoading: boolean;
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

  // actions — workspace
  loadWorkspace: () => Promise<void>;
  deleteWorkspaceFile: (path: string) => Promise<void>;
  toggleRightPanel: (open?: boolean) => void;

  refreshProviderReady: () => void;
}

let abortController: AbortController | null = null;

/** Parse an SSE body stream into AgentEvent frames. */
async function* sseFrames(res: Response): AsyncGenerator<AgentEvent> {
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
          yield JSON.parse(payload) as AgentEvent;
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

      wsFiles: [],
      wsTree: [],
      wsTotalBytes: 0,
      wsLoading: false,
      rightPanelOpen: true,

      providerReady: null,

      // ── chats (localStorage — no network) ──────────────────────────────

      loadChats: () => {
        // Chats are already in the store (persisted); just re-derive nothing.
        // Kept as an action so existing call sites stay valid.
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
      },

      newChat: () => {
        if (get().streaming) return;
        set({ activeChatId: null, messages: [], stoppedWords: null });
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
            splitNextText: false,
            reasoning: '',
            reasoningSentences: [],
            statusState: 'thinking',
            statusLabel: 'Thinking',
            startedAt: Date.now(),
          },
        });

        await runStream(chatId, history, set, get);
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
            splitNextText: false,
            reasoning: '',
            reasoningSentences: [],
            statusState: 'thinking',
            statusLabel: 'Thinking',
            startedAt: Date.now(),
          },
        });
        await runStream(chatId, history, set, get);
      },

      stop: () => {
        const live = get().live;
        const words = live ? liveTextContent(live) : '';
        if (words) {
          set({ stoppedWords: words });
        }
        abortController?.abort();
        abortController = null;
      },

      continueStopped: () => {
        const words = get().stoppedWords;
        if (!words) return;
        set({ stoppedWords: null });
        // treat the partial answer as context and ask the agent to continue
        get().sendMessage('Continue exactly where you stopped.');
      },

      discardStopped: () => set({ stoppedWords: null }),

      // ── workspace (server — real files) ────────────────────────────────

      loadWorkspace: async () => {
        set({ wsLoading: true });
        try {
          const data = await api<{
            files: WorkspaceFileMeta[];
            tree: TreeNode[];
            totalSizeBytes: number;
          }>('/api/agent/workspace');
          set({
            wsFiles: data.files,
            wsTree: data.tree,
            wsTotalBytes: data.totalSizeBytes,
            wsLoading: false,
          });
        } catch {
          set({ wsLoading: false });
        }
      },

      deleteWorkspaceFile: async (path) => {
        try {
          await api(
            `/api/agent/workspace/file?path=${encodeURIComponent(path)}`,
            { method: 'DELETE' }
          );
        } catch {
          /* refresh regardless */
        }
        await get().loadWorkspace();
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
      storage: createJSONStorage(() => localStorage),
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
// The stream runner — sends full history + config, commits the turn locally.
// ────────────────────────────────────────────────────────────────────────────

type SetState = (partial: Partial<AgentStore> | ((s: AgentStore) => Partial<AgentStore>)) => void;
type GetState = () => AgentStore;

async function runStream(
  chatId: string,
  history: AgentMessage[],
  set: SetState,
  get: GetState
) {
  abortController = new AbortController();
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
          const title =
            c.title === 'New chat' && fallbackTitle ? fallbackTitle : c.title;
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

  try {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({ chatId, messages: history, config }),
    });

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || `Agent request failed (${res.status})`);
    }

    for await (const ev of sseFrames(res)) {
      const live = get().live;
      if (!live) break;

      switch (ev.type) {
        case 'status':
          patchLive({ statusState: ev.state, statusLabel: ev.label });
          break;

        // Text delta → append to the CURRENT text segment. A new segment is
        // created only when the model (re)starts speaking, so tokens always
        // land exactly where the stream produced them — never reordered.
        case 'token': {
          const timeline = live.timeline.slice();
          const last = timeline[timeline.length - 1];
          if (!live.splitNextText && last && last.kind === 'text') {
            timeline[timeline.length - 1] = { ...last, text: last.text + ev.text };
          } else {
            timeline.push({ kind: 'text', id: newSegmentId(), text: ev.text });
          }
          patchLive({ timeline, splitNextText: false });
          break;
        }

        case 'thinking': {
          const reasoning = live.reasoning + ev.text;
          patchLive({ reasoning, reasoningSentences: splitReasoningSentences(reasoning) });
          break;
        }

        // Tool call → the run's ONE tools segment: created at the FIRST tool
        // call and reused for every subsequent call of the run (no matter
        // how many text segments come between). All calls live in the same
        // activity component, in execution order.
        case 'tool_start': {
          const timeline = live.timeline.slice();
          const toolsIdx = timeline.findIndex((s) => s.kind === 'tools');
          const call: LiveToolCall = {
            id: ev.callId,
            name: ev.name,
            args: ev.args,
            status: 'running',
          };
          if (toolsIdx >= 0) {
            const seg = timeline[toolsIdx] as LiveToolsSegment;
            timeline[toolsIdx] = { ...seg, calls: [...seg.calls, call] };
          } else {
            timeline.push({ kind: 'tools', id: newSegmentId(), calls: [call] });
          }
          patchLive({ timeline, splitNextText: true });
          break;
        }

        case 'tool_result': {
          const timeline = live.timeline.map((seg) =>
            seg.kind !== 'tools'
              ? seg
              : {
                  ...seg,
                  calls: seg.calls.map((c) =>
                    c.id === ev.callId
                      ? { ...c, status: ev.ok ? ('ok' as const) : ('error' as const), result: ev.result, meta: ev.meta }
                      : c
                  ),
                }
          );
          patchLive({ timeline, splitNextText: true });
          // plan / todos surface as dedicated UI blocks
          if (ev.name === 'set_plan' && ev.ok) {
            const call = liveToolCalls(live).find((c) => c.id === ev.callId);
            const steps = (call?.args as { steps?: string[] } | undefined)?.steps || [];
            patchLive({ plan: { steps, activeIndex: 0 } });
          }
          if (ev.name === 'write_todos' && ev.ok) {
            const call = liveToolCalls(live).find((c) => c.id === ev.callId);
            const items =
              (call?.args as { items?: { text: string; status?: string }[] } | undefined)?.items ||
              [];
            patchLive({
              todos: items.map((it, i) => ({
                id: `t${i}`,
                text: it.text,
                status:
                  it.status === 'done' ? 'done' : it.status === 'active' ? 'active' : 'pending',
              })),
            });
          }
          break;
        }
        case 'error':
          patchLive({ error: ev.message });
          break;
        case 'done': {
          // advance plan progress to full
          if (live.plan) patchLive({ plan: { ...live.plan, activeIndex: live.plan.steps.length } });
          break;
        }
      }
    }

    // Commit the finished assistant message to the local chat. The timeline
    // is preserved 1:1 (segments), plus flattened views (content/toolCalls)
    // for the provider-history contract and legacy rendering.
    const finished = get().live;
    const finishedCalls = finished ? liveToolCalls(finished) : [];
    if (finished && (finished.timeline.length > 0 || finished.error)) {
      const segments: AssistantSegment[] = finished.timeline
        .filter((s) => (s.kind === 'text' ? s.text.trim().length > 0 : s.calls.length > 0))
        .map((s) =>
          s.kind === 'text'
            ? { kind: 'text' as const, id: s.id, text: s.text }
            : {
                kind: 'tools' as const,
                id: s.id,
                calls: s.calls.map<AgentToolCall>((c) => ({
                  id: c.id,
                  name: c.name,
                  args: c.args,
                  status: c.status === 'error' ? ('error' as const) : ('ok' as const),
                  result: c.result,
                  meta: c.meta,
                })),
              }
        );
      const assistantMsg: AgentMessage = {
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: liveTextContent(finished),
        reasoning: finished.reasoning || undefined,
        ...(finishedCalls.length > 0
          ? {
              toolCalls: finishedCalls.map<AgentToolCall>((c) => ({
                id: c.id,
                name: c.name,
                args: c.args,
                status: c.status === 'error' ? ('error' as const) : ('ok' as const),
                result: c.result,
                meta: c.meta,
              })),
            }
          : {}),
        ...(segments.length > 0 ? { segments } : {}),
        createdAt: new Date().toISOString(),
      };
      commitToChat([...history, assistantMsg]);
    } else {
      commitToChat(history);
    }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (!aborted) {
      const msg = err instanceof Error ? err.message : 'Agent stream failed.';
      patchLive({ error: msg });
      const live = get().live;
      const partial = live ? liveTextContent(live) : '';
      if (live && (partial || live.error)) {
        const assistantMsg: AgentMessage = {
          id: `a_${Date.now()}_err`,
          role: 'assistant',
          content: partial,
          reasoning: live.reasoning || undefined,
          createdAt: new Date().toISOString(),
        };
        commitToChat([...history, assistantMsg]);
      } else {
        commitToChat(history);
      }
    }
  } finally {
    abortController = null;
    set({ streaming: false, live: null });
    // Workspace may have changed through tool writes.
    get().loadWorkspace();
    get().refreshProviderReady();
  }
}

// Re-export for the sidebar/settings surfaces.
export { metaOf };

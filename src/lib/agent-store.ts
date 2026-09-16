/**
 * RGE Agent — client store (zustand).
 *
 * Shared state between the three surfaces of the agent feature:
 *   • left sidebar  — chat history (visible only inside the agent view)
 *   • agent view    — streaming chat thread + composer
 *   • right sidebar — workspace file explorer
 *
 * All network goes through the standard { success, data } contract; the chat
 * stream consumes the SSE AgentEvent frames from POST /api/agent/chat.
 */
'use client';

import { create } from 'zustand';
import type {
  AgentChatMeta,
  AgentChat,
  AgentMessage,
  AgentToolCall,
  AgentEvent,
  WorkspaceFileMeta,
  TreeNode,
} from '@/lib/agent/types';

// ────────────────────────────────────────────────────────────────────────────
// REST helpers
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

export interface LiveTurn {
  /** Streaming assistant message being built. */
  content: string;
  reasoning: string;
  reasoningSentences: string[];
  toolCalls: LiveToolCall[];
  /** Latest status pill state. */
  statusState: 'thinking' | 'working';
  statusLabel: string;
  startedAt: number;
  plan?: { steps: string[]; activeIndex: number };
  todos?: { id: string; text: string; status: 'pending' | 'active' | 'done' }[];
  error?: string;
}

interface AgentStore {
  // chat list (sidebar)
  chats: AgentChatMeta[];
  chatsLoading: boolean;
  activeChatId: string | null;
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

  // actions — chats
  loadChats: () => Promise<void>;
  selectChat: (id: string) => Promise<void>;
  newChat: () => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;

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

  refreshProviderReady: () => Promise<void>;
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

export const useAgentStore = create<AgentStore>((set, get) => ({
  chats: [],
  chatsLoading: false,
  activeChatId: null,
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

  // ── chats ────────────────────────────────────────────────────────────────

  loadChats: async () => {
    set({ chatsLoading: true });
    try {
      const data = await api<{ chats: AgentChatMeta[] }>('/api/agent/chats');
      set({ chats: data.chats, chatsLoading: false });
    } catch {
      set({ chatsLoading: false });
    }
  },

  selectChat: async (id) => {
    if (get().streaming) return;
    set({ chatLoading: true, activeChatId: id, stoppedWords: null });
    try {
      const data = await api<{ chat: AgentChat }>(`/api/agent/chats/${id}`);
      set({ messages: data.chat.messages, chatLoading: false });
    } catch {
      set({ messages: [], chatLoading: false });
    }
  },

  newChat: async () => {
    if (get().streaming) return;
    set({ activeChatId: null, messages: [], stoppedWords: null });
  },

  deleteChat: async (id) => {
    try {
      await api(`/api/agent/chats/${id}`, { method: 'DELETE' });
    } catch {
      /* optimistic removal anyway */
    }
    const wasActive = get().activeChatId === id;
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
    if (wasActive) set({ activeChatId: null, messages: [] });
  },

  renameChat: async (id, title) => {
    set((s) => ({
      chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
    try {
      await api(`/api/agent/chats/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    } catch {
      get().loadChats();
    }
  },

  // ── streaming ────────────────────────────────────────────────────────────

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().streaming || get().chatLoading) return;

    const userMsg: AgentMessage = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      streaming: true,
      stoppedWords: null,
      live: {
        content: '',
        reasoning: '',
        reasoningSentences: [],
        toolCalls: [],
        statusState: 'thinking',
        statusLabel: 'Thinking',
        startedAt: Date.now(),
      },
    }));

    await runStream(get().activeChatId, trimmed, false, set, get);
  },

  regenerate: async () => {
    if (get().streaming || get().chatLoading) return;
    const msgs = get().messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // drop trailing assistant messages after the last user message
    const idx = msgs.lastIndexOf(lastUser);
    set({
      messages: msgs.slice(0, idx + 1),
      streaming: true,
      stoppedWords: null,
      live: {
        content: '',
        reasoning: '',
        reasoningSentences: [],
        toolCalls: [],
        statusState: 'thinking',
        statusLabel: 'Thinking',
        startedAt: Date.now(),
      },
    });
    await runStream(get().activeChatId, lastUser.content, true, set, get);
  },

  stop: () => {
    const live = get().live;
    if (live && live.content) {
      set({ stoppedWords: live.content });
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

  // ── workspace ────────────────────────────────────────────────────────────

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

  refreshProviderReady: async () => {
    try {
      const data = await api<{ configured: boolean }>('/api/agent/config');
      set({ providerReady: data.configured });
    } catch {
      set({ providerReady: false });
    }
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// The stream runner — shared by sendMessage + regenerate.
// ────────────────────────────────────────────────────────────────────────────

type SetState = (partial: Partial<AgentStore> | ((s: AgentStore) => Partial<AgentStore>)) => void;
type GetState = () => AgentStore;

async function runStream(
  chatId: string | null,
  message: string,
  regenerate: boolean,
  set: SetState,
  get: GetState
) {
  abortController = new AbortController();
  let finalChatId = chatId || '';
  let finalTitle = '';

  const patchLive = (patch: Partial<LiveTurn>) =>
    set((s) => (s.live ? { live: { ...s.live, ...patch } } : {}));

  try {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({ chatId: chatId || undefined, message, regenerate }),
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
        case 'token':
          patchLive({ content: live.content + ev.text });
          break;
        case 'thinking': {
          const reasoning = live.reasoning + ev.text;
          patchLive({ reasoning, reasoningSentences: splitReasoningSentences(reasoning) });
          break;
        }
        case 'tool_start':
          patchLive({
            toolCalls: [
              ...live.toolCalls,
              { id: ev.callId, name: ev.name, args: ev.args, status: 'running' },
            ],
          });
          break;
        case 'tool_result': {
          patchLive({
            toolCalls: live.toolCalls.map((c) =>
              c.id === ev.callId
                ? { ...c, status: ev.ok ? 'ok' : 'error', result: ev.result, meta: ev.meta }
                : c
            ),
          });
          // plan / todos surface as dedicated UI blocks
          if (ev.name === 'set_plan' && ev.ok) {
            const call = live.toolCalls.find((c) => c.id === ev.callId);
            const steps = (call?.args as { steps?: string[] } | undefined)?.steps || [];
            patchLive({ plan: { steps, activeIndex: 0 } });
          }
          if (ev.name === 'write_todos' && ev.ok) {
            const call = live.toolCalls.find((c) => c.id === ev.callId);
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
          finalChatId = ev.chatId || finalChatId;
          finalTitle = ev.title || '';
          // advance plan progress to full
          if (live.plan) patchLive({ plan: { ...live.plan, activeIndex: live.plan.steps.length } });
          break;
        }
      }
    }

    // Commit the finished assistant message to the thread.
    const finished = get().live;
    if (finished && (finished.content || finished.toolCalls.length || finished.error)) {
      const assistantMsg: AgentMessage = {
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: finished.content,
        reasoning: finished.reasoning || undefined,
        toolCalls: finished.toolCalls.map<AgentToolCall>((c) => ({
          id: c.id,
          name: c.name,
          args: c.args,
          status: c.status === 'error' ? 'error' : 'ok',
          result: c.result,
          meta: c.meta,
        })),
        createdAt: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, assistantMsg] }));
    }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (!aborted) {
      const msg = err instanceof Error ? err.message : 'Agent stream failed.';
      patchLive({ error: msg });
      const live = get().live;
      if (live && (live.content || live.error)) {
        const assistantMsg: AgentMessage = {
          id: `a_${Date.now()}_err`,
          role: 'assistant',
          content: live.content,
          reasoning: live.reasoning || undefined,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ messages: [...s.messages, assistantMsg] }));
      }
    }
  } finally {
    abortController = null;
    set({ streaming: false, live: null });
    // refresh chat list (title/updatedAt changed, maybe new chat)
    if (finalChatId) set({ activeChatId: finalChatId });
    get().loadChats();
    get().loadWorkspace();
    get().refreshProviderReady();
  }
}

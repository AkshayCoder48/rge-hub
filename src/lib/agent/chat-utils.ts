/**
 * RGE Agent — pure chat helpers (client + server safe, NO engine imports).
 *
 * Chats + config live in the USER'S BROWSER (localStorage via the zustand
 * persist store) — the server never persists conversation data or provider
 * keys. These helpers implement the same caps the old server-side store
 * enforced: 100 chats, 200 messages/chat, 60KB message content, 8KB tool
 * results.
 */

import type { AgentMessage, AgentChatMeta, AgentChat } from './types';

export const MAX_CHATS = 100;
export const MAX_MESSAGES = 200;
export const MAX_CONTENT_CHARS = 60 * 1024;
export const MAX_TOOL_RESULT_CHARS = 8 * 1024;

export function newChatId(): string {
  const rnd = () => Math.random().toString(16).slice(2, 10);
  return `ac_${Date.now().toString(16)}${rnd()}${rnd()}`.slice(0, 23);
}

function truncate(s: string | undefined, max: number, marker = '…[truncated]'): string {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max - marker.length) + marker : s;
}

/** Cap message content (60KB) + every tool result string (8KB) + segments. */
export function capMessage(msg: AgentMessage): AgentMessage {
  const capped: AgentMessage = {
    ...msg,
    content: truncate(msg.content, MAX_CONTENT_CHARS),
  };
  if (msg.reasoning) capped.reasoning = truncate(msg.reasoning, MAX_CONTENT_CHARS);
  if (msg.toolCalls) {
    capped.toolCalls = msg.toolCalls.map((c) => ({
      ...c,
      result: truncate(c.result, MAX_TOOL_RESULT_CHARS),
    }));
  }
  if (msg.segments) {
    capped.segments = msg.segments
      .map((seg) =>
        seg.kind === 'text'
          ? { ...seg, text: truncate(seg.text, MAX_CONTENT_CHARS) }
          : {
              ...seg,
              calls: seg.calls.map((c) => ({
                ...c,
                result: truncate(c.result, MAX_TOOL_RESULT_CHARS),
              })),
            }
      )
      .filter((seg) => (seg.kind === 'text' ? seg.text.length > 0 : seg.calls.length > 0));
  }
  return capped;
}

/** Keep ≤200 messages, always preserving the first user message. */
export function capMessages(messages: AgentMessage[]): AgentMessage[] {
  const capped = messages.map(capMessage);
  if (capped.length <= MAX_MESSAGES) return capped;
  const first = capped[0]?.role === 'user' ? capped[0] : null;
  const rest = first ? capped.slice(-(MAX_MESSAGES - 1)) : capped.slice(-MAX_MESSAGES);
  return first ? [first, ...rest] : rest;
}

/** First 60 chars of a user message, single line. */
export function autoTitle(content: string): string {
  const single = String(content || '').replace(/\s+/g, ' ').trim();
  return single.length > 60 ? single.slice(0, 57) + '…' : single || 'New chat';
}

export function metaOf(chat: AgentChat): AgentChatMeta {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  };
}

/** Sort chats newest-first (used by the sidebar). */
export function sortChats<T extends { updatedAt: string }>(chats: T[]): T[] {
  return [...chats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

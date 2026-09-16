/**
 * RGE Agent — chat persistence (collection 'agentChats', master-authed KV).
 *
 *   `idx:${userId}`                 → AgentChatMeta[] (updatedAt desc, cap 100)
 *   `chat:${userId}:${chatId}`      → AgentChat (messages included)
 *
 * Caps: 100 chats/user (oldest evicted — their chat keys are deleted),
 * 200 messages/chat (the FIRST user message is always kept), 60KB message
 * content, 8KB tool-result strings.
 */

import crypto from 'crypto';
import { kvGet, kvSet, kvDelete } from '../onyxbase';
import type { AgentChat, AgentChatMeta, AgentMessage } from './types';

const CHAT_COLLECTION = 'agentChats';

const MAX_CHATS = 100;
const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 60 * 1024;
const MAX_TOOL_RESULT_CHARS = 8 * 1024;

function indexKey(userId: string): string {
  return `idx:${userId}`;
}

function chatKey(userId: string, chatId: string): string {
  return `chat:${userId}:${chatId}`;
}

export function newChatId(): string {
  return `ac_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Capping helpers
// ────────────────────────────────────────────────────────────────────────────

function truncate(s: string | undefined, max: number, marker = '…[truncated]'): string {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max - marker.length) + marker : s;
}

/** Cap message content (60KB) + every tool result string (8KB). */
function capMessage(msg: AgentMessage): AgentMessage {
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
  return capped;
}

/** Keep ≤200 messages, always preserving the first user message. */
function capMessages(messages: AgentMessage[]): AgentMessage[] {
  const capped = messages.map(capMessage);
  if (capped.length <= MAX_MESSAGES) return capped;
  const first = capped[0]?.role === 'user' ? capped[0] : null;
  const rest = first ? capped.slice(-(MAX_MESSAGES - 1)) : capped.slice(-MAX_MESSAGES);
  return first ? [first, ...rest] : rest;
}

// ────────────────────────────────────────────────────────────────────────────
// Index operations
// ────────────────────────────────────────────────────────────────────────────

export async function listChats(userId: string): Promise<AgentChatMeta[]> {
  const idx = await kvGet<AgentChatMeta[]>(indexKey(userId), CHAT_COLLECTION).catch(() => null);
  if (!Array.isArray(idx)) return [];
  return idx
    .filter((m) => m && typeof m.id === 'string')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function saveIndex(userId: string, metas: AgentChatMeta[]): Promise<void> {
  const sorted = metas
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_CHATS);
  const evicted = metas.slice(MAX_CHATS);
  // Evicted chats are really deleted (no zombie keys in the collection).
  for (const m of evicted) {
    await kvDelete(chatKey(userId, m.id), CHAT_COLLECTION).catch(() => {});
  }
  await kvSet(indexKey(userId), sorted, CHAT_COLLECTION);
}

function metaOf(chat: AgentChat): AgentChatMeta {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Chat CRUD
// ────────────────────────────────────────────────────────────────────────────

export async function createChat(userId: string, title?: string): Promise<AgentChat> {
  const now = new Date().toISOString();
  const chat: AgentChat = {
    id: newChatId(),
    title: (title || 'New chat').slice(0, 120),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await kvSet(chatKey(userId, chat.id), chat, CHAT_COLLECTION);
  const idx = await listChats(userId);
  await saveIndex(userId, [metaOf(chat), ...idx]);
  return chat;
}

export async function getChat(userId: string, chatId: string): Promise<AgentChat | null> {
  const chat = await kvGet<AgentChat>(chatKey(userId, chatId), CHAT_COLLECTION).catch(() => null);
  if (!chat || typeof chat !== 'object' || chat.id !== chatId) return null;
  if (!Array.isArray(chat.messages)) chat.messages = [];
  return chat;
}

export async function renameChat(
  userId: string,
  chatId: string,
  title: string
): Promise<AgentChat | null> {
  const chat = await getChat(userId, chatId);
  if (!chat) return null;
  chat.title = (title || 'Untitled').trim().slice(0, 120) || 'Untitled';
  chat.updatedAt = new Date().toISOString();
  await kvSet(chatKey(userId, chatId), chat, CHAT_COLLECTION);
  const idx = await listChats(userId);
  const entry = idx.find((m) => m.id === chatId);
  if (entry) {
    entry.title = chat.title;
    entry.updatedAt = chat.updatedAt;
    await saveIndex(userId, idx);
  }
  return chat;
}

export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const idx = await listChats(userId);
  const next = idx.filter((m) => m.id !== chatId);
  const removed = await kvDelete(chatKey(userId, chatId), CHAT_COLLECTION).catch(() => false);
  await saveIndex(userId, next);
  return removed !== false || idx.length !== next.length;
}

/** Append messages to a chat (capped), refresh its index entry + title. */
export async function appendMessages(
  userId: string,
  chatId: string,
  msgs: AgentMessage[]
): Promise<AgentChat | null> {
  const chat = await getChat(userId, chatId);
  if (!chat) return null;
  chat.messages = capMessages([...chat.messages, ...msgs]);

  // Auto-title from the first user message while the title is still default.
  const firstUser = chat.messages.find((m) => m.role === 'user');
  if (firstUser && (!chat.title || chat.title === 'New chat')) {
    chat.title = autoTitle(firstUser.content);
  }
  chat.updatedAt = new Date().toISOString();
  await kvSet(chatKey(userId, chatId), chat, CHAT_COLLECTION);

  const idx = await listChats(userId);
  const entry = idx.find((m) => m.id === chatId);
  const meta = metaOf(chat);
  if (entry) {
    Object.assign(entry, meta);
  } else {
    idx.push(meta);
  }
  await saveIndex(userId, idx);
  return chat;
}

/** First 60 chars of a user message, single line. */
export function autoTitle(content: string): string {
  const single = String(content || '').replace(/\s+/g, ' ').trim();
  return single.length > 60 ? single.slice(0, 57) + '…' : single || 'New chat';
}

/**
 * RGE Agent — shared types.
 *
 * The agent is a multi-round, tool-using editing assistant living inside
 * RGE Hub. These types are shared between the server libraries
 * (config / workspace / sessions / llm / tools) and the API routes. The
 * frontend consumes the SAME shapes over JSON REST + the SSE chat stream,
 * so every field here is part of a public contract — change carefully.
 */

// ────────────────────────────────────────────────────────────────────────────
// Provider configuration
// ────────────────────────────────────────────────────────────────────────────

export type AgentProvider = 'zai' | 'openai';

export interface AgentConfig {
  provider: AgentProvider;
  /** OpenAI-compatible base URL (provider 'openai' only), e.g. https://api.openai.com/v1 */
  baseUrl?: string;
  /** Provider API key (provider 'openai' only). NEVER returned raw to the client. */
  apiKey?: string;
  /** Model id. Empty → provider default. */
  model?: string;
  /** Sampling temperature (0–2). */
  temperature?: number;
  maxTokens?: number;
  updatedAt?: string;
}

/** Client-safe view of an AgentConfig — the raw apiKey is masked away. */
export interface AgentConfigPublic {
  provider: AgentProvider;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  hasApiKey: boolean;
  apiKeyMasked?: string;
  updatedAt?: string;
  /** True when the current values are sufficient to run a chat. */
  configured: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Chats
// ────────────────────────────────────────────────────────────────────────────

export interface AgentChatMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AgentChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
}

// ────────────────────────────────────────────────────────────────────────────
// Messages + tool calls
// ────────────────────────────────────────────────────────────────────────────

export type AgentRole = 'user' | 'assistant';

export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  /** Chain-of-thought / reasoning stream (when the provider exposes one). */
  reasoning?: string;
  /** Tool calls made by the assistant in this message (executed results embedded). */
  toolCalls?: AgentToolCall[];
  /**
   * Ordered execution timeline for assistant turns — text segments and tool
   * segments in the exact order the run produced them. This is what the
   * thread renders; `content`/`toolCalls` stay as flattened views for the
   * provider-history contract. Absent on pre-timeline (legacy) messages.
   */
  segments?: AssistantSegment[];
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Assistant run timeline — ordered segments preserving the streamed order.
// ────────────────────────────────────────────────────────────────────────────

export interface TextSegment {
  kind: 'text';
  id: string;
  text: string;
}

export interface ToolsSegment {
  kind: 'tools';
  id: string;
  /** All tool calls of the run, in execution order (ONE activity component). */
  calls: AgentToolCall[];
}

export type AssistantSegment = TextSegment | ToolsSegment;

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error';
  result?: string;
  meta?: ToolResultMeta;
}

// ────────────────────────────────────────────────────────────────────────────
// Tool result metadata — drives the rich UI elements (16-a element library).
// ────────────────────────────────────────────────────────────────────────────

export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

export interface FileDiff {
  filename: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface TreeNode {
  path: string;
  name: string;
  depth: number;
  kind: 'folder' | 'file';
  additions?: number;
  deletions?: number;
}

export interface ArtifactMeta {
  title: string;
  meta?: string;
  generating: boolean;
  words?: number;
}

export interface ToolResultMeta {
  diff?: FileDiff;
  tree?: TreeNode[];
  artifact?: ArtifactMeta;
  files?: string[];
  status?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Workspace
// ────────────────────────────────────────────────────────────────────────────

export interface WorkspaceFileMeta {
  path: string;
  name: string;
  size: number;
  mime: string;
  isText: boolean;
  /** Set when the file was fetched from a hub resource. */
  fromResourceId?: string;
  /** Present when the content is stored as a V5 blob (> INLINE storage cap). */
  blobUrl?: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// SSE events — POST /api/agent/chat streams these as `data: {json}\n\n`.
// ────────────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'status'; state: 'thinking' | 'working'; label: string }
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; callId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; name: string; ok: boolean; result: string; meta?: ToolResultMeta }
  | { type: 'error'; message: string }
  | { type: 'done'; chatId: string; title: string; usage: { rounds: number; ms: number } };

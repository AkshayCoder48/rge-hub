/**
 * RGE Agent — provider protocol (PURE — client + server safe).
 *
 * Extracted from llm.ts so the BROWSER agent engine can build provider
 * messages + parse events without ever importing the server-side SDK
 * (z-ai-web-dev-sdk is server-only). llm.ts re-exports everything below.
 */

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Provider-neutral chat message (superset; serialized per provider). */
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Openai-style tool calls (assistant messages). */
  toolCalls?: { id: string; name: string; arguments: string }[];
  toolCallId?: string;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type StreamChatEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_calls'; calls: ParsedToolCall[] }
  | { type: 'finish'; reason: string };

/** Wire events of POST /api/agent/completions (SSE frames). */
export type CompletionsWireEvent =
  | StreamChatEvent
  | { type: 'error'; message: string };

/**
 * Normalize an OpenAI-compatible base URL: strip trailing slashes, append
 * /v1 when the URL has no version suffix (e.g. https://api.openai.com →
 * https://api.openai.com/v1). URLs that already end with /v1 (or contain
 * one, like /openai/v1) pass through untouched — never /v1/v1/models.
 */
export function normalizeOpenAiBaseUrl(raw: string): string {
  let base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\/v\d+(\/|$)/.test(base)) return base;
  return `${base}/v1`;
}

/**
 * Build the provider message array for one chat turn.
 *
 * openai: native — assistant tool_calls + role:'tool' results.
 * zai:    SDK ChatMessage only allows system|user|assistant strings, so the
 *         same history is serialized: tool calls become an assistant note
 *         and results become a user message labelled [tool results].
 */
export function buildProviderMessages(
  provider: 'zai' | 'openai',
  history: {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: { id: string; name: string; args: Record<string, unknown>; status: string; result?: string }[];
  }[],
  systemPrompt: string
): ProviderMessage[] {
  const out: ProviderMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    // assistant
    if (!m.toolCalls?.length) {
      out.push({ role: 'assistant', content: m.content || '' });
      continue;
    }
    if (provider === 'openai') {
      out.push({
        role: 'assistant',
        content: m.content || '',
        toolCalls: m.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: JSON.stringify(c.args ?? {}),
        })),
      });
      for (const c of m.toolCalls) {
        out.push({ role: 'tool', toolCallId: c.id, content: c.result || '(no result)' });
      }
    } else {
      const callNote = m.toolCalls
        .map((c) => `- ${c.name}(${JSON.stringify(c.args ?? {})}) → ${c.status}: ${String(c.result || '').slice(0, 2000)}`)
        .join('\n');
      if (m.content) out.push({ role: 'assistant', content: m.content });
      out.push({
        role: 'user',
        content: `[tool results]\n${callNote}\n(Continue with the next tool call or your final answer.)`,
      });
    }
  }
  return out;
}

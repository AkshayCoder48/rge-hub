/**
 * RGE Agent — LLM provider abstraction.
 *
 * streamChat(cfg, messages, tools) yields a unified event stream:
 *   token     — assistant text delta
 *   thinking  — reasoning delta (delta.reasoning_content | delta.reasoning)
 *   tool_calls — complete parsed tool calls for this round (native
 *                tool_calls chunks, OR the JSON-action fallback below)
 *   finish    — round terminator ('stop' | 'tool_calls' | 'length' | …)
 *
 * Providers:
 *  - 'openai'  : any OpenAI-compatible /chat/completions endpoint. Full
 *                native tool_calls streaming support (index-based argument
 *                fragment accumulation).
 *  - 'zai'     : z-ai-web-dev-sdk (sandbox-provisioned credentials, see
 *                /etc/.z-ai-config). The SDK returns the raw SSE body when
 *                stream:true and its endpoint is OpenAI-shaped, so native
 *                tool_calls chunks are parsed the same way when present.
 *
 * JSON-ACTION FALLBACK (zai): when the backend model ignores/rejects the
 * native `tools` parameter, the model is ALSO instructed (via the system
 * prompt built in chat/route.ts) that it may answer a round with a SINGLE
 * JSON object:
 *     {"action": {"name": "<tool>", "args": {...}}}   → run one tool
 *     {"reply": "plain text"}                         → plain reply
 * streamChat detects a leading `{"` in the content, buffers it (no tokens
 * are forwarded), and emits it as tool_calls / token events at stream end.
 * A malformed JSON buffer falls back to honest token output — the user sees
 * exactly what the model said, never a fabricated success.
 */

import type { AgentConfig } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** OpenAI function-tool schema (also understood by GLM endpoints). */
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

const CALL_TIMEOUT_MS = 55_000;

// ────────────────────────────────────────────────────────────────────────────
// Base URL normalization (openai)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an OpenAI-compatible base URL: strip trailing slashes, append
 * /v1 when the URL has no version suffix (e.g. https://api.openai.com →
 * https://api.openai.com/v1). URLs that already end with /v1 (or contain
 * one, like /v1/…) pass through untouched.
 */
export function normalizeOpenAiBaseUrl(raw: string): string {
  let base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\/v\d+(\/|$)/.test(base)) return base;
  return `${base}/v1`;
}

// ────────────────────────────────────────────────────────────────────────────
// SSE body → StreamChatEvent (shared by both providers)
// ────────────────────────────────────────────────────────────────────────────

interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
}

/**
 * Parse an OpenAI-shaped SSE chat stream into unified events.
 *
 * `jsonAction` enables the JSON-action fallback: content that starts with
 * `{"` is buffered (tokens suppressed) and parsed at stream end into a
 * tool_calls event ({"action":{name,args}}) or a single token event
 * ({"reply":"..."}). Malformed JSON → the buffered text is emitted as
 * honest tokens.
 */
export async function* parseOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  opts: { jsonAction?: boolean } = {}
): AsyncGenerator<StreamChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason = 'stop';

  // content accumulation
  let content = '';
  let jsonMode: boolean | null = null; // null = undecided
  let pendingText = ''; // buffered while deciding / in json mode

  // tool-call accumulation (index-keyed)
  const toolAcc = new Map<number, ToolCallAcc>();

  const emitText = (text: string): StreamChatEvent[] => {
    if (!text) return [];
    return [{ type: 'token', text }];
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk: any;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        const choice = chunk?.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || choice.message || {};

        // reasoning stream (reasoning_content is the GLM/deepseek shape;
        // some providers use plain `reasoning`)
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === 'string' && reasoning) {
          yield { type: 'thinking', text: reasoning };
        }

        // native tool_call fragments
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            let acc = toolAcc.get(idx);
            if (!acc) {
              acc = { id: tc.id || `call_${idx}_${Date.now()}`, name: '', args: '' };
              toolAcc.set(idx, acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }

        // content
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          if (opts.jsonAction) {
            if (jsonMode === null) {
              pendingText += delta.content;
              const seen = pendingText.replace(/^\s+/, '');
              if (seen.startsWith('{"') || seen.startsWith('```')) {
                // JSON object or a ```json fence — buffer (may be an action).
                jsonMode = true;
              } else if (seen.length >= 1 && seen[0] !== '{' && seen[0] !== '`') {
                jsonMode = false;
                const events = emitText(pendingText);
                pendingText = '';
                for (const e of events) yield e;
              }
              // Only whitespace / a lone `{` or `` ` `` so far — keep deciding
              // (flushed honestly at stream end if it never resolves).
            } else if (jsonMode) {
              pendingText += delta.content;
            } else {
              yield { type: 'token', text: delta.content };
            }
          } else {
            yield { type: 'token', text: delta.content };
          }
        }

        if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* stream already closed */
    }
  }

  // Native tool calls win when present.
  if (toolAcc.size > 0) {
    const calls: ParsedToolCall[] = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, acc]) => ({
        id: acc.id || `call_${i}`,
        name: acc.name || '',
        arguments: acc.args || '{}',
      }))
      .filter((c) => c.name);
    if (calls.length > 0) {
      yield { type: 'tool_calls', calls };
      yield { type: 'finish', reason: 'tool_calls' };
      return;
    }
  }

  // JSON-action fallback (buffered content).
  const trimmedPending = pendingText.trim();
  if (opts.jsonAction && jsonMode && (trimmedPending.startsWith('{') || trimmedPending.startsWith('```'))) {
    const parsed = parseJsonAction(pendingText);
    if (parsed?.action) {
      yield {
        type: 'tool_calls',
        calls: [
          {
            id: `call_json_${Date.now()}`,
            name: parsed.action.name,
            arguments: JSON.stringify(parsed.action.args ?? {}),
          },
        ],
      };
      yield { type: 'finish', reason: 'tool_calls' };
      return;
    }
    if (parsed && typeof parsed.reply === 'string') {
      const events = emitText(parsed.reply);
      for (const e of events) yield e;
      yield { type: 'finish', reason: finishReason };
      return;
    }
    // Malformed JSON — emit the raw buffered text honestly.
    const events = emitText(pendingText);
    for (const e of events) yield e;
    yield { type: 'finish', reason: finishReason };
    return;
  }

  // Flush anything still buffered (undecided whitespace-only case).
  if (pendingText) {
    const events = emitText(pendingText);
    for (const e of events) yield e;
  }
  yield { type: 'finish', reason: finishReason };
}

// ────────────────────────────────────────────────────────────────────────────
// JSON-action protocol parsing
// ────────────────────────────────────────────────────────────────────────────

export interface JsonAction {
  action?: { name: string; args?: Record<string, unknown> };
  reply?: string;
}

/**
 * Parse a model reply as a JSON action. Accepts the JSON object whether or
 * not it is wrapped in markdown fences, and whether args is an object or a
 * JSON string.
 */
export function parseJsonAction(text: string): JsonAction | null {
  let raw = String(text || '').trim();
  if (!raw) return null;
  // strip markdown fences BEFORE the { check (models love ```json fences)
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) raw = fence[1].trim();
  if (!raw.startsWith('{')) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      const out: JsonAction = {};
      if (obj.action && typeof obj.action === 'object' && typeof obj.action.name === 'string') {
        let args = obj.action.args ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        out.action = { name: obj.action.name, args: args && typeof args === 'object' ? args : {} };
      }
      if (typeof obj.reply === 'string') out.reply = obj.reply;
      return out;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Provider: openai (any OpenAI-compatible endpoint)
// ────────────────────────────────────────────────────────────────────────────

async function* streamOpenAi(
  cfg: AgentConfig,
  messages: ProviderMessage[],
  tools: ToolSchema[]
): AsyncGenerator<StreamChatEvent> {
  const base = normalizeOpenAiBaseUrl(cfg.baseUrl || '');
  if (!base || !cfg.apiKey) {
    throw new Error('OpenAI-compatible provider needs a base URL and an API key (Settings → Agent).');
  }

  const body: Record<string, unknown> = {
    model: cfg.model || 'gpt-4o-mini',
    messages: messages.map((m) => {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.arguments },
          })),
        };
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
      }
      return { role: m.role, content: m.content };
    }),
    stream: true,
    temperature: cfg.temperature ?? 0.6,
    max_tokens: cfg.maxTokens ?? 4096,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/abort/i.test(msg) ? 'Provider request timed out after 55s.' : `Provider unreachable: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const excerpt = text.slice(0, 300).replace(/\s+/g, ' ');
    if (res.status === 401 || res.status === 403) {
      throw new Error(`API key rejected by provider (HTTP ${res.status}). Check the key in Settings → Agent.`);
    }
    throw new Error(`Provider error HTTP ${res.status}: ${excerpt || '(no body)'}`);
  }
  if (!res.body) throw new Error('Provider returned an empty stream.');

  yield* parseOpenAiSseStream(res.body, { jsonAction: false });
}

// ────────────────────────────────────────────────────────────────────────────
// Provider: zai (z-ai-web-dev-sdk)
// ────────────────────────────────────────────────────────────────────────────

/** Typed escape hatch for the SDK's `any`-typed create(). */
interface ZaiChatCompletions {
  create: (body: Record<string, unknown>) => Promise<any>;
}
interface ZaiInstance {
  chat: { completions: ZaiChatCompletions };
}

async function getZaiClient(): Promise<ZaiInstance> {
  // Dynamic import: keeps the SDK (fs/paths at config-load time) out of any
  // edge/client bundling of this module's dependents.
  const mod = (await import('z-ai-web-dev-sdk')) as unknown as { default: { create: () => Promise<ZaiInstance> } };
  const ZAI = mod.default;
  return ZAI.create();
}

/**
 * zai: attempt NATIVE tools first; when the endpoint rejects them (HTTP 4xx
 * mentioning tools/functions, or a stream that never opens) fall back to a
 * tools-free call where the JSON-action protocol (system-prompt driven)
 * carries tool use.
 */
async function* streamZai(
  cfg: AgentConfig,
  messages: ProviderMessage[],
  tools: ToolSchema[]
): AsyncGenerator<StreamChatEvent> {
  let zai: ZaiInstance;
  try {
    zai = await getZaiClient();
  } catch (err) {
    throw new Error(
      `Built-in Z.AI provider is unavailable (${err instanceof Error ? err.message : String(err)}). Configure an OpenAI-compatible provider in Settings → Agent.`
    );
  }

  const sdkMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  const baseBody: Record<string, unknown> = {
    messages: sdkMessages,
    stream: true,
    temperature: cfg.temperature ?? 0.6,
    max_tokens: cfg.maxTokens ?? 4096,
    thinking: { type: 'enabled' },
  };
  if (cfg.model) baseBody.model = cfg.model;

  // The SDK resolves the stream after headers arrive; race it against a
  // timeout so a hung endpoint cannot stall the whole route.
  const withTimeout = async (body: Record<string, unknown>): Promise<any> => {
    return Promise.race([
      zai.chat.completions.create(body),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Provider request timed out after 55s.')), CALL_TIMEOUT_MS)
      ),
    ]);
  };

  let stream: any;
  let nativeTools = tools.length > 0;
  if (nativeTools) {
    try {
      stream = await withTimeout({ ...baseBody, tools, tool_choice: 'auto' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 4xx that mentions tools/functions → endpoint lacks native support;
      // anything else is a real failure.
      if (/status 4\d\d/i.test(msg) && /(tool|function)/i.test(msg)) {
        nativeTools = false;
      } else {
        throw new Error(`Z.AI provider error: ${msg}`);
      }
    }
  }
  if (!stream) {
    stream = await withTimeout(baseBody);
  }

  // The SDK returns either a ReadableStream (SSE) or a completed JSON object
  // (when the endpoint ignores stream:true). JSON-action parsing stays ON
  // even with native tools — native tool_calls fragments win when present,
  // otherwise a leading `{"…` reply is treated as a JSON action.
  if (stream && typeof stream.getReader === 'function') {
    yield* parseOpenAiSseStream(stream as ReadableStream<Uint8Array>, {
      jsonAction: true,
    });
    return;
  }
  void nativeTools;

  // Non-stream JSON completion object — map it directly.
  const choice = stream?.choices?.[0];
  const message = choice?.message ?? {};
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning = message.reasoning_content ?? message.reasoning;
  if (typeof reasoning === 'string' && reasoning) {
    yield { type: 'thinking', text: reasoning };
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const calls = message.tool_calls
      .map((tc: any, i: number) => ({
        id: tc.id || `call_${i}`,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      }))
      .filter((c: ParsedToolCall) => c.name);
    if (calls.length > 0) {
      yield { type: 'tool_calls', calls };
      yield { type: 'finish', reason: 'tool_calls' };
      return;
    }
  }
  if (content.trim().startsWith('{')) {
    const parsed = parseJsonAction(content);
    if (parsed?.action) {
      yield {
        type: 'tool_calls',
        calls: [
          {
            id: `call_json_${Date.now()}`,
            name: parsed.action.name,
            arguments: JSON.stringify(parsed.action.args ?? {}),
          },
        ],
      };
      yield { type: 'finish', reason: 'tool_calls' };
      return;
    }
    if (parsed && typeof parsed.reply === 'string') {
      yield { type: 'token', text: parsed.reply };
      yield { type: 'finish', reason: choice?.finish_reason || 'stop' };
      return;
    }
  }
  if (content) yield { type: 'token', text: content };
  yield { type: 'finish', reason: choice?.finish_reason || 'stop' };
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

export function streamChat(
  cfg: AgentConfig,
  messages: ProviderMessage[],
  tools: ToolSchema[]
): AsyncGenerator<StreamChatEvent> {
  if (cfg.provider === 'openai') {
    return streamOpenAi(cfg, messages, tools);
  }
  return streamZai(cfg, messages, tools);
}

// ────────────────────────────────────────────────────────────────────────────
// Conversation serialization (persisted AgentMessage[] → provider messages)
// ────────────────────────────────────────────────────────────────────────────

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

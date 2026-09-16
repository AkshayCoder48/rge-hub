/**
 * POST /api/agent/completions — ONE-ROUND streaming proxy for the browser
 * RGE Agent engine.
 *
 * The multi-round agent loop + tool execution now run in the USER'S BROWSER
 * (the workspace is a web container there). This route is deliberately thin:
 * it forwards ONE provider round and streams the unified event protocol
 * back, so the client keeps full control of ordering, the timeline UI and
 * client-side tools. Provider credentials ride the request from
 * localStorage and are NEVER persisted or logged.
 *
 * Body: {
 *   config: AgentConfig          — provider config (client localStorage)
 *   messages: ProviderMessage[]  — system + history + this run's rounds
 *   tools: ToolSchema[]          — client tool catalog (passed through)
 * }
 *
 * Response: text/event-stream of CompletionsWireEvent frames:
 *   data: {"type":"token","text":"…"}
 *   data: {"type":"thinking","text":"…"}
 *   data: {"type":"tool_calls","calls":[{id,name,arguments}]}
 *   data: {"type":"finish","reason":"stop"}
 *   data: {"type":"error","message":"…"}   — honest failure, stream ends
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { sanitizeConfig, isConfigured } from '@/lib/agent/config';
import { streamChat } from '@/lib/agent/llm';
import type { ToolSchema, ProviderMessage, CompletionsWireEvent } from '@/lib/agent/protocol';
import type { AgentConfig } from '@/lib/agent/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 240;
const MAX_TOOLS = 40;
const MAX_CONTENT_CHARS = 60 * 1024;

function sanitizeMessages(raw: unknown): ProviderMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ProviderMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as ProviderMessage).role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
    const content = String((m as ProviderMessage).content ?? '').slice(0, MAX_CONTENT_CHARS);
    const msg: ProviderMessage = { role, content };
    const toolCalls = (m as ProviderMessage).toolCalls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      msg.toolCalls = toolCalls.slice(0, 32).map((c, i) => ({
        id: String(c?.id ?? `call_${i}`).slice(0, 80),
        name: String(c?.name ?? '').slice(0, 80),
        arguments: String(c?.arguments ?? '{}').slice(0, 60 * 1024),
      }));
    }
    const toolCallId = (m as ProviderMessage).toolCallId;
    if (typeof toolCallId === 'string') msg.toolCallId = toolCallId.slice(0, 80);
    out.push(msg);
    if (out.length >= MAX_MESSAGES) break;
  }
  return out;
}

function sanitizeTools(raw: unknown): ToolSchema[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolSchema[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const fn = (t as ToolSchema).function;
    if (!fn || typeof fn.name !== 'string' || !fn.name) continue;
    out.push({
      type: 'function',
      function: {
        name: fn.name.slice(0, 80),
        description: String(fn.description ?? '').slice(0, 4000),
        parameters:
          fn.parameters && typeof fn.parameters === 'object'
            ? (fn.parameters as Record<string, unknown>)
            : { type: 'object', properties: {} },
      },
    });
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now().toString(36)}`;

  // Auth before the stream opens (clean 401 for fetch()).
  const sessionResult = await getSession();
  if (sessionResult.status !== 'ok') {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' }, requestId },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const config = sanitizeConfig((body?.config ?? {}) as AgentConfig);
  const messages = sanitizeMessages(body?.messages);
  const tools = sanitizeTools(body?.tools);

  if (messages.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Provide the conversation messages.' }, requestId },
      { status: 400 }
    );
  }

  if (!isConfigured(config)) {
    const why =
      config.provider === 'openai'
        ? 'The OpenAI-compatible provider needs a base URL — set it in Settings → Agent.'
        : 'The built-in provider is not available right now — configure an OpenAI-compatible provider in Settings → Agent.';
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: why }, requestId },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: CompletionsWireEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          closed = true;
        }
      };

      try {
        for await (const ev of streamChat(config, messages, tools)) {
          if (closed) break;
          send(ev);
        }
      } catch (err) {
        // Honest failure — the client surfaces the message in the timeline.
        send({ type: 'error', message: err instanceof Error ? err.message : 'Provider stream failed.' });
      }
      finish();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'x-request-id': requestId,
    },
  });
}

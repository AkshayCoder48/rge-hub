/**
 * POST /api/agent/chat — the RGE Agent core (SSE, STATELESS).
 *
 * Chats + provider config live in the USER'S BROWSER (localStorage). The
 * client sends the FULL conversation with every turn; the server runs the
 * multi-round LLM loop + tools, streams the frames, and persists NOTHING
 * (except real workspace file writes, which go through the tools).
 *
 * Body: {
 *   chatId?: string            — client-managed chat id (echoed on done)
 *   messages: AgentMessage[]   — full history INCLUDING the new user message
 *                                (for regenerate the client already dropped
 *                                the trailing assistant turns)
 *   config: AgentConfig        — provider config from localStorage (the API
 *                                key rides the request and is never stored)
 * }
 *
 * Response: text/event-stream of AgentEvent frames:
 *   data: {"type":"status","state":"thinking"|"working","label":"…"}
 *   data: {"type":"token","text":"…"}          — assistant text deltas
 *   data: {"type":"thinking","text":"…"}       — reasoning deltas
 *   data: {"type":"tool_start","callId","name","args"}
 *   data: {"type":"tool_result","callId","name","ok","result","meta"?}
 *   data: {"type":"error","message":"…"}       — honest failure, then done
 *   data: {"type":"done","chatId","title","usage":{"rounds","ms"}}
 *
 * Multi-round loop: up to 12 rounds / 50s cumulative LLM time. Tool
 * execution runs between rounds. Errors mid-stream still end with error +
 * done — never a fake success.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, type SessionData } from '@/lib/session';
import { newRequestId } from '@/lib/api-contract';
import { sanitizeConfig, isConfigured } from '@/lib/agent/config';
import { loadIndex } from '@/lib/agent/workspace';
import { streamChat, buildProviderMessages, type ParsedToolCall } from '@/lib/agent/llm';
import { executeTool, TOOLS, type ToolContext } from '@/lib/agent/tools';
import type { AgentEvent, AgentMessage, AgentConfig, AgentToolCall } from '@/lib/agent/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_ROUNDS = 12;
const LLM_BUDGET_MS = 50_000;
const HARD_DEADLINE_MS = 230_000; // safety net incl. slow tools (speedramp)
const MAX_HISTORY_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 60 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Compact workspace listing for the system prompt (cap 60 files). */
async function workspaceListing(userId: string): Promise<string> {
  const files = await loadIndex(userId);
  if (files.length === 0) return '(empty — no files yet)';
  const lines = files.slice(0, 60).map((f) => `- ${f.path} (${fmtKB(f.size)})`);
  const extra = files.length > 60 ? `\n… +${files.length - 60} more` : '';
  return `${files.length} file(s), ${fmtKB(files.reduce((s, f) => s + (f.size || 0), 0))}:\n${lines.join('\n')}${extra}`;
}

function buildSystemPrompt(session: SessionData, tree: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const who = `${session.displayName || session.username}${session.isAdmin ? ' (hub administrator)' : ''}`;
  return [
    'You are RGE Agent — a multi-round AI editing agent living inside RGE Hub, an editing platform where users store images, video clips and XML edit files as "resources".',
    '',
    'You have a PERSISTENT per-user workspace (a virtual filesystem) that survives across chats. Tools read and write files there; fetched hub resources land in resources/.',
    '',
    'WORKFLOW RULES:',
    '- For any multi-step task, FIRST call set_plan with the ordered steps, then work through them. Use write_todos when you discover additional work along the way.',
    '- Execute tools round by round; after each result decide the next step. Verify your work (read_file / list_files) before declaring done.',
    '- Publish finished artifacts with publish_file, and speed-ramp clips with speedramp_clip when asked.',
    '- Be concise. Plain, short answers when no tools are needed.',
    '',
    'TOOL CALLING: prefer the native tool_calls mechanism of the API.',
    'If (and only if) native tool calls are unavailable, answer a round with a SINGLE JSON object and nothing else:',
    '  {"action": {"name": "<tool name>", "args": {…}}}  → to run one tool',
    '  {"reply": "your text"}                             → for a plain reply',
    '',
    `Workspace contents:\n${tree}`,
    '',
    `Today: ${today}. Current user: ${who}.`,
  ].join('\n');
}

/** Conversation item shape consumed by buildProviderMessages. */
interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown>; status: string; result?: string }[];
}

/** Sanitize the client-supplied history (cap size, roles, strings). */
function sanitizeHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter((m): m is AgentMessage =>
      !!m && typeof m === 'object' && typeof (m as AgentMessage).content === 'string' &&
      ((m as AgentMessage).role === 'user' || (m as AgentMessage).role === 'assistant'))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: String(m.content).slice(0, MAX_MESSAGE_CHARS),
      ...(Array.isArray(m.toolCalls) && m.toolCalls.length
        ? {
            toolCalls: m.toolCalls.slice(0, 32).map((c) => ({
              id: String(c.id || '').slice(0, 64),
              name: String(c.name || '').slice(0, 64),
              args: (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, unknown>,
              status: String(c.status || 'ok'),
              result: c.result === undefined ? undefined : String(c.result).slice(0, 8 * 1024),
            })),
          }
        : {}),
    }));
  return msgs;
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  // ── Auth before the stream opens (clean 401 for fetch()) ──────────────
  const sessionResult = await getSession();
  if (sessionResult.status !== 'ok') {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' }, requestId },
      { status: 401 }
    );
  }
  const session = sessionResult.session;
  const userId = session.userId;

  const body = await request.json().catch(() => null);
  const chatIdIn = typeof body?.chatId === 'string' ? body.chatId.trim().slice(0, 64) : '';
  const history = sanitizeHistory(body?.messages);
  const config = sanitizeConfig((body?.config ?? {}) as AgentConfig);

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Provide the conversation (last message must be from the user).' },
        requestId,
      },
      { status: 400 }
    );
  }

  const t0 = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // client disconnected — keep working, stop sending
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

      let rounds = 0;
      let hadError = false;
      let assistantText = '';
      let toolCallsRun = 0;

      try {
        // ── Provider config (from the request — never persisted) ─────────
        if (!isConfigured(config)) {
          const why =
            config.provider === 'openai'
              ? 'The OpenAI-compatible provider needs a base URL and an API key — set them in Settings → Agent.'
              : 'The built-in provider is not available right now — configure an OpenAI-compatible provider in Settings → Agent.';
          send({ type: 'error', message: why });
          finish();
          return;
        }

        // ── System prompt (with live workspace tree) ───────────────────
        const tree = await workspaceListing(userId);
        const systemPrompt = buildSystemPrompt(session, tree);

        const ctx: ToolContext = { userId, session, req: request };
        let llmTimeMs = 0;

        // ── Multi-round loop ──────────────────────────────────────────
        while (
          rounds < MAX_ROUNDS &&
          llmTimeMs < LLM_BUDGET_MS &&
          Date.now() - t0 < HARD_DEADLINE_MS &&
          !closed
        ) {
          rounds++;
          send({ type: 'status', state: 'thinking', label: rounds === 1 ? 'Thinking' : 'Continuing' });

          const providerMessages = buildProviderMessages(config.provider, history, systemPrompt);
          const roundStart = Date.now();
          let roundText = '';
          let calls: ParsedToolCall[] = [];
          let streamError: string | null = null;

          try {
            for await (const ev of streamChat(config, providerMessages, TOOLS)) {
              if (closed) break;
              if (ev.type === 'token') {
                roundText += ev.text;
                send(ev);
              } else if (ev.type === 'tool_calls') {
                calls = ev.calls;
              }
              // 'finish' — the for-await ends on its own
            }
          } catch (err) {
            streamError = err instanceof Error ? err.message : String(err);
          }

          assistantText += roundText;
          toolCallsRun += calls.length;
          llmTimeMs += Date.now() - roundStart;

          if (streamError) {
            hadError = true;
            send({ type: 'error', message: streamError });
            break;
          }

          if (calls.length > 0) {
            // ── Execute every tool call this round ─────────────────────
            const executed: AgentToolCall[] = [];
            for (const call of calls) {
              let args: Record<string, unknown> = {};
              if (call.arguments) {
                try {
                  args = JSON.parse(call.arguments);
                  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
                } catch {
                  args = {};
                }
              }
              send({ type: 'tool_start', callId: call.id, name: call.name, args });
              send({ type: 'status', state: 'working', label: `Running ${call.name}` });
              const res = await executeTool(call.name, args, ctx);
              const tc: AgentToolCall = {
                id: call.id,
                name: call.name,
                args,
                status: res.ok ? 'ok' : 'error',
                result: res.result,
                ...(res.meta ? { meta: res.meta } : {}),
              };
              executed.push(tc);
              send({
                type: 'tool_result',
                callId: call.id,
                name: call.name,
                ok: res.ok,
                result: res.result,
                ...(res.meta ? { meta: res.meta } : {}),
              });
              if (Date.now() - t0 >= HARD_DEADLINE_MS) break;
            }
            // Record this round on the working history (assistant + results).
            history.push({
              role: 'assistant',
              content: roundText,
              toolCalls: executed,
            });
            continue; // next round sees the tool results
          }

          // Plain reply (no tool calls) → conversation turn complete.
          break;
        }

        if (!closed && !hadError && assistantText === '' && toolCallsRun === 0) {
          // Nothing streamed at all — either the budget ran out before the
          // provider produced anything, or the provider returned an empty
          // completion. Honest error either way (no fake success).
          send({
            type: 'error',
            message:
              llmTimeMs >= LLM_BUDGET_MS
                ? 'The provider was too slow to answer within the time budget. Try again or switch providers in Settings → Agent.'
                : 'The provider returned an empty response. Try again or check the model configuration in Settings → Agent.',
          });
          hadError = true;
        }
      } catch (err) {
        hadError = true;
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unexpected agent error.' });
      }

      if (!closed) {
        send({
          type: 'done',
          chatId: chatIdIn,
          title: '',
          usage: { rounds, ms: Date.now() - t0 },
        });
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

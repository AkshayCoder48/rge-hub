/**
 * RGE Hub — direct MCPEmails client (PRD §2, §5).
 *
 * MCPEmails (https://mcpemails.com/docs) is a Streamable HTTP MCP server:
 *   POST https://mcpemails.com/api/mcp  (JSON-RPC 2.0, Bearer mcpe_* key)
 * Rate limits per key: 100 req/min · 1,000/hr · 10,000/day.
 *
 * SECURITY (PRD §5):
 *   - The API key lives ONLY in the server-side env (MCPEMAILS_API_KEY).
 *     It is never sent to the browser and never logged.
 *   - Requests go phone → RGE backend → MCPEmails. The backend IP is what
 *     MCPEmails sees. NO client-IP spoofing, ever.
 *   - MCPEMAILS_INBOX_ID is optional: single-inbox keys auto-resolve the
 *     sender (verified against the MCPEmails argument schema — unknown
 *     email_compose arguments are REJECTED, so we only send documented args).
 *
 * Idempotency (PRD §7): outbound sends carry an `Idempotency-Key` header so a
 * safely-retried identical request reuses the provider's result instead of
 * double-sending. We do NOT blindly retry sends — a provider may already
 * have accepted the message (MCPEmails' own guidance).
 *
 * This module mirrors the proven client in OnyxBase (src/lib/mcpemail.ts):
 * tool-level failures arrive as HTTP 200 + result.isError — those are REAL
 * failures and are surfaced, never swallowed.
 */

const MCPEMAIL_ENDPOINT = process.env.MCPEMAILS_ENDPOINT || 'https://mcpemails.com/api/mcp';
const TIMEOUT_MS = 15_000;

export class McpeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: 'auth_failed' | 'rate_limited' | 'timeout' | 'network_error' | 'rpc_error' | 'tool_error' | 'http_error' | 'empty_result'
  ) {
    super(message);
    this.name = 'McpeError';
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  messageId?: string;
  id?: string;
  notes?: string[];
  [key: string]: unknown;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

/** Single JSON-RPC call. NEVER logs the bearer key. */
async function rpc<T = unknown>(
  apiKey: string,
  method: string,
  params: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(MCPEMAIL_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'rge-hub', version: '1.0' },
          capabilities: {},
          ...params,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code =
        res.status === 401 || res.status === 403
          ? 'auth_failed'
          : res.status === 429
            ? 'rate_limited'
            : 'http_error';
      throw new McpeError(
        `MCPEmails returned HTTP ${res.status}${text ? `: ${truncate(text, 200)}` : ''}`,
        res.status,
        code
      );
    }
    const data = (await res.json().catch(() => null)) as JsonRpcResponse<T> | null;
    if (!data) throw new McpeError('MCPEmails returned an unparseable body', 200, 'empty_result');
    if (data.error) {
      throw new McpeError(`MCPEmails RPC error (${data.error.code}): ${data.error.message}`, 200, 'rpc_error');
    }
    if (!data.result) throw new McpeError('MCPEmails returned an empty result.', 200, 'empty_result');
    const result = data.result as unknown as ToolCallResult;
    if (result && result.isError === true) {
      throw new McpeError(`MCPEmails tool error: ${toolErrorText(result)}`, 200, 'tool_error');
    }
    return data.result;
  } catch (err) {
    if (err instanceof McpeError) throw err;
    if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) {
      throw new McpeError('MCPEmails request timed out (15s).', 408, 'timeout');
    }
    throw new McpeError(
      `Network error reaching MCPEmails: ${err instanceof Error ? err.message : String(err)}`,
      0,
      'network_error'
    );
  } finally {
    clearTimeout(timer);
  }
}

function toolErrorText(result: ToolCallResult): string {
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        parts.push(block.text.trim());
      }
    }
  }
  return truncate(parts.join(' '), 400) || 'unknown tool error (isError: true)';
}

export function hasDirectMcpemailsKey(): boolean {
  const k = process.env.MCPEMAILS_API_KEY;
  return typeof k === 'string' && k.trim().length > 10;
}

export interface McpeSendResult {
  ok: boolean;
  messageId?: string;
  via: 'direct';
}

/**
 * Send an email directly through MCPEmails (server-side only).
 * Throws McpeError on failure — including tool-level failures.
 */
export async function sendEmailDirect(opts: {
  to: string | string[];
  subject: string;
  body: string;
  htmlBody?: string;
  idempotencyKey?: string;
}): Promise<McpeSendResult> {
  const apiKey = process.env.MCPEMAILS_API_KEY;
  if (!apiKey) throw new McpeError('MCPEMAILS_API_KEY is not configured', 0, 'auth_failed');
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean);
  const args: Record<string, unknown> = {
    action: 'send',
    to: recipients,
    subject: opts.subject,
  };
  if (opts.body) args.body = opts.body;
  if (opts.htmlBody) args.html_body = opts.htmlBody;
  const result = await rpc<ToolCallResult>(
    apiKey,
    'tools/call',
    { name: 'email_compose', arguments: args },
    opts.idempotencyKey
  );
  return { ok: true, messageId: findMessageId(result), via: 'direct' };
}

function findMessageId(result: ToolCallResult): string | undefined {
  const candidates: unknown[] = [
    result.messageId,
    result.id,
    result.structuredContent?.message_id,
    result.structuredContent?.messageId,
    result.structuredContent?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
  }
  return undefined;
}

/**
 * Verify the key with the `initialize` handshake (used by /api/health).
 */
export async function pingDirect(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const apiKey = process.env.MCPEMAILS_API_KEY;
    if (!apiKey) return { ok: false, detail: 'MCPEMAILS_API_KEY not set (OnyxBase email fallback in use)' };
    await rpc(apiKey, 'initialize', {});
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

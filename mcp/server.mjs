#!/usr/bin/env node
/**
 * RGE Hub — self-hosted MCP server (Model Context Protocol).
 * ────────────────────────────────────────────────────────────────────────────
 * ZERO DEPENDENCIES. Plain Node.js ≥ 18 (uses global fetch). Run it on YOUR
 * machine — it talks to any RGE Hub instance through the public API
 * (/api/v1/*) and authenticates with YOUR account API key (the one revealed
 * in the Hub: Settings → Security → "Reveal API key").
 *
 * Quick start
 *   RGE_API_KEY=kv_live_xxx node server.mjs            # stdio (Claude Desktop, Cursor, …)
 *   RGE_API_KEY=kv_live_xxx node server.mjs --http     # Streamable HTTP on 127.0.0.1:3333
 *   node server.mjs --check                            # verify key + instance, then exit
 *
 * Environment
 *   RGE_API_KEY   (required)  your account API key
 *   RGE_BASE_URL  (optional)  Hub instance URL — default https://rge-hub.vercel.app
 *
 * Flags
 *   --http [port] Streamable HTTP transport instead of stdio (port default 3333)
 *   --host H      HTTP bind host (default 127.0.0.1 — use 0.0.0.0 to expose)
 *   --api-key K   API key (alternative to RGE_API_KEY)
 *   --base-url U  Hub URL (alternative to RGE_BASE_URL)
 *   --check       verify the key + instance health, print, exit
 *   --help        this help
 *
 * MCP protocol: JSON-RPC 2.0. stdio transport = newline-delimited JSON on
 * stdin/stdout. HTTP transport = POST /mcp (Streamable HTTP, stateless —
 * no server-initiated messages, so no SSE stream).
 *
 * Tools (packed 1:1 from the public API):
 *   rge_health, rge_me, rge_list_my_resources, rge_get_resource,
 *   rge_create_text_resource, rge_create_link_resource, rge_update_resource,
 *   rge_delete_resource, rge_search_resources, rge_community_feed,
 *   rge_get_user, rge_get_file
 */

import { createServer } from 'node:http';
import process from 'node:process';
import readline from 'node:readline';

const VERSION = '1.0.0';
const SERVER_NAME = 'rge-hub-mcp';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// ─── configuration ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { http: false, port: 3333, host: '127.0.0.1', check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') {
      out.http = true;
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) { out.port = parseInt(next, 10); i++; }
    } else if (a === '--host') {
      out.host = argv[++i] || '127.0.0.1';
    } else if (a === '--api-key') {
      out.apiKey = argv[++i] || '';
    } else if (a === '--base-url') {
      out.baseUrl = argv[++i] || '';
    } else if (a === '--check') {
      out.check = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--port') {
      out.port = parseInt(argv[++i] || '3333', 10);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const API_KEY = (args.apiKey || process.env.RGE_API_KEY || '').trim();
const BASE_URL = (args.baseUrl || process.env.RGE_BASE_URL || 'https://rge-hub.vercel.app')
  .trim()
  .replace(/\/+$/, '');

if (args.help) {
  console.error(`RGE Hub MCP server v${VERSION} — self-hosted, zero dependencies.

Usage:
  RGE_API_KEY=kv_live_xxx node server.mjs              stdio transport (default)
  RGE_API_KEY=kv_live_xxx node server.mjs --http 3333  Streamable HTTP transport
  node server.mjs --check                              verify key + instance, exit

Environment:
  RGE_API_KEY    your account API key (Settings → Security → Reveal API key)
  RGE_BASE_URL   Hub instance URL (default https://rge-hub.vercel.app)

Flags:
  --http [port]  HTTP transport (default port 3333)
  --host H       HTTP bind host (default 127.0.0.1)
  --api-key K    API key (alternative to the env var)
  --base-url U   Hub URL (alternative to the env var)
  --check        health/auth check, then exit
  --help         this message`);
  process.exit(0);
}

const log = (...m) => process.stderr.write(`[rge-mcp] ${m.join(' ')}\n`);

// ─── public API client ──────────────────────────────────────────────────────

async function apiCall(path, { method = 'GET', body, timeoutMs = 20_000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY; // works everywhere; avoids
  // Bearer-format confusion — the Hub accepts both.
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    if (json && json.success === true) return json.data;
    if (json && json.success === false) {
      const err = new Error(json.error?.message || `API error (HTTP ${res.status})`);
      err.code = json.error?.code || 'API_ERROR';
      err.status = res.status;
      err.retryAfterSecs = json.error?.retryAfterSecs;
      throw err;
    }
    const err = new Error(`Unexpected response (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`);
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── tool definitions (inputSchema = JSON Schema) ───────────────────────────

const TOOLS = [
  {
    name: 'rge_health',
    description: 'Check the RGE Hub instance health (API + storage status). No API key required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => apiCall('/api/v1/health'),
  },
  {
    name: 'rge_me',
    description: 'Get the authenticated account: profile, username, and upload/follower counts. Use this first to verify the API key works.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => apiCall('/api/v1/me'),
  },
  {
    name: 'rge_list_my_resources',
    description: 'List the authenticated user\'s own resources (images, clips, files/XMLs — drafts included), newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['image', 'clip', 'xml'], description: 'Filter by resource type. xml = generic files (incl. XML presets).' },
        published: { type: 'boolean', description: 'Filter by published state.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 100).' },
      },
      additionalProperties: false,
    },
    run: (input) => {
      const q = new URLSearchParams();
      if (input.type) q.set('type', input.type);
      if (typeof input.published === 'boolean') q.set('published', String(input.published));
      if (input.limit) q.set('limit', String(input.limit));
      const qs = q.toString();
      return apiCall(`/api/v1/resources${qs ? `?${qs}` : ''}`);
    },
  },
  {
    name: 'rge_get_resource',
    description: 'Get one resource by id (e.g. xml_ab12cd34). Published resources are public; drafts need the owner\'s key.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^(img|clip|xml)_[A-Za-z0-9_-]{4,48}$', description: 'Resource id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: (input) => apiCall(`/api/v1/resources/${encodeURIComponent(input.id)}`),
  },
  {
    name: 'rge_create_text_resource',
    description: 'Create a resource from text content (e.g. an XML preset, JSON, notes). The content is stored as a real file on the Hub. Max 2 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200, description: 'Resource title.' },
        content: { type: 'string', description: 'The file body (text).' },
        fileName: { type: 'string', description: 'File name, e.g. "my-preset.xml" (default "file.txt").' },
        mimeType: { type: 'string', description: 'MIME type (default "text/plain").' },
        description: { type: 'string', maxLength: 2000, description: 'Optional description.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Optional tags.' },
        category: { type: 'string', description: 'Optional category.' },
        published: { type: 'boolean', description: 'Publish immediately (default true).' },
        clientId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$', description: 'Idempotency key — retries with the same value return the same resource instead of duplicating.' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    run: (input) => apiCall('/api/v1/resources', { method: 'POST', body: input }),
  },
  {
    name: 'rge_create_link_resource',
    description: 'Create a resource pointing at an external http(s) URL (e.g. a getshared/qu.ax download link). The type (image/clip/file) is guessed from the URL when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200, description: 'Resource title.' },
        url: { type: 'string', description: 'The http(s) link.' },
        type: { type: 'string', enum: ['image', 'clip', 'xml'], description: 'Resource type (optional — guessed from the URL).' },
        description: { type: 'string', maxLength: 2000, description: 'Optional description.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Optional tags.' },
        category: { type: 'string', description: 'Optional category.' },
        published: { type: 'boolean', description: 'Publish immediately (default true).' },
        clientId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$', description: 'Idempotency key — retries return the same resource.' },
      },
      required: ['title', 'url'],
      additionalProperties: false,
    },
    run: (input) => apiCall('/api/v1/resources', { method: 'POST', body: input }),
  },
  {
    name: 'rge_update_resource',
    description: 'Update one of the authenticated user\'s own resources (title, description, tags, category, published).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^(img|clip|xml)_[A-Za-z0-9_-]{4,48}$', description: 'Resource id.' },
        title: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        category: { type: 'string' },
        published: { type: 'boolean', description: 'Publish (true) or move to drafts (false).' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: (input) => {
      const { id, ...patch } = input;
      return apiCall(`/api/v1/resources/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
    },
  },
  {
    name: 'rge_delete_resource',
    description: 'Delete one of the authenticated user\'s own resources (owner only; idempotent).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^(img|clip|xml)_[A-Za-z0-9_-]{4,48}$', description: 'Resource id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: (input) => apiCall(`/api/v1/resources/${encodeURIComponent(input.id)}`, { method: 'DELETE' }),
  },
  {
    name: 'rge_search_resources',
    description: 'Search public resources by title, description, creator, or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 200, description: 'Search query.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 50).' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    run: (input) => {
      const q = new URLSearchParams({ q: input.q });
      if (input.limit) q.set('limit', String(input.limit));
      return apiCall(`/api/v1/search?${q.toString()}`);
    },
  },
  {
    name: 'rge_community_feed',
    description: 'The public community feed: all published resources, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 50).' },
      },
      additionalProperties: false,
    },
    run: (input) => {
      const q = input.limit ? `?limit=${input.limit}` : '';
      return apiCall(`/api/v1/community/feed${q}`);
    },
  },
  {
    name: 'rge_get_user',
    description: 'Get a creator\'s public profile by username: profile, follower counts, and published resources.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', pattern: '^[a-zA-Z0-9_]{3,32}$', description: 'Username (without @).' },
      },
      required: ['username'],
      additionalProperties: false,
    },
    run: (input) => apiCall(`/api/v1/users/${encodeURIComponent(input.username)}`),
  },
  {
    name: 'rge_get_file',
    description: 'Get a stored file\'s metadata and permanent download URL by file id.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,128}$', description: 'File id.' },
      },
      required: ['fileId'],
      additionalProperties: false,
    },
    run: (input) => apiCall(`/api/v1/files/${encodeURIComponent(input.fileId)}`),
  },
];

const TOOL_LIST = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ─── JSON-RPC / MCP dispatch ────────────────────────────────────────────────

function jsonrpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonrpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return jsonrpcError(null, -32600, 'Invalid Request');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    // ── lifecycle ──
    if (method === 'initialize') {
      const requested = params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : PROTOCOL_VERSIONS[0];
      return jsonrpcResult(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: {},
          prompts: {},
        },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          'Tools for the RGE Hub editing platform: manage your images, clips and file/XML resources, browse the community feed, and read creator profiles. Start with rge_me to verify the API key.',
      });
    }
    if (method === 'ping') return jsonrpcResult(id, {});

    // ── tools ──
    if (method === 'tools/list') {
      return jsonrpcResult(id, { tools: TOOL_LIST });
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const input = params?.arguments ?? {};
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) {
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        });
      }
      if (!API_KEY && name !== 'rge_health') {
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: 'No API key configured. Set RGE_API_KEY (Settings → Security → Reveal API key in the Hub).' }],
          isError: true,
        });
      }
      try {
        const data = await tool.run(input);
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        });
      } catch (e) {
        const hint = e.status === 401
          ? ' (invalid or revoked API key)'
          : e.status === 429
            ? ` (rate limited — retry after ${e.retryAfterSecs ?? 60}s)`
            : e.code === 'TIMEOUT'
              ? ' (instance slow or unreachable — check RGE_BASE_URL)'
              : '';
        return jsonrpcResult(id, {
          content: [{ type: 'text', text: `${e.message}${hint}` }],
          isError: true,
        });
      }
    }

    // ── resources / prompts (empty but advertised) ──
    if (method === 'resources/list') return jsonrpcResult(id, { resources: [] });
    if (method === 'resources/templates/list') return jsonrpcResult(id, { resourceTemplates: [] });
    if (method === 'prompts/list') return jsonrpcResult(id, { prompts: [] });

    // ── notifications (no response) ──
    if (isNotification) return undefined;

    return jsonrpcError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (isNotification) return undefined;
    return jsonrpcError(id, -32603, `Internal error: ${e.message}`);
  }
}

// ─── stdio transport ────────────────────────────────────────────────────────

async function runStdio() {
  log(`RGE Hub MCP server v${VERSION} (stdio) → ${BASE_URL}`);
  if (!API_KEY) log('WARNING: RGE_API_KEY is not set — only rge_health will work.');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  // stdin may close while tool calls are still in flight — drain them before
  // exiting (Claude Desktop/Cursor restart the process on early exit).
  let pending = 0;
  let closed = false;
  const maybeExit = () => {
    if (closed && pending === 0) process.exit(0);
  };

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      process.stdout.write(`${JSON.stringify(jsonrpcError(null, -32700, 'Parse error'))}\n`);
      return;
    }
    pending++;
    // Batch support (JSON-RPC 2.0 arrays).
    const handle = Array.isArray(msg)
      ? async () => {
          const results = [];
          for (const m of msg) {
            const r = await handleMessage(m);
            if (r) results.push(r);
          }
          if (results.length > 0) process.stdout.write(`${JSON.stringify(results)}\n`);
        }
      : async () => {
          const r = await handleMessage(msg);
          if (r) process.stdout.write(`${JSON.stringify(r)}\n`);
        };
    handle()
      .catch((e) => log(`handler error: ${e.message}`))
      .finally(() => {
        pending--;
        maybeExit();
      });
  });
  rl.on('close', () => {
    closed = true;
    maybeExit();
  });
}

// ─── Streamable HTTP transport (stateless) ─────────────────────────────────

function runHttp() {
  const server = createServer((req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...headers,
      });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

    // CORS (self-hosted convenience — the API key is the credential).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/mcp' && url.pathname !== '/') {
      send(404, { error: 'Not found — POST /mcp' });
      return;
    }
    if (req.method !== 'POST') {
      // Streamable HTTP: no server-initiated messages → GET/DELETE are 405.
      send(405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed — POST JSON-RPC messages to /mcp' } }, { Allow: 'POST' });
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return send(400, { jsonrpc: '2.0', error: { code: -32700, message: 'Empty body' } });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
      }
      const isBatch = Array.isArray(body);
      const messages = isBatch ? body : [body];
      const results = [];
      for (const m of messages) {
        const r = await handleMessage(m);
        if (r) results.push(r);
      }
      if (results.length === 0) return send(202, undefined); // all notifications
      send(200, isBatch ? results : results[0]);
    });
    req.on('error', () => send(400, { error: 'Bad request' }));
  });

  server.listen(args.port, args.host, () => {
    log(`RGE Hub MCP server v${VERSION} (Streamable HTTP) → ${BASE_URL}`);
    log(`listening on http://${args.host}:${args.port}/mcp`);
    if (!API_KEY) log('WARNING: RGE_API_KEY is not set — only rge_health will work.');
  });
}

// ─── --check mode ───────────────────────────────────────────────────────────

async function runCheck() {
  process.stdout.write(`RGE Hub MCP server v${VERSION}\ninstance: ${BASE_URL}\n`);
  try {
    const health = await apiCall('/api/v1/health', { timeoutMs: 10_000 });
    process.stdout.write(`health:   ok (storage ${health?.components?.storage?.ok ? 'ok' : 'degraded'})\n`);
  } catch (e) {
    process.stdout.write(`health:   FAILED — ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (!API_KEY) {
    process.stdout.write('api key:  NOT SET (set RGE_API_KEY to use the authenticated tools)\n');
    return;
  }
  try {
    const me = await apiCall('/api/v1/me', { timeoutMs: 15_000 });
    process.stdout.write(`api key:  valid — ${me.username} (${me.counts.uploads} uploads)\n`);
  } catch (e) {
    process.stdout.write(`api key:  INVALID — ${e.message}\n`);
    process.exitCode = 1;
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

if (args.check) {
  runCheck().catch((e) => { console.error(e.message); process.exit(1); });
} else if (args.http) {
  runHttp();
} else {
  runStdio();
}

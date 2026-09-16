/**
 * RGE Agent — CLIENT tool catalog + executor.
 *
 * The agent loop runs in the browser, so most tools execute there:
 *   planning    set_plan, write_todos                       (live UI state)
 *   ui          emit_ui                                     (structured blocks)
 *   hub         hub_list_resources, hub_fetch_resource      (session APIs → container)
 *   workspace   workspace_list/read/write/edit/delete/mkdir/extract_zip/
 *               create_zip/search/file_info                 (web container FS)
 *   execution   execute_code, run_terminal                  (Pyodide, live stdout)
 *   server      update_resource, speedramp_clip             (POST /api/agent/tool)
 *
 * executeClientTool NEVER throws — failures return {ok:false, result} so the
 * agent loop can feed the honest error to the model and keep going.
 */

import type { ToolSchema } from '@/lib/agent/protocol';
import type { ToolResultMeta, TreeNode } from '@/lib/agent/types';
import type { EmitUiArgs, UiBlockState } from '@/lib/agent/ui-protocol';
import { getContainer } from '@/lib/agent/container-client';
import { UI_BLOCK_TYPES } from '@/components/agent/ui-blocks';
import { EXEC_LANGUAGE_NAMES, EXEC_RUNTIMES, normalizeExecLanguage } from '@/lib/agent/runtimes';

// ────────────────────────────────────────────────────────────────────────────
// Context + result
// ────────────────────────────────────────────────────────────────────────────

export interface ClientToolContext {
  /** Chat id — the web-container workspace id. */
  chatId: string;
  /** Live run token — flips false the moment the user stops. */
  runToken: { current: boolean };
  /** Apply an emit_ui operation to the live timeline (renders a block). */
  emitUi(args: EmitUiArgs): void;
  setPlan(steps: string[]): void;
  setTodos(items: { text: string; status: 'pending' | 'active' | 'done' }[]): void;
}

export interface ClientToolResult {
  ok: boolean;
  result: string;
  meta?: ToolResultMeta;
}

function fail(msg: string): ClientToolResult {
  return { ok: false, result: msg };
}
function ok(result: string, meta?: ToolResultMeta): ClientToolResult {
  return { ok: true, result, ...(meta ? { meta } : {}) };
}

function fmtKB(bytes: number): string {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

function safeFileName(name: string): string {
  const cleaned = String(name || '')
    .replace(/[\\/\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

// ────────────────────────────────────────────────────────────────────────────
// Tool schemas (sent to the provider verbatim)
// ────────────────────────────────────────────────────────────────────────────

const UI_TYPE_ENUM = UI_BLOCK_TYPES;

export const CLIENT_TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'set_plan',
      description: 'Set the ordered plan for this task. Call FIRST on multi-step work; the user sees a live plan UI.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' }, description: 'Ordered steps (short imperative phrases)' },
        },
        required: ['steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_todos',
      description: 'Update the live todo checklist (add/complete items as you discover work).',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'active', 'done'] } },
              required: ['text'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emit_ui',
      description:
        'Render a polished structured UI block in the chat (tables, file trees, diffs, validation results, charts…). Blocks update IN PLACE by id — reuse the same id with operation "append" to grow them live, "complete" when done. Emit DURING the run as data arrives. Data shapes per uiType are documented in the system prompt.',
      parameters: {
        type: 'object',
        properties: {
          uiType: { type: 'string', enum: UI_TYPE_ENUM },
          id: { type: 'string', description: 'Stable block id — same id = same rendered block' },
          operation: { type: 'string', enum: ['create', 'replace', 'append', 'update', 'complete'] },
          title: { type: 'string', description: 'Optional block title' },
          data: { type: 'object', description: 'Renderer payload (shape depends on uiType)' },
        },
        required: ['uiType', 'id', 'operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hub_list_resources',
      description: 'List RGE Hub resources the user can access (their own + published; admins see all). Use the exact resource id for hub_fetch_resource.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['image', 'clip', 'xml'], description: 'Optional type filter' },
          limit: { type: 'number', description: 'Max resources to return (default 40, max 100)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hub_fetch_resource',
      description: 'Download a hub resource INTO the workspace (lands in hub/). Then inspect/edit it with the workspace tools.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'Resource id from hub_list_resources' },
          path: { type: 'string', description: 'Optional destination inside hub/ (default: the resource filename)' },
        },
        required: ['resourceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_list',
      description: 'Recursively list the workspace (or a subpath). Returns a file tree.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Subpath (default: workspace root)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_read',
      description: 'Read a text file from the workspace (UTF-8; truncates above maxBytes). For ZIPs use workspace_extract_zip or the zip tools instead.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxBytes: { type: 'number', description: 'Read cap in bytes (default 65536, max 262144)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_write',
      description: 'Write a text file (creates parent directories; shows a diff). For binary data use code execution instead.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_edit',
      description: 'Edit a text file: exact find→replace (first match, or all), or full content rewrite. Returns a unified diff.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find: { type: 'string', description: 'Exact text to find (mode A)' },
          replace: { type: 'string', description: 'Replacement text (mode A)' },
          all: { type: 'boolean', description: 'Replace every occurrence (default: first only)' },
          content: { type: 'string', description: 'Full new content (mode B — rewrites the file)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_delete',
      description: 'Delete a file or directory (recursive) from the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_mkdir',
      description: 'Create a directory (parents included).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_extract_zip',
      description: 'Extract a ZIP archive into extracted/<name>/ (or a custom dest). Overwrites existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Archive path (e.g. hub/pack.zip)' },
          dest: { type: 'string', description: 'Destination dir (default: extracted/<archive name>)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_create_zip',
      description: 'Pack files/directories into a ZIP (usually into output/).',
      parameters: {
        type: 'object',
        properties: {
          sources: { type: 'array', items: { type: 'string' }, description: 'Files or directories to include' },
          dest: { type: 'string', description: 'Archive path (e.g. output/modified-resource.zip)' },
        },
        required: ['sources', 'dest'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_search',
      description: 'Search file contents under a path (substring or regex) — returns matches with line numbers. Ideal for finding values inside XMLs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string', description: 'Search root (default: workspace root)' },
          regex: { type: 'boolean', description: 'Treat query as a Python regex (default: plain text)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_file_info',
      description: 'Inspect one file: size, mtime, text/binary, short preview.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description:
        'Execute code in one of 25 languages. python runs in the browser web container (persistent workspace, live stdout — best for XML/ZIP work). node/javascript and bash run on the server sandbox: pass workspace paths in files[] and changed files sync back automatically (require() has node stdlib + adm-zip, archiver, date-fns). 20 more languages (c, cpp, csharp, go, java, kotlin, swift, ruby, rust, zig, dart, lua, julia, perl, haskell, crystal, d, fortran, pascal, ocaml, fsharp) run on a remote executor — ephemeral snippets only, no workspace files, compiles can take seconds. stdout/stderr stream live to the user — print progress.',
      parameters: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            enum: EXEC_LANGUAGE_NAMES,
            description: 'Execution language (default python)',
          },
          code: { type: 'string', description: 'Source code to run' },
          file: { type: 'string', description: 'Alternative: run this file from the workspace' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'node/bash only: extra workspace files to stage next to the script (it reads/writes them; changes sync back)',
          },
          stdin: { type: 'string', description: 'Optional stdin for the program' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description:
        'Run a mini-shell command in the container: python <file.py>, ls, cat, head, tail, rm, cp, mv, mkdir, unzip <zip> [-d dir], zip -r <out.zip> <src…>, grep [-i] <pattern>, find, wc, echo, tree, stat, pwd. Commands chain with &&. Output streams live.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_resource',
      description: 'Update a HUB resource\'s metadata (title, description, tags, published, links) — the hub record, not the file bytes.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          published: { type: 'boolean' },
        },
        required: ['resourceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speedramp_clip',
      description: 'Speed-ramp a hub video clip (server-side ffmpeg). Defaults: vramp mode, 4x→0.6x→4x, 30fps.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string' },
          config: { type: 'object', description: 'Speedramp configuration (all fields optional)' },
        },
        required: ['resourceId'],
      },
    },
  },
];

export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.function.name));

// ────────────────────────────────────────────────────────────────────────────
// Hub helpers (session-cookie authenticated, same-origin)
// ────────────────────────────────────────────────────────────────────────────

interface HubResource {
  id: string;
  type: 'image' | 'clip' | 'xml';
  title: string;
  ownerId: string;
  ownerName?: string;
  published?: boolean;
  fileId?: string;
  fileName?: string;
  downloadUrl?: string;
  storageUrl?: string;
  mirrorUrl?: string;
  size?: number;
  description?: string;
  tags?: string[];
}

let cachedUserId: string | null = null;
let cachedUserIdLoaded = false;

async function hubUserId(): Promise<string | null> {
  if (cachedUserIdLoaded) return cachedUserId;
  try {
    const res = await fetch('/api/auth/me');
    const body = await res.json().catch(() => null);
    cachedUserId = body?.success && typeof body?.data?.userId === 'string' ? body.data.userId : null;
  } catch {
    cachedUserId = null;
  }
  cachedUserIdLoaded = true;
  return cachedUserId;
}

async function fetchHubResources(type?: string): Promise<HubResource[]> {
  // Own resources (incl. unpublished) + everyone's published; admins see all
  // from the plain listing.
  const mineUrl =
    '/api/resources/list?published=false' +
    (type ? `&type=${encodeURIComponent(type)}` : '');
  const pubUrl = '/api/resources/list' + (type ? `?type=${encodeURIComponent(type)}` : '');
  const [mineRes, pubRes] = await Promise.all([
    fetch(mineUrl).catch(() => null),
    fetch(pubUrl).catch(() => null),
  ]);
  const mine = mineRes && mineRes.ok ? await mineRes.json().catch(() => null) : null;
  const pub = pubRes && pubRes.ok ? await pubRes.json().catch(() => null) : null;
  const mineList: HubResource[] = Array.isArray(mine?.resources) ? mine.resources : [];
  const pubList: HubResource[] = Array.isArray(pub?.resources) ? pub.resources : [];
  const byId = new Map<string, HubResource>();
  for (const r of pubList) if (r?.id) byId.set(r.id, r);
  for (const r of mineList) if (r?.id) byId.set(r.id, r); // own wins (freshest)
  return [...byId.values()];
}

async function resolveResourceBytesUrl(r: HubResource): Promise<string | null> {
  if (r.fileId && !r.fileId.startsWith('ext:')) return `/api/f/${r.fileId}`;
  for (const u of [r.downloadUrl, r.storageUrl, r.mirrorUrl]) {
    if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Tree meta (container nodes → element-library TreeNode[])
// ────────────────────────────────────────────────────────────────────────────

function nodesToTreeMeta(nodes: { path: string; name: string; dir: boolean }[]): TreeNode[] {
  return nodes.slice(0, 300).map((n) => ({
    path: n.path,
    name: n.name,
    depth: n.path.split('/').length - 1,
    kind: n.dir ? ('folder' as const) : ('file' as const),
  }));
}

function treeText(nodes: { path: string; dir: boolean; size?: number }[], max = 60): string {
  const lines = nodes
    .slice(0, max)
    .map((n) => `${n.dir ? '[dir] ' : ''}${n.path}${!n.dir && n.size ? ` (${fmtKB(n.size)})` : ''}`);
  const extra = nodes.length > max ? `\n… +${nodes.length - max} more (workspace_list for all)` : '';
  return lines.join('\n') + extra;
}

// ────────────────────────────────────────────────────────────────────────────
// Exec helpers — stream a live terminal UI block + capture output
// ────────────────────────────────────────────────────────────────────────────

interface ExecOutcome {
  ok: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
}

async function runWithTerminalBlock(
  ctx: ClientToolContext,
  callId: string,
  header: string,
  command: string | undefined,
  run: (hooks: { onStdout: (t: string) => void; onStderr: (t: string) => void }) => Promise<ExecOutcome>
): Promise<ClientToolResult> {
  const blockId = `exec-${callId}`;
  ctx.emitUi({
    uiType: 'terminal',
    id: blockId,
    operation: 'create',
    title: header,
    data: { ...(command ? { command } : {}), lines: [] },
  });
  const lines: string[] = [];
  const MAX_LINES = 200;
  const MAX_LINE = 2000;
  let pending = '';
  const flush = () => {
    if (pending.trim()) {
      lines.push(pending.length > MAX_LINE ? `${pending.slice(0, MAX_LINE)}…` : pending);
    }
    pending = '';
  };
  const emit = () => {
    if (lines.length > 0) {
      ctx.emitUi({
        uiType: 'terminal',
        id: blockId,
        operation: 'replace',
        data: { ...(command ? { command } : {}), lines: lines.slice(-MAX_LINES) },
      });
    }
  };
  /** Line-oriented push — chunks may split lines arbitrarily (SSE). */
  const push = (text: string) => {
    pending += String(text);
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    for (const ln of parts) {
      if (ln === '') continue;
      lines.push(ln.length > MAX_LINE ? `${ln.slice(0, MAX_LINE)}…` : ln);
    }
    emit();
  };
  try {
    const outcome = await run({
      onStdout: push,
      onStderr: push,
    });
    flush();
    emit();
    ctx.emitUi({
      uiType: 'terminal',
      id: blockId,
      operation: 'complete',
      data: {
        ...(command ? { command } : {}),
        lines: lines.slice(-MAX_LINES),
        ...(outcome.ok ? {} : { failed: true }),
      },
    });
    const tail = lines.slice(-25).join('\n');
    const summary = outcome.ok
      ? `Exit code 0 in ${(outcome.durationMs / 1000).toFixed(1)}s.${tail ? `\n${tail}` : ''}`
      : `Exit code ${outcome.exitCode} after ${(outcome.durationMs / 1000).toFixed(1)}s.\n${tail || '(no output)'}`;
    return { ok: outcome.ok, result: summary };
  } catch (err) {
    flush();
    ctx.emitUi({ uiType: 'terminal', id: blockId, operation: 'complete', data: { lines: lines.slice(-MAX_LINES), failed: true } });
    return fail(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Server-delegated tools
// ────────────────────────────────────────────────────────────────────────────

const SERVER_TOOLS = new Set(['update_resource', 'speedramp_clip']);

async function runServerTool(name: string, args: Record<string, unknown>): Promise<ClientToolResult> {
  try {
    const res = await fetch('/api/agent/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      return fail(body?.error?.message || `Server tool failed (HTTP ${res.status}).`);
    }
    const data = body.data as { ok: boolean; result: string; meta?: ToolResultMeta };
    return { ok: !!data.ok, result: String(data.result || ''), ...(data.meta ? { meta: data.meta } : {}) };
  } catch (err) {
    return fail(`Server tool unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The executor
// ────────────────────────────────────────────────────────────────────────────

export async function executeClientTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ClientToolContext
): Promise<ClientToolResult> {
  try {
    switch (name) {
      // ── planning / ui ───────────────────────────────────────────────────
      case 'set_plan': {
        const steps = Array.isArray(args.steps)
          ? args.steps
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .slice(0, 20)
              .map((s) => s.trim())
          : [];
        if (steps.length === 0) return fail('Provide a non-empty steps array.');
        ctx.setPlan(steps);
        return ok(`Plan set with ${steps.length} steps.`);
      }
      case 'write_todos': {
        const raw = Array.isArray(args.items) ? args.items : [];
        const items = raw
          .filter((it): it is { text: string; status?: string } => !!it && typeof (it as { text?: unknown }).text === 'string')
          .slice(0, 30)
          .map((it) => ({
            text: String(it.text).slice(0, 200),
            status: it.status === 'done' ? ('done' as const) : it.status === 'active' ? ('active' as const) : ('pending' as const),
          }));
        if (items.length === 0) return fail('Provide a non-empty items array.');
        ctx.setTodos(items);
        return ok(`Todos updated (${items.length} items).`);
      }
      case 'emit_ui': {
        const uiType = String(args.uiType || '');
        const id = String(args.id || '').slice(0, 80);
        const operation = String(args.operation || 'create') as EmitUiArgs['operation'];
        if (!uiType || !UI_TYPE_ENUM.includes(uiType)) {
          return fail(`Unknown uiType "${uiType.slice(0, 60)}". Use one of the catalog types from the system prompt.`);
        }
        if (!id) return fail('Provide a stable block id.');
        ctx.emitUi({
          uiType,
          id,
          operation,
          ...(typeof args.title === 'string' && args.title.trim() ? { title: args.title.slice(0, 120) } : {}),
          ...(args.data && typeof args.data === 'object' && !Array.isArray(args.data)
            ? { data: args.data as Record<string, unknown> }
            : {}),
        });
        return ok(`UI block '${id}' (${uiType}) ${operation === 'create' ? 'created' : operation + 'ed'}.`);
      }

      // ── hub ─────────────────────────────────────────────────────────────
      case 'hub_list_resources': {
        const type = args.type === 'image' || args.type === 'clip' || args.type === 'xml' ? args.type : undefined;
        const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 100);
        const resources = await fetchHubResources(type);
        if (resources.length === 0) {
          return ok(type ? `No ${type} resources accessible.` : 'No resources accessible.');
        }
        const shown = resources.slice(0, limit);
        const lines = shown.map((r) => {
          const bits = [r.id, r.type.toUpperCase(), JSON.stringify(r.title || 'untitled')];
          if (r.ownerName) bits.push(`by ${r.ownerName}`);
          if (r.published === false) bits.push('(unpublished)');
          if (typeof r.size === 'number' && r.size > 0) bits.push(fmtKB(r.size));
          return `- ${bits.join(' · ')}`;
        });
        const extra = resources.length > limit ? `\n… +${resources.length - limit} more (raise limit to see them)` : '';
        return ok(`${resources.length} accessible resource(s)${type ? ` of type ${type}` : ''}:\n${lines.join('\n')}${extra}`);
      }
      case 'hub_fetch_resource': {
        const resourceId = String(args.resourceId || '').trim();
        if (!resourceId) return fail('Provide resourceId (from hub_list_resources).');
        const resources = await fetchHubResources();
        const r = resources.find((x) => x.id === resourceId);
        if (!r) return fail(`Resource ${resourceId} not found or not accessible — list resources first.`);
        const url = await resolveResourceBytesUrl(r);
        if (!url) return fail(`Resource "${r.title}" has no downloadable file.`);
        let res: Response;
        try {
          res = await fetch(url, { redirect: 'follow' });
        } catch (err) {
          return fail(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!res.ok) return fail(`Download failed (HTTP ${res.status}).`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) return fail('Downloaded file is empty (0 bytes).');
        if (buf.byteLength > 80 * 1024 * 1024) return fail(`File is ${fmtKB(buf.byteLength)} — over the 80 MB workspace limit.`);
        const rel = args.path
          ? safeFileName(String(args.path))
          : safeFileName(r.fileName || `${r.title || resourceId}.${r.type === 'clip' ? 'mp4' : r.type === 'image' ? 'png' : 'xml'}`);
        const dest = rel.startsWith('hub/') ? rel : `hub/${rel.replace(/^\/+/, '')}`;
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        await container.writeBytes(ctx.chatId, dest, buf);
        return ok(
          `Fetched "${r.title}" (${r.type}) into workspace: ${dest} (${fmtKB(buf.byteLength)}).`,
          {
            artifact: { title: dest, meta: `${fmtKB(buf.byteLength)} · from hub resource ${r.id}`, generating: false },
            files: [dest],
          }
        );
      }

      // ── workspace ───────────────────────────────────────────────────────
      case 'workspace_list': {
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim().replace(/^\/+/, '') : undefined;
        const { nodes, truncated } = await container.list(ctx.chatId, path);
        if (nodes.length === 0) return ok('(no files)', { tree: [] });
        return ok(`${nodes.filter((n) => !n.dir).length} file(s):\n${treeText(nodes)}${truncated ? '\n(listing truncated)' : ''}`, {
          tree: nodesToTreeMeta(nodes),
        });
      }
      case 'workspace_read': {
        const path = String(args.path || '').trim();
        if (!path) return fail('Provide path.');
        const maxBytes = Math.min(Math.max(Number(args.maxBytes) || 65536, 512), 262144);
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const r = await container.read(ctx.chatId, path, maxBytes);
        if (r.binary || r.content === null) {
          return ok(`(binary file, ${fmtKB(r.size)} — use workspace_extract_zip for archives or execute_code to process it)`);
        }
        return ok(
          `${path} (${fmtKB(r.size)}):${r.truncated ? ' [truncated]' : ''}\n\n${r.content}`,
          { status: `${fmtKB(r.size)}${r.truncated ? ' truncated' : ''}` }
        );
      }
      case 'workspace_write': {
        const path = String(args.path || '').trim();
        const content = typeof args.content === 'string' ? args.content : '';
        if (!path) return fail('Provide path.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const r = await container.edit(ctx.chatId, path, { content });
        return ok(
          `Wrote ${path} (${fmtKB(content.length)}${r.diffTruncated ? ', diff truncated' : ''}).`,
          {
            diff: {
              filename: path,
              additions: r.diff.additions,
              deletions: r.diff.deletions,
              lines: r.diff.lines.slice(0, 400),
            },
          }
        );
      }
      case 'workspace_edit': {
        const path = String(args.path || '').trim();
        if (!path) return fail('Provide path.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        if (typeof args.content === 'string') {
          const r = await container.edit(ctx.chatId, path, { content: args.content });
          return ok(`Rewrote ${path}.`, {
            diff: { filename: path, additions: r.diff.additions, deletions: r.diff.deletions, lines: r.diff.lines.slice(0, 400) },
          });
        }
        const find = typeof args.find === 'string' ? args.find : '';
        if (!find) return fail('Provide either find+replace or content.');
        const replace = typeof args.replace === 'string' ? args.replace : '';
        const r = await container.edit(ctx.chatId, path, { find, replace, all: args.all === true });
        return ok(
          `Replaced ${r.changed} occurrence(s) in ${path}.`,
          {
            diff: { filename: path, additions: r.diff.additions, deletions: r.diff.deletions, lines: r.diff.lines.slice(0, 400) },
          }
        );
      }
      case 'workspace_delete': {
        const path = String(args.path || '').trim();
        if (!path) return fail('Provide path.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        await container.delete(ctx.chatId, path);
        return ok(`Deleted ${path}.`);
      }
      case 'workspace_mkdir': {
        const path = String(args.path || '').trim();
        if (!path) return fail('Provide path.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        await container.mkdir(ctx.chatId, path);
        return ok(`Created directory ${path}.`);
      }
      case 'workspace_extract_zip': {
        const path = String(args.path || '').trim();
        if (!path) return fail('Provide the archive path.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const dest = typeof args.dest === 'string' && args.dest.trim() ? args.dest.trim().replace(/^\/+/, '') : undefined;
        const r = await container.extractZip(ctx.chatId, path, dest);
        const xmlCount = r.files.filter((f) => /\.xml$/i.test(f.name)).length;
        const nodes = await container.list(ctx.chatId, r.dest).catch(() => ({ nodes: [], truncated: false }));
        return ok(
          `Extracted ${r.count} file(s) from ${path} into ${r.dest}/ (${xmlCount} XML).`,
          { tree: nodesToTreeMeta((nodes as { nodes: { path: string; name: string; dir: boolean }[] }).nodes ?? []), files: r.files.slice(0, 60).map((f) => f.name) }
        );
      }
      case 'workspace_create_zip': {
        const sources = Array.isArray(args.sources)
          ? args.sources
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .map((s) => s.trim().replace(/^\/+/, ''))
          : [];
        const dest = String(args.dest || '').trim().replace(/^\/+/, '');
        if (sources.length === 0 || !dest) return fail('Provide sources[] and dest.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const r = await container.createZip(ctx.chatId, sources, dest);
        return ok(`Created ${dest} with ${r.count} file(s) (${fmtKB(r.size)}).`, {
          artifact: { title: dest, meta: `${r.count} files · ${fmtKB(r.size)}`, generating: false },
          files: [dest],
        });
      }
      case 'workspace_search': {
        const query = String(args.query || '');
        if (!query) return fail('Provide query.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const r = await container.search(ctx.chatId, query, {
          ...(typeof args.path === 'string' && args.path.trim() ? { path: args.path.trim().replace(/^\/+/, '') } : {}),
          regex: args.regex === true,
        });
        if (r.matches.length === 0) return ok(`No matches for ${JSON.stringify(query)}.`);
        const shown = r.matches.slice(0, 40);
        const text = shown.map((m) => `${m.path}:${m.line}: ${m.text.trim().slice(0, 160)}`).join('\n');
        return ok(
          `${r.matches.length} match(es)${r.truncated ? ' (truncated)' : ''}:\n${text}`,
          { files: [...new Set(r.matches.map((m) => m.path))].slice(0, 40) }
        );
      }
      case 'workspace_file_info': {
        const path = String(args.path || '').trim();
        if (!path) return fail('Provide path.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const info = await container.fileInfo(ctx.chatId, path);
        const bits = [
          `${info.dir ? 'directory' : 'file'}`,
          fmtKB(info.size),
          new Date(info.mtime).toISOString().replace('T', ' ').slice(0, 19),
          info.isText ? 'text' : 'binary',
        ];
        const preview = info.isText && info.preview ? `\n\n${info.preview.slice(0, 800)}` : '';
        return ok(`${path} — ${bits.join(' · ')}${preview}`, { status: bits.join(' · ') });
      }

      // ── execution ───────────────────────────────────────────────────────
      case 'execute_code': {
        const language = normalizeExecLanguage(String(args.language || 'python')) || 'python';
        const def = EXEC_RUNTIMES[language];
        let code = typeof args.code === 'string' && args.code.trim() ? args.code : undefined;
        const file = typeof args.file === 'string' && args.file.trim() ? args.file.trim() : undefined;
        if (!code && !file) return fail('Provide code or file.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const callId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

        // Tier 1 — local web container (Python, persistent workspace).
        if (def.tier === 'local') {
          return runWithTerminalBlock(ctx, callId, code ? `Running ${def.label}` : `Running ${file}`, undefined, async (hooks) => {
            const r = await container.execCode(ctx.chatId, {
              ...(code ? { code } : { file: file as string }),
              onStdout: hooks.onStdout,
              onStderr: hooks.onStderr,
            });
            return { ok: r.ok, output: r.output, exitCode: r.exitCode, durationMs: r.durationMs };
          });
        }

        // Tier 2/3 — server sandbox (node/bash, workspace file sync) or the
        // remote executor (20+ languages, ephemeral snippets).
        if (!code && file) {
          const r = await container.read(ctx.chatId, file, 256 * 1024);
          if (r.binary || r.content === null) return fail(`Cannot execute binary file ${file}.`);
          code = r.content;
        }

        const stagePaths = Array.isArray(args.files)
          ? args.files
              .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
              .map((p) => p.trim().replace(/^\/+/, ''))
              .slice(0, 40)
          : [];
        const staged: { path: string; content: string }[] = [];
        if (def.tier === 'server') {
          for (const p of stagePaths) {
            const r = await container.read(ctx.chatId, p, 128 * 1024).catch(() => null);
            if (r && !r.binary && typeof r.content === 'string') staged.push({ path: p, content: r.content });
          }
        }
        const stdin = typeof args.stdin === 'string' ? args.stdin.slice(0, 64 * 1024) : undefined;

        return runWithTerminalBlock(
          ctx,
          callId,
          `Running ${def.label}${def.tier === 'remote' ? ' (remote)' : ''}`,
          language,
          async (hooks) => {
            const res = await fetch('/api/agent/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                language,
                code,
                ...(staged.length > 0 ? { files: staged } : {}),
                ...(stdin ? { stdin } : {}),
              }),
            });
            if (!res.ok || !res.body) {
              const body = await res.json().catch(() => null);
              return {
                ok: false,
                output: String(body?.error?.message || `Execution request failed (HTTP ${res.status}).`),
                exitCode: 1,
                durationMs: 0,
              };
            }

            // Stream the SSE response: start/stdout/stderr/files/exit/error.
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let ok = false;
            let exitCode = 1;
            let durationMs = 0;
            let errMsg: string | null = null;
            const returnedFiles: { path?: unknown; content?: unknown }[] = [];
            const onEvent = (ev: Record<string, unknown>) => {
              if (ev.type === 'start' && typeof ev.runtime === 'string') {
                hooks.onStdout(`[${ev.runtime}]\n`);
              } else if (ev.type === 'stdout' && typeof ev.text === 'string') {
                hooks.onStdout(ev.text);
              } else if (ev.type === 'stderr' && typeof ev.text === 'string') {
                hooks.onStderr(ev.text);
              } else if (ev.type === 'files' && Array.isArray(ev.files)) {
                returnedFiles.push(...(ev.files as { path?: unknown; content?: unknown }[]));
              } else if (ev.type === 'exit') {
                ok = ev.ok === true;
                exitCode = Number(ev.code ?? 1);
                durationMs = Number(ev.durationMs ?? 0);
                if (typeof ev.message === 'string' && ev.message) errMsg = ev.message;
              } else if (ev.type === 'error' && typeof ev.message === 'string') {
                errMsg = ev.message;
              }
            };
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf('\n\n')) !== -1) {
                const chunk = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const line = chunk.split('\n').find((l) => l.startsWith('data:'));
                if (!line) continue;
                const payload = line.slice(5).trim();
                if (!payload) continue;
                try {
                  onEvent(JSON.parse(payload) as Record<string, unknown>);
                } catch {
                  /* ignore malformed frame */
                }
              }
            }

            // Sync changed/new files back into the persistent workspace.
            let synced = 0;
            for (const f of returnedFiles.slice(0, 40)) {
              if (typeof f?.path !== 'string' || typeof f.content !== 'string') continue;
              try {
                await container.write(ctx.chatId, f.path, f.content);
                synced++;
              } catch {
                /* skip */
              }
            }
            if (synced > 0) hooks.onStdout(`\n[synced ${synced} file(s) back to the workspace]\n`);

            return { ok, output: errMsg ?? '', exitCode, durationMs };
          }
        );
      }
      case 'run_terminal': {
        const command = String(args.command || '').trim();
        if (!command) return fail('Provide command.');
        const container = getContainer();
        await container.ensureWorkspace(ctx.chatId);
        const callId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        return runWithTerminalBlock(ctx, callId, 'Terminal', command, async (hooks) => {
          const r = await container.execCommand(ctx.chatId, command, {
            onStdout: hooks.onStdout,
            onStderr: hooks.onStderr,
          });
          return { ok: r.ok, output: r.output, exitCode: r.exitCode, durationMs: r.durationMs };
        });
      }

      // ── server-delegated ────────────────────────────────────────────────
      case 'update_resource':
      case 'speedramp_clip':
        return runServerTool(name, args);

      default:
        return fail(`Unknown tool "${name.slice(0, 60)}".`);
    }
  } catch (err) {
    return fail(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

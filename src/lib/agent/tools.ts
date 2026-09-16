/**
 * RGE Agent — tool catalog + executor.
 *
 * TOOLS: OpenAI function schemas (also fed to the zai JSON-action
 * protocol as documentation). executeTool() NEVER throws — every failure
 * comes back as {ok:false, result:'…'} so the agent loop can feed the
 * honest error to the model and keep going.
 *
 * Tool surface:
 *   planning    set_plan, write_todos
 *   hub         list_hub_resources, fetch_resource, update_resource, publish_file, speedramp_clip
 *   workspace   read_file, write_file, edit_file, list_files, delete_file, unzip_file, zip_files
 */

import type { NextRequest } from 'next/server';
import type { SessionData } from '../session';
import { getFileUrl } from '../onyxbase';
import {
  listResourcesFast,
  getResourceAny,
  updateResource,
  generateResourceId,
  createResourceVerified,
  invalidateListings,
  resourceExtension,
  type Resource,
  type ResourceType,
} from '../resources';
import { resolveRole } from '../admin';
import { storeResourceFile } from '../file-pipeline';
import {
  loadIndex,
  saveFile,
  readFile,
  deleteFile as wsDeleteFile,
  buildTree,
  unzipFile,
  zipFiles,
  diffLines,
  normalizePath,
  safeFileName,
  extOf,
  guessMime,
  MAX_TOTAL_BYTES,
} from './workspace';
import type { ToolResultMeta } from './types';
import type { ToolSchema } from './llm';

export interface ToolContext {
  userId: string;
  session: SessionData;
  req: NextRequest;
}

export interface ToolExecResult {
  ok: boolean;
  result: string;
  meta?: ToolResultMeta;
}

// ────────────────────────────────────────────────────────────────────────────
// Schemas (the LLM reads these — keep them crisp)
// ────────────────────────────────────────────────────────────────────────────

export const TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'set_plan',
      description:
        'Record the plan for a multi-step task as an ordered list of steps. Call this BEFORE starting multi-step work; the user sees the plan as a checklist.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordered steps, each a short imperative phrase.',
          },
        },
        required: ['steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_todos',
      description:
        'Update the live TODO checklist (use for discovered work during a task). Send the FULL list every time — it replaces the previous one.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
              },
              required: ['text', 'status'],
            },
            description: 'All todo items with their current status.',
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_hub_resources',
      description:
        'List the user\'s uploaded resources from RGE Hub (images, clips, files). Admins can pass all=true to list every user\'s resources. Returns id, type, title, file name, size, and link.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['image', 'clip', 'xml'], description: 'Filter by resource type. Omit for all.' },
          query: { type: 'string', description: 'Case-insensitive filter on title/file name.' },
          limit: { type: 'number', description: 'Max rows (default 20, max 40).' },
          all: { type: 'boolean', description: 'Admin only: list ALL users\' resources, not just this user\'s.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_resource',
      description:
        'Download a hub resource by id into the agent workspace (resources/<id>_<filename>). Zip archives are extracted automatically into resources/<name>_extracted/. Use list_hub_resources first to find ids.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'Resource id from list_hub_resources.' },
        },
        required: ['resourceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a text file from the workspace (up to 24KB per call). Returns the file content. Binary files are rejected with their size/type.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace path, e.g. "resources/clip_x/my_edit.xml".' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a workspace text file with full content. Directories are implicit. Returns a diff of the change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace path.' },
          content: { type: 'string', description: 'Full UTF-8 file content.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edit a workspace text file by exact string replacement (first match, or all matches with all=true). Returns a diff. Errors include the closest line when the text is not found.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find_text: { type: 'string', description: 'Exact text to find (must match byte-for-byte).' },
          replace_text: { type: 'string', description: 'Replacement text ("" to delete).' },
          all: { type: 'boolean', description: 'Replace every occurrence instead of the first.' },
        },
        required: ['path', 'find_text', 'replace_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List every file in the workspace as a folder tree with sizes.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file (or a whole folder of files, when path names a folder) from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, or folder path to delete recursively.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unzip_file',
      description: 'Extract a .zip in the workspace into <name>_extracted/ (or a custom dest dir). Entries are capped at 10MB.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the .zip file.' },
          destDir: { type: 'string', description: 'Optional destination folder.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'zip_files',
      description: 'Bundle workspace files into a new .zip in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Workspace paths to include.' },
          dest: { type: 'string', description: 'Destination .zip path, e.g. "exports/bundle.zip".' },
        },
        required: ['paths', 'dest'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_resource',
      description:
        'Edit an existing hub resource\'s title, description and/or file link (owner or admin only). Use fetch_resource or list_hub_resources to find ids.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          link: { type: 'string', description: 'New public file link (downloadUrl).' },
        },
        required: ['resourceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_file',
      description:
        'Publish a workspace file to RGE Hub as a new resource (image/clip/file inferred from extension; png/jpg/webp/gif → image, mp4/webm/mov → clip, xml/text → file). Returns the new resource id and link.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace file to publish.' },
          title: { type: 'string', description: 'Public resource title.' },
          description: { type: 'string', description: 'Optional public description.' },
          type: { type: 'string', enum: ['image', 'clip', 'xml'], description: 'Force the resource type instead of inferring from extension.' },
        },
        required: ['path', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speedramp_clip',
      description:
        'Speed-ramp an existing hub clip: downloads it, processes it through the hub\'s speedramp engine (ffmpeg), and publishes the result as a new clip titled "<original> — ramped". Config: mode (vramp|linear|custom), trimStart, trimDuration, startSpeed, endSpeed, rampMid, rampEnd, speedPoints[{time,speed}], reverse, outputFps, crf, preset, audioMode, outputFormat, outputScale, codec.',
      parameters: {
        type: 'object',
        properties: {
          resourceId: { type: 'string', description: 'Clip resource id (from list_hub_resources).' },
          config: {
            type: 'object',
            description: 'Speedramp configuration (all fields optional — defaults: vramp mode, trim 10s, 4x→0.6x→4x, 30fps).',
          },
        },
        required: ['resourceId'],
      },
    },
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Absolute origin for self-calls (speedramp, on-domain file bytes). */
export function resolveOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\//.test(configured)) return configured;
  return req.nextUrl.origin;
}

/** Resolve the download URL for a resource (absolute). */
function resourceUrl(r: Resource, origin: string): string | null {
  if (r.fileId && !r.fileId.startsWith('ext:') && !/^https?:\/\//.test(r.downloadUrl || '')) {
    return getFileUrl(r.fileId);
  }
  if (r.downloadUrl) {
    if (/^https?:\/\//.test(r.downloadUrl)) return r.downloadUrl;
    return `${origin}${r.downloadUrl.startsWith('/') ? '' : '/'}${r.downloadUrl}`;
  }
  if (r.fileId && !r.fileId.startsWith('ext:')) return getFileUrl(r.fileId);
  return null;
}

function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Locate a hub resource the agent may touch: owner, admin, or published. */
async function locateAccessibleResource(
  resourceId: string,
  ctx: ToolContext
): Promise<Resource | null> {
  const id = String(resourceId || '').trim();
  if (!id) return null;
  const r = await getResourceAny(id, { includeAdmin: ctx.session.isAdmin === true }).catch(() => null);
  if (!r) return null;
  const allowed = r.ownerId === ctx.userId || ctx.session.isAdmin === true || r.published === true;
  // Admin XMLs stay admin-only even when marked published.
  if (r.xmlSource === 'admin' && ctx.session.isAdmin !== true) return null;
  return allowed ? r : null;
}

async function downloadResourceBytes(
  r: Resource,
  ctx: ToolContext,
  maxBytes: number
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const url = resourceUrl(r, resolveOrigin(ctx.req));
  if (!url) return { ok: false, error: `Resource "${r.title}" has no downloadable file.` };
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { redirect: 'follow' }, 45000);
  } catch (err) {
    return { ok: false, error: `Download failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `Download failed (HTTP ${res.status}) for ${url}` };
  const len = Number(res.headers.get('content-length') || '0');
  if (len > maxBytes) {
    return { ok: false, error: `File is ${fmtKB(len)} — over the ${fmtKB(maxBytes)} limit.` };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > maxBytes) {
    return { ok: false, error: `File is ${fmtKB(bytes.length)} — over the ${fmtKB(maxBytes)} limit.` };
  }
  if (bytes.length === 0) return { ok: false, error: 'Downloaded file is empty (0 bytes).' };
  return { ok: true, bytes };
}

/** Publish raw bytes as a new hub resource (mirrors /api/resources/create). */
async function publishResource(
  ctx: ToolContext,
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  type: ResourceType,
  title: string,
  description?: string
): Promise<{ ok: true; resource: Resource } | { ok: false; error: string }> {
  if (bytes.length === 0) return { ok: false, error: 'File is empty (0 bytes) — nothing to publish.' };
  if (bytes.length > 50 * 1024 * 1024) {
    return { ok: false, error: `File is ${fmtKB(bytes.length)} — over the 50 MB publish limit.` };
  }
  const stored = await storeResourceFile(bytes, fileName, mimeType, { kind: type });
  if (!stored.ok || !stored.fileId) {
    return { ok: false, error: `Storage failed: ${stored.error || 'unknown error'}` };
  }
  const { role: authorRole } = await resolveRole({
    userId: ctx.userId,
    email: ctx.session.email,
  }).catch(() => ({ role: 'user' as const }));

  const now = new Date().toISOString();
  const id = generateResourceId(type);
  const resource: Resource = {
    id,
    type,
    ownerId: ctx.userId,
    ownerName: ctx.session.displayName || ctx.session.username,
    title: title.trim().slice(0, 200) || fileName,
    description: typeof description === 'string' ? description.slice(0, 2000) : '',
    fileId: stored.fileId,
    downloadUrl: stored.url || getFileUrl(stored.fileId),
    storageUrl: stored.storageUrl,
    mirrorUrl: stored.mirrorUrl,
    mirrorHost: stored.mirrorHost,
    fileName,
    mimeType,
    size: bytes.length,
    status: 'ready',
    authorRole,
    isOwnerAdmin: authorRole !== 'user',
    tags: [],
    published: true,
    featured: false,
    xmlSource: type === 'xml' ? 'community' : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const created = await createResourceVerified(resource);
  if (!created.ok) {
    return { ok: false, error: 'The file was stored but the resource record could not be saved — retry shortly.' };
  }
  invalidateListings();
  return { ok: true, resource };
}

// ────────────────────────────────────────────────────────────────────────────
// Individual tool implementations
// ────────────────────────────────────────────────────────────────────────────

async function toolListHubResources(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const typeFilter = args.type === 'image' || args.type === 'clip' || args.type === 'xml' ? args.type : null;
  const query = typeof args.query === 'string' ? args.query.toLowerCase().trim() : '';
  const limit = Math.max(1, Math.min(40, typeof args.limit === 'number' ? Math.round(args.limit) : 20));
  const all = args.all === true && ctx.session.isAdmin === true;

  const types: ResourceType[] = typeFilter ? [typeFilter] : ['image', 'clip', 'xml'];
  let rows: Resource[] = [];
  for (const t of types) {
    if (t === 'xml') {
      const community = await listResourcesFast('xml', 'community').catch(() => [] as Resource[]);
      rows = rows.concat(community);
      if (all) {
        const admin = await listResourcesFast('xml', 'admin').catch(() => [] as Resource[]);
        rows = rows.concat(admin);
      }
    } else {
      rows = rows.concat(await listResourcesFast(t).catch(() => [] as Resource[]));
    }
  }
  if (!all) rows = rows.filter((r) => r.ownerId === ctx.userId);
  if (query) {
    rows = rows.filter((r) =>
      (r.title || '').toLowerCase().includes(query) ||
      (r.fileName || '').toLowerCase().includes(query) ||
      (r.description || '').toLowerCase().includes(query)
    );
  }
  rows.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  rows = rows.slice(0, limit);

  if (rows.length === 0) {
    return {
      ok: true,
      result: all
        ? 'No resources found.'
        : 'You have no resources matching this filter yet. The user must upload files through the Hub first (or check the type filter).',
    };
  }
  const lines = rows.map((r) => {
    const ext = resourceExtension(r);
    const size = typeof r.size === 'number' ? fmtKB(r.size) : '?';
    const date = (r.updatedAt || r.createdAt || '').slice(0, 10);
    const link = r.downloadUrl || `(id ${r.id})`;
    return `- ${r.id} [${r.type}${r.type === 'xml' ? `/${ext}` : ''}] "${r.title}" — ${r.fileName || 'no filename'}, ${size}, ${date} — ${link}`;
  });
  return {
    ok: true,
    result: `${rows.length} resource${rows.length === 1 ? '' : 's'}${all ? ' (all users)' : ''}:\n${lines.join('\n')}`,
    meta: { files: rows.map((r) => r.id) },
  };
}

async function toolFetchResource(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const r = await locateAccessibleResource(String(args.resourceId || ''), ctx);
  if (!r) return { ok: false, result: `Resource not found or not accessible: ${String(args.resourceId)}` };

  const dl = await downloadResourceBytes(r, ctx, MAX_TOTAL_BYTES);
  if (!dl.ok) return { ok: false, result: dl.error };

  const fileName = safeFileName(r.fileName || `${r.title || 'resource'}.${resourceExtension(r)}`);
  const path = `resources/${r.id}_${fileName}`;
  const saved = await saveFile(ctx.userId, path, { bytes: dl.bytes, mime: r.mimeType || guessMime(fileName) }, r.id);
  if (!saved.ok) return { ok: false, result: saved.error };

  const files: string[] = [path];
  let extra = '';
  let tree = saved.tree;

  if (extOf(path) === 'zip') {
    const un = await unzipFile(ctx.userId, path);
    if (un.ok) {
      files.push(...un.files.slice(0, 200));
      tree = un.tree;
      extra = `\nExtracted ${un.files.length} entries into ${un.destDir}/:\n${un.files.slice(0, 30).map((f) => `  ${f}`).join('\n')}${un.files.length > 30 ? `\n  … +${un.files.length - 30} more` : ''}`;
    } else {
      extra = `\n(Zip extraction failed: ${un.error})`;
    }
  }

  return {
    ok: true,
    result: `Fetched "${r.title}" (${fmtKB(dl.bytes.length)}) into ${path}.${extra}`,
    meta: { files, tree },
  };
}

async function toolReadFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const res = await readFile(ctx.userId, String(args.path || ''), { maxBytes: 24 * 1024 });
  if (!res) return { ok: false, result: `File not found: ${normalizePath(String(args.path || ''))} — use list_files to see the workspace.` };
  if (!res.meta.isText) {
    return { ok: false, result: `Binary file (${res.meta.mime}, ${fmtKB(res.meta.size)}) — cannot be read as text. It can still be zipped or published.` };
  }
  const content = res.content ?? '';
  return {
    ok: true,
    result: `${res.meta.path} (${content.split('\n').length} lines${res.truncated ? ', truncated at 24KB' : ''}):\n${content}`,
  };
}

async function toolWriteFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const path = normalizePath(String(args.path || ''));
  const content = typeof args.content === 'string' ? args.content : '';
  if (!path) return { ok: false, result: 'Invalid path.' };

  const before = await readFile(ctx.userId, path, { maxBytes: MAX_TOTAL_BYTES });
  const beforeText = before?.meta.isText ? before.content ?? '' : '';

  const saved = await saveFile(ctx.userId, path, { text: content });
  if (!saved.ok) return { ok: false, result: saved.error };

  const lineCount = content.split('\n').length;
  return {
    ok: true,
    result: before ? `Updated ${path} — ${lineCount} lines.` : `Created ${path} — ${lineCount} lines.`,
    meta: { diff: diffLines(beforeText, content, path) },
  };
}

async function toolEditFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const path = normalizePath(String(args.path || ''));
  const findText = typeof args.find_text === 'string' ? args.find_text : '';
  const replaceText = typeof args.replace_text === 'string' ? args.replace_text : '';
  const all = args.all === true;
  if (!path) return { ok: false, result: 'Invalid path.' };
  if (!findText) return { ok: false, result: 'find_text is empty — provide the exact text to replace.' };

  const res = await readFile(ctx.userId, path, { maxBytes: MAX_TOTAL_BYTES });
  if (!res) return { ok: false, result: `File not found: ${path}` };
  if (!res.meta.isText) return { ok: false, result: `${path} is binary — cannot edit text.` };
  const content = res.content ?? '';

  if (!content.includes(findText)) {
    // Closest-line guidance: score lines by the longest needle PREFIX or
    // SUFFIX fragment they contain (catches changed middles/attributes).
    const needle = findText.trim().slice(0, 80);
    const scored = content
      .split('\n')
      .map((line, i) => {
        let overlap = 0;
        const maxLen = Math.min(needle.length, 40);
        for (let len = maxLen; len >= 4; len--) {
          const prefix = needle.slice(0, len);
          const suffix = needle.slice(-len);
          if (line.includes(prefix) || line.includes(suffix)) {
            overlap = len;
            break;
          }
        }
        return { i, line, overlap };
      })
      .filter((s) => s.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 2);
    const hint = scored.length
      ? `\nClosest match${scored.length > 1 ? 'es' : ''}:\n${scored.map((s) => `  line ${s.i + 1}: ${s.line.trim().slice(0, 120)}`).join('\n')}`
      : '\n(No similar text found in the file — check spelling/whitespace with read_file.)';
    return { ok: false, result: `find_text not found in ${path}.${hint}` };
  }

  const next = all ? content.split(findText).join(replaceText) : content.replace(findText, replaceText);
  const saved = await saveFile(ctx.userId, path, { text: next });
  if (!saved.ok) return { ok: false, result: saved.error };
  const count = all ? content.split(findText).length - 1 : 1;
  return {
    ok: true,
    result: `Replaced ${count} occurrence${count === 1 ? '' : 's'} in ${path}.`,
    meta: { diff: diffLines(content, next, path) },
  };
}

async function toolListFiles(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const files = await loadIndex(ctx.userId);
  if (files.length === 0) {
    return { ok: true, result: 'Workspace is empty. Use fetch_resource to pull hub resources in, or write_file to create files.', meta: { tree: [] } };
  }
  const tree = await buildTree(ctx.userId);
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  const listing = files
    .slice(0, 60)
    .map((f) => `- ${f.path} (${fmtKB(f.size)}${f.isText ? '' : `, ${f.mime}`})`)
    .join('\n');
  return {
    ok: true,
    result: `${files.length} file${files.length === 1 ? '' : 's'}, ${fmtKB(total)} total:\n${listing}${files.length > 60 ? `\n… +${files.length - 60} more (use read_file)` : ''}`,
    meta: { tree },
  };
}

async function toolDeleteFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const target = normalizePath(String(args.path || ''));
  if (!target) return { ok: false, result: 'Invalid path.' };
  const files = await loadIndex(ctx.userId);
  const exact = files.find((f) => f.path === target);
  const under = files.filter((f) => f.path.startsWith(`${target}/`));
  const victims = exact ? [exact.path] : under.map((f) => f.path);
  if (victims.length === 0) return { ok: false, result: `Nothing to delete at: ${target}` };

  let deleted = 0;
  let lastTree: ToolResultMeta['tree'];
  for (const p of victims) {
    const res = await wsDeleteFile(ctx.userId, p);
    if (res.ok) {
      deleted++;
      if (res.tree) lastTree = res.tree;
    }
  }
  if (deleted === 0) return { ok: false, result: 'Delete failed — workspace storage unavailable, retry shortly.' };
  return {
    ok: true,
    result: `Deleted ${deleted} file${deleted === 1 ? '' : 's'} under ${target}.`,
    meta: { tree: lastTree, files: victims.slice(0, 50) },
  };
}

async function toolUnzipFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const res = await unzipFile(ctx.userId, String(args.path || ''), typeof args.destDir === 'string' ? args.destDir : undefined);
  if (!res.ok) return { ok: false, result: res.error };
  return {
    ok: true,
    result: `Extracted ${res.files.length} files to ${res.destDir}/:\n${res.files.slice(0, 30).map((f) => `  ${f}`).join('\n')}${res.files.length > 30 ? `\n  … +${res.files.length - 30} more` : ''}`,
    meta: { tree: res.tree, files: res.files.slice(0, 200) },
  };
}

async function toolZipFiles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const paths = Array.isArray(args.paths) ? args.paths.map((p) => String(p)) : [];
  const dest = String(args.dest || '');
  const res = await zipFiles(ctx.userId, paths, dest);
  if (!res.ok) return { ok: false, result: res.error };
  return {
    ok: true,
    result: `Created ${res.path} (${fmtKB(res.size)}) from ${paths.length} file${paths.length === 1 ? '' : 's'}.`,
    meta: { tree: res.tree, files: [res.path] },
  };
}

async function toolUpdateResource(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const id = String(args.resourceId || '').trim();
  const r = await getResourceAny(id, { includeAdmin: ctx.session.isAdmin === true }).catch(() => null);
  if (!r) return { ok: false, result: `Resource not found: ${id}` };
  const isOwner = r.ownerId === ctx.userId;
  if (!isOwner && ctx.session.isAdmin !== true) {
    return { ok: false, result: `Not authorized: you can only edit your own resources (owner-or-admin).` };
  }

  const changed: string[] = [];
  if (typeof args.title === 'string' && args.title.trim()) {
    r.title = args.title.trim().slice(0, 200);
    changed.push('title');
  }
  if (typeof args.description === 'string') {
    r.description = args.description.slice(0, 2000);
    changed.push('description');
  }
  if (typeof args.link === 'string' && /^https?:\/\//.test(args.link.trim())) {
    r.downloadUrl = args.link.trim();
    changed.push('link');
  }
  if (changed.length === 0) {
    return { ok: false, result: 'Nothing to update — provide at least one of title, description, link (link must be a http(s) URL).' };
  }

  const ok = await updateResource(r);
  if (!ok) return { ok: false, result: 'Update could not be saved — storage unavailable, retry shortly.' };
  invalidateListings();
  return { ok: true, result: `Updated ${changed.join(', ')} on "${r.title}" (${r.id}).` };
}

function inferResourceType(path: string): ResourceType {
  const ext = extOf(path);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'clip';
  return 'xml';
}

async function toolPublishFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const path = normalizePath(String(args.path || ''));
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const description = typeof args.description === 'string' ? args.description : undefined;
  const forcedType =
    args.type === 'image' || args.type === 'clip' || args.type === 'xml' ? (args.type as ResourceType) : null;
  if (!title) return { ok: false, result: 'A title is required to publish.' };

  const res = await readFile(ctx.userId, path, { maxBytes: 50 * 1024 * 1024 });
  if (!res) return { ok: false, result: `File not found: ${path || '(empty path)'}` };
  if (res.blobUrl && !res.content && !res.dataB64) {
    return { ok: false, result: `${path} is ${fmtKB(res.meta.size)} — over the 50MB publish limit.` };
  }
  const bytes = res.content !== undefined
    ? Buffer.from(res.content, 'utf-8')
    : res.dataB64 !== undefined
      ? Buffer.from(res.dataB64, 'base64')
      : Buffer.from([]);
  if (bytes.length === 0) return { ok: false, result: `${path} is empty (0 bytes) — nothing to publish.` };

  const type = forcedType || inferResourceType(path);
  const fileName = res.meta.name || path.split('/').pop() || 'file';
  const mimeType = res.meta.mime && res.meta.mime !== 'application/octet-stream' ? res.meta.mime : guessMime(path);

  const pub = await publishResource(ctx, bytes, fileName, mimeType, type, title, description);
  if (!pub.ok) return { ok: false, result: pub.error };
  return {
    ok: true,
    result: `Published "${pub.resource.title}" as a ${type} resource — id ${pub.resource.id}, link: ${pub.resource.downloadUrl}`,
    meta: { files: [pub.resource.id] },
  };
}

async function toolSpeedrampClip(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecResult> {
  const r = await locateAccessibleResource(String(args.resourceId || ''), ctx);
  if (!r) return { ok: false, result: `Clip resource not found or not accessible: ${String(args.resourceId)}` };
  if (r.type !== 'clip' && !['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'].includes(resourceExtension(r))) {
    return { ok: false, result: `"${r.title}" is not a video clip (${r.type}/${resourceExtension(r)}).` };
  }

  const dl = await downloadResourceBytes(r, ctx, 50 * 1024 * 1024);
  if (!dl.ok) return { ok: false, result: dl.error };

  // Build the speedramp request (same contract as the studio UI):
  // multipart "file" + "config" JSON string, session cookie forwarded.
  const config = args.config && typeof args.config === 'object' ? args.config : {};
  const origin = resolveOrigin(ctx.req);
  const fileName = safeFileName(r.fileName || `${r.title || 'clip'}.mp4`);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(dl.bytes)], { type: r.mimeType || 'video/mp4' }), fileName);
  form.append('config', JSON.stringify(config));

  const cookie = ctx.req.headers.get('cookie') || '';
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${origin}/api/speedramp`,
      { method: 'POST', body: form, headers: cookie ? { cookie } : {} },
      110_000
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      result: /abort/i.test(msg)
        ? 'Speedramp timed out (110s) — the clip may be too long/heavy. Try a shorter trimDuration or the ultrafast preset.'
        : `Speedramp request failed: ${msg}`,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let errMsg = body.slice(0, 300);
    try {
      errMsg = JSON.parse(body)?.error || errMsg;
    } catch { /* raw text */ }
    return { ok: false, result: `Speedramp failed (HTTP ${res.status}): ${errMsg || 'processing error'}` };
  }

  const outMime = res.headers.get('content-type') || 'video/mp4';
  const disposition = res.headers.get('content-disposition') || '';
  const nameMatch = /filename="([^"]+)"/.exec(disposition);
  const outName = nameMatch ? nameMatch[1] : `speedramp_${fileName.replace(/\.[^.]+$/, '')}.mp4`;
  const outBytes = Buffer.from(await res.arrayBuffer());
  if (outBytes.length === 0) return { ok: false, result: 'Speedramp returned an empty file.' };

  const pub = await publishResource(
    ctx,
    outBytes,
    outName,
    outMime.startsWith('video/') ? outMime : 'video/mp4',
    'clip',
    `${r.title} — ramped`,
    `Speedramped from "${r.title}" (id ${r.id}).`
  );
  if (!pub.ok) {
    return { ok: false, result: `Processing succeeded, but publishing failed: ${pub.error} (the processed clip could not be saved).` };
  }
  return {
    ok: true,
    result: `Speedramp complete: published "${pub.resource.title}" (${fmtKB(outBytes.length)}) — id ${pub.resource.id}, link: ${pub.resource.downloadUrl}`,
    meta: { files: [pub.resource.id] },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────────

type ToolImpl = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecResult>;

const TOOL_IMPLS: Record<string, ToolImpl> = {
  set_plan: async (args) => {
    const steps = (Array.isArray(args.steps) ? args.steps : [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 20);
    if (steps.length === 0) return { ok: false, result: 'No steps given.' };
    return {
      ok: true,
      result: `Plan set: ${steps.length} step${steps.length === 1 ? '' : 's'}`,
      meta: { status: 'plan' },
    };
  },
  write_todos: async (args) => {
    const items = (Array.isArray(args.items) ? args.items : [])
      .map((it) => {
        const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
        return {
          text: String(o.text || '').trim(),
          status: o.status === 'in_progress' || o.status === 'done' ? o.status : 'pending',
        };
      })
      .filter((it) => it.text)
      .slice(0, 30);
    return {
      ok: true,
      result: `TODOs updated: ${items.length} item${items.length === 1 ? '' : 's'} (${items.filter((i) => i.status === 'done').length} done).`,
      meta: { status: 'todos' },
    };
  },
  list_hub_resources: toolListHubResources,
  fetch_resource: toolFetchResource,
  read_file: toolReadFile,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  list_files: toolListFiles,
  delete_file: toolDeleteFile,
  unzip_file: toolUnzipFile,
  zip_files: toolZipFiles,
  update_resource: toolUpdateResource,
  publish_file: toolPublishFile,
  speedramp_clip: toolSpeedrampClip,
};

/**
 * Execute a tool by name. NEVER throws — any failure surfaces as
 * {ok:false, result:<honest error>} for the model (and the user) to see.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolExecResult> {
  const impl = TOOL_IMPLS[name];
  if (!impl) {
    return { ok: false, result: `Unknown tool: ${name}. Available: ${[...TOOL_NAMES.keys()].join(', ')}` };
  }
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  try {
    return await impl(safeArgs, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, result: `Tool error (${name}): ${msg}` };
  }
}

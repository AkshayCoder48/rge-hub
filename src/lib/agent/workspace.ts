/**
 * RGE Agent — per-user persistent virtual workspace (filesystem in the engine).
 *
 * Layout (collection 'agentWorkspace', master-authed KV):
 *   `wsidx:${userId}`                      → WorkspaceFileMeta[] (the index)
 *   `wsf:${userId}:${sha1(path)[0..16]}`   → { path, mime, isText, content | dataB64 }
 *
 * Files ≤ INLINE_MAX_BYTES (180KB raw) are inlined in KV. Larger files are
 * uploaded through the V5 blob pipeline (v5UploadBlob) and only their
 * blobUrl lives in the index — content is fetched on demand.
 *
 * Caps: 500 files / 20MB total per user (honest errors beyond).
 */

import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { kvGet, kvSet, kvDelete, v5UploadBlob, getFileUrl, deleteFile as deleteBlobFile } from '../onyxbase';
import type { TreeNode, WorkspaceFileMeta, FileDiff, DiffLine } from './types';

const WS_COLLECTION = 'agentWorkspace';

/** Inline KV storage ceiling (raw bytes). Larger → V5 blob. */
export const INLINE_MAX_BYTES = 180 * 1024;
/** Per-user caps. */
export const MAX_FILES = 500;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** Per-entry ceiling when extracting zips. */
export const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024;

const TEXT_EXTS = new Set([
  'xml', 'txt', 'json', 'csv', 'md', 'srt', 'vtt', 'edl', 'html', 'js', 'ts', 'css',
]);

const MIME_BY_EXT: Record<string, string> = {
  xml: 'text/xml', txt: 'text/plain', json: 'application/json', csv: 'text/csv',
  md: 'text/markdown', srt: 'text/plain', vtt: 'text/vtt', edl: 'text/plain',
  html: 'text/html', htm: 'text/html', js: 'text/javascript', ts: 'text/typescript',
  css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  zip: 'application/zip', pdf: 'application/pdf',
};

export function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

export function guessMime(path: string): string {
  return MIME_BY_EXT[extOf(path)] || 'application/octet-stream';
}

export function isTextLike(path: string, mime?: string): boolean {
  if (TEXT_EXTS.has(extOf(path))) return true;
  const m = (mime || '').toLowerCase();
  if (m.startsWith('text/')) return true;
  if (m === 'application/json' || m === 'application/xml' || m.endsWith('+json') || m.endsWith('+xml')) return true;
  return false;
}

/** Sanitize a workspace path: no `..`, no leading `/`, no control chars. */
export function normalizePath(p: string): string {
  const raw = String(p || '').trim().replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120));
  }
  return parts.join('/').slice(0, 400);
}

/** Filesystem-safe file name (used when materializing hub resources). */
export function safeFileName(name: string): string {
  const base = String(name || 'file').split('/').pop() || 'file';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/_+\./g, '.')
    .replace(/^_+|_+$/g, '');
  return (cleaned || 'file').slice(0, 120);
}

// ────────────────────────────────────────────────────────────────────────────
// Index plumbing
// ────────────────────────────────────────────────────────────────────────────

function indexKey(userId: string): string {
  return `wsidx:${userId}`;
}

function contentKey(userId: string, path: string): string {
  const hash = crypto.createHash('sha1').update(path).digest('hex').slice(0, 16);
  return `wsf:${userId}:${hash}`;
}

interface StoredContent {
  path: string;
  mime: string;
  isText: boolean;
  /** UTF-8 text (isText) */
  content?: string;
  /** base64 bytes (!isText) */
  dataB64?: string;
}

export async function loadIndex(userId: string): Promise<WorkspaceFileMeta[]> {
  const idx = await kvGet<WorkspaceFileMeta[]>(indexKey(userId), WS_COLLECTION).catch(() => null);
  if (!Array.isArray(idx)) return [];
  return idx.filter((m) => m && typeof m.path === 'string');
}

async function persistIndex(userId: string, files: WorkspaceFileMeta[]): Promise<boolean> {
  return kvSet(indexKey(userId), files, WS_COLLECTION);
}

/**
 * Delete EVERYTHING in a user's workspace (account deletion): all content
 * keys, all V5 blobs, the index. Bounded concurrency; never throws.
 * Returns the number of files purged.
 */
export async function purgeWorkspace(userId: string): Promise<number> {
  try {
    const files = await loadIndex(userId);
    let purged = 0;
    // Content keys + blobs, 8 at a time.
    for (let i = 0; i < files.length; i += 8) {
      const chunk = files.slice(i, i + 8);
      await Promise.all(
        chunk.map(async (f) => {
          await kvDelete(contentKey(userId, f.path), WS_COLLECTION).catch(() => {});
          const blobId = f.blobUrl?.split('/f/')[1];
          if (blobId) await deleteBlobFile(blobId).catch(() => {});
          purged++;
        })
      );
    }
    await kvDelete(indexKey(userId), WS_COLLECTION).catch(() => {});
    return purged;
  } catch {
    return 0;
  }
}

export function totalSizeBytesOf(files: WorkspaceFileMeta[]): number {
  return files.reduce((sum, f) => sum + (typeof f.size === 'number' ? f.size : 0), 0);
}

export async function totalSizeBytes(userId: string): Promise<number> {
  return totalSizeBytesOf(await loadIndex(userId));
}

// ────────────────────────────────────────────────────────────────────────────
// Tree building
// ────────────────────────────────────────────────────────────────────────────

/** Build a folder/file tree (sorted: folders first, then alphabetical) from an index. */
export function buildTreeFromIndex(files: WorkspaceFileMeta[]): TreeNode[] {
  const folderPaths = new Set<string>();
  for (const f of files) {
    const segs = f.path.split('/');
    segs.pop();
    for (let i = 1; i <= segs.length; i++) folderPaths.add(segs.slice(0, i).join('/'));
  }
  const nodes: TreeNode[] = [];
  for (const p of folderPaths) {
    const segs = p.split('/');
    nodes.push({ path: p, name: segs[segs.length - 1], depth: segs.length - 1, kind: 'folder' });
  }
  for (const f of files) {
    const segs = f.path.split('/');
    nodes.push({ path: f.path, name: segs[segs.length - 1], depth: segs.length - 1, kind: 'file' });
  }
  nodes.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const af = a.kind === 'folder' ? 0 : 1;
    const bf = b.kind === 'folder' ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export async function buildTree(userId: string): Promise<TreeNode[]> {
  return buildTreeFromIndex(await loadIndex(userId));
}

// ────────────────────────────────────────────────────────────────────────────
// Write / read / delete
// ────────────────────────────────────────────────────────────────────────────

export interface SaveFileInput {
  /** UTF-8 text content (isText = true). */
  text?: string;
  /** Raw bytes (isText decided by mime/extension). */
  bytes?: Buffer;
  mime?: string;
}

export type SaveFileResult =
  | { ok: true; meta: WorkspaceFileMeta; tree: TreeNode[] }
  | { ok: false; error: string };

/**
 * Create/overwrite a workspace file. Enforces the per-user caps and picks
 * inline-KV vs blob storage by size.
 */
export async function saveFile(
  userId: string,
  path: string,
  data: SaveFileInput,
  fromResourceId?: string
): Promise<SaveFileResult> {
  const p = normalizePath(path);
  if (!p) return { ok: false, error: 'Invalid path' };

  const files = await loadIndex(userId);
  const existing = files.find((f) => f.path === p);
  const isText = data.text !== undefined ? true : isTextLike(p, data.mime);
  const mime = data.mime || (isText ? 'text/plain; charset=utf-8' : guessMime(p));
  const bytes: Buffer =
    data.text !== undefined
      ? Buffer.from(String(data.text), 'utf-8')
      : Buffer.isBuffer(data.bytes)
        ? data.bytes
        : Buffer.from([]);

  if (bytes.length > MAX_TOTAL_BYTES) {
    return { ok: false, error: `File is ${(bytes.length / 1024 / 1024).toFixed(1)} MB — the workspace limit is 20 MB per user.` };
  }
  if (!existing && files.length >= MAX_FILES) {
    return { ok: false, error: `Workspace file limit reached (${MAX_FILES} files). Delete some files first.` };
  }
  const projectedTotal = totalSizeBytesOf(files) - (existing?.size || 0) + bytes.length;
  if (projectedTotal > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Workspace is full (${(projectedTotal / 1024 / 1024).toFixed(1)} MB of 20 MB). Delete some files first.`,
    };
  }

  // Content storage: inline (≤180KB) or V5 blob.
  let blobUrl: string | undefined;
  if (bytes.length > INLINE_MAX_BYTES) {
    try {
      const up = await v5UploadBlob(
        new Blob([new Uint8Array(bytes)], { type: mime }),
        p.split('/').pop() || 'file',
        mime
      );
      if (!up.ok) {
        return { ok: false, error: `Large-file storage failed: ${up.error}` };
      }
      blobUrl = up.file.url || getFileUrl(up.file.fileId);
    } catch (err) {
      return { ok: false, error: `Large-file storage failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else {
    const stored: StoredContent = isText
      ? { path: p, mime, isText: true, content: bytes.toString('utf-8') }
      : { path: p, mime, isText: false, dataB64: bytes.toString('base64') };
    const saved = await kvSet(contentKey(userId, p), stored, WS_COLLECTION);
    if (!saved) return { ok: false, error: 'Workspace storage is unavailable — please retry in a moment.' };
  }
  // When a previously inline file became blob-backed, drop the stale inline
  // copy (best-effort; the blob is now authoritative).
  if (existing && !existing.blobUrl && blobUrl) {
    await kvDelete(contentKey(userId, p), WS_COLLECTION).catch(() => {});
  }

  const meta: WorkspaceFileMeta = {
    path: p,
    name: p.split('/').pop() || p,
    size: bytes.length,
    mime,
    isText,
    fromResourceId: fromResourceId || existing?.fromResourceId,
    blobUrl,
    updatedAt: new Date().toISOString(),
  };
  const nextFiles = existing ? files.map((f) => (f.path === p ? meta : f)) : [...files, meta];
  const ok = await persistIndex(userId, nextFiles);
  if (!ok) return { ok: false, error: 'Workspace index could not be saved — please retry.' };
  return { ok: true, meta, tree: buildTreeFromIndex(nextFiles) };
}

export interface ReadFileResult {
  meta: WorkspaceFileMeta;
  content?: string;
  dataB64?: string;
  blobUrl?: string;
  truncated: boolean;
}

async function fetchBlobBytes(blobUrl: string, timeoutMs = 25000): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(blobUrl, { signal: controller.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a workspace file. Text files → `content`; binary → `dataB64`;
 * when the file is blob-backed and larger than maxBytes → `blobUrl` only.
 * Never throws; null when the path does not exist.
 */
export async function readFile(
  userId: string,
  path: string,
  opts: { maxBytes?: number } = {}
): Promise<ReadFileResult | null> {
  const p = normalizePath(path);
  const maxBytes = opts.maxBytes ?? INLINE_MAX_BYTES;
  const files = await loadIndex(userId);
  const meta = files.find((f) => f.path === p);
  if (!meta) return null;

  if (meta.blobUrl) {
    if (meta.size > maxBytes) {
      return { meta, blobUrl: meta.blobUrl, truncated: true };
    }
    const bytes = await fetchBlobBytes(meta.blobUrl);
    if (!bytes) return { meta, blobUrl: meta.blobUrl, truncated: true };
    const truncated = bytes.length > maxBytes;
    const slice = truncated ? bytes.subarray(0, maxBytes) : bytes;
    return meta.isText
      ? { meta, content: slice.toString('utf-8'), truncated }
      : { meta, dataB64: slice.toString('base64'), truncated };
  }

  const stored = await kvGet<StoredContent>(contentKey(userId, p), WS_COLLECTION).catch(() => null);
  if (!stored) return { meta, blobUrl: undefined, truncated: true };

  if (stored.isText && typeof stored.content === 'string') {
    const buf = Buffer.from(stored.content, 'utf-8');
    const truncated = buf.length > maxBytes;
    return { meta, content: truncated ? buf.subarray(0, maxBytes).toString('utf-8') : stored.content, truncated };
  }
  if (typeof stored.dataB64 === 'string') {
    const buf = Buffer.from(stored.dataB64, 'base64');
    const truncated = buf.length > maxBytes;
    return { meta, dataB64: truncated ? buf.subarray(0, maxBytes).toString('base64') : stored.dataB64, truncated };
  }
  return { meta, truncated: true };
}

/** Read the full raw bytes of a workspace file (for zips / publishing). */
async function readAllBytes(userId: string, path: string): Promise<Buffer | null> {
  const res = await readFile(userId, path, { maxBytes: MAX_TOTAL_BYTES });
  if (!res) return null;
  if (res.content !== undefined) return Buffer.from(res.content, 'utf-8');
  if (res.dataB64 !== undefined) return Buffer.from(res.dataB64, 'base64');
  if (res.blobUrl) return fetchBlobBytes(res.blobUrl, 60000);
  return null;
}

export async function deleteFile(
  userId: string,
  path: string
): Promise<{ ok: boolean; error?: string; tree?: TreeNode[]; deleted?: string }> {
  const p = normalizePath(path);
  const files = await loadIndex(userId);
  const existing = files.find((f) => f.path === p);
  if (!existing) return { ok: false, error: `File not found: ${p}` };
  const next = files.filter((f) => f.path !== p);
  const indexOk = await persistIndex(userId, next);
  if (!indexOk) return { ok: false, error: 'Workspace index could not be updated — please retry.' };
  await kvDelete(contentKey(userId, p), WS_COLLECTION).catch(() => {});
  // Best-effort blob cleanup (blobUrl shape: …/f/{blobId}).
  if (existing.blobUrl) {
    const blobId = existing.blobUrl.split('/f/')[1];
    if (blobId) void deleteBlobFile(blobId).catch(() => {});
  }
  return { ok: true, deleted: p, tree: buildTreeFromIndex(next) };
}

// ────────────────────────────────────────────────────────────────────────────
// Zip operations (adm-zip reads AND writes)
// ────────────────────────────────────────────────────────────────────────────

export type UnzipResult =
  | { ok: true; files: string[]; tree: TreeNode[]; destDir: string }
  | { ok: false; error: string };

/**
 * Extract a workspace zip. Skips __MACOSX debris and .DS_Store; each entry
 * is capped at 10MB; goes through saveFile so the per-user caps apply.
 */
export async function unzipFile(userId: string, path: string, destDir?: string): Promise<UnzipResult> {
  const p = normalizePath(path);
  const bytes = await readAllBytes(userId, p);
  if (!bytes) return { ok: false, error: `Zip not found (or unreadable): ${p}` };
  let zip: AdmZip;
  try {
    zip = new AdmZip(bytes);
  } catch (err) {
    return { ok: false, error: `Not a valid zip file: ${err instanceof Error ? err.message : String(err)}` };
  }
  const dest = normalizePath(destDir || p.replace(/\.zip$/i, '') + '_extracted') || 'extracted';

  const created: string[] = [];
  const failures: string[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (entryName.includes('__MACOSX') || entryName.endsWith('.DS_Store')) continue;
    const data = entry.getData();
    if (data.length > MAX_ZIP_ENTRY_BYTES) {
      failures.push(`${entryName} (too large: ${(data.length / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }
    const target = normalizePath(`${dest}/${entryName}`);
    if (!target) continue;
    const mime = guessMime(target);
    const isText = isTextLike(target, mime);
    const saved = await saveFile(userId, target, { bytes: data, mime: isText ? 'text/plain; charset=utf-8' : mime });
    if (saved.ok) created.push(target);
    else failures.push(`${entryName} (${saved.error})`);
    if (created.length >= 200) break; // extraction cap
  }

  const tree = buildTreeFromIndex(await loadIndex(userId));
  if (created.length === 0) {
    return { ok: false, error: `No files extracted. ${failures.slice(0, 3).join('; ') || 'The zip appears empty.'}` };
  }
  return { ok: true, files: created, tree, destDir: dest };
}

export type ZipResult =
  | { ok: true; path: string; size: number; tree: TreeNode[] }
  | { ok: false; error: string };

/** Create a zip in the workspace from existing workspace paths. */
export async function zipFiles(userId: string, paths: string[], dest: string): Promise<ZipResult> {
  const destPath = normalizePath(dest);
  if (!destPath) return { ok: false, error: 'Invalid destination path' };
  if (!destPath.toLowerCase().endsWith('.zip')) {
    return { ok: false, error: 'Destination must end with .zip' };
  }
  const list = (Array.isArray(paths) ? paths : []).map((p) => normalizePath(String(p))).filter(Boolean);
  if (list.length === 0) return { ok: false, error: 'No source files given' };

  const zip = new AdmZip();
  let added = 0;
  for (const p of list.slice(0, 200)) {
    const bytes = await readAllBytes(userId, p);
    if (!bytes) return { ok: false, error: `File not found: ${p}` };
    zip.addFile(p, bytes);
    added++;
  }
  const out = zip.toBuffer();
  const saved = await saveFile(userId, destPath, { bytes: out, mime: 'application/zip' });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, path: destPath, size: out.length, tree: saved.tree };
}

// ────────────────────────────────────────────────────────────────────────────
// Line diff (LCS) — powers the write_file / edit_file diff element
// ────────────────────────────────────────────────────────────────────────────

const DIFF_MAX_LINES = 400;

/**
 * Simple LCS line diff. Output capped at 400 lines (first 200 + marker +
 * last 199) so a whole-file rewrite never blows up the UI payload.
 */
export function diffLines(before: string, after: string, filename: string): FileDiff {
  // An empty string is NO lines (not one empty line) so brand-new files diff
  // as purely added and deletions to empty as purely removed.
  const a = before === '' || before == null ? [] : String(before).split('\n');
  const b = after === '' || after == null ? [] : String(after).split('\n');

  // Trim the common prefix/suffix first (cheap and usually covers most of
  // an edit).
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);

  const head = a.slice(0, Math.min(start, 3)).map((text) => ({ kind: 'context' as const, text }));
  const tailA = a.slice(Math.max(endA + 1, a.length - 3), a.length).map((text) => ({
    kind: 'context' as const,
    text,
  }));

  let mid: DiffLine[] = [];
  if (midA.length + midB.length > 2400) {
    // Too big for the DP table — honest whole-block replacement.
    mid = [
      ...midA.map((text) => ({ kind: 'removed' as const, text })),
      ...midB.map((text) => ({ kind: 'added' as const, text })),
    ];
  } else if (midA.length || midB.length) {
    // LCS DP over the middle.
    const n = midA.length;
    const m = midB.length;
    const dp = new Int32Array((n + 1) * (m + 1));
    const W = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = midA[i] === midB[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        mid.push({ kind: 'context', text: midA[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
        mid.push({ kind: 'removed', text: midA[i] });
        i++;
      } else {
        mid.push({ kind: 'added', text: midB[j] });
        j++;
      }
    }
    while (i < n) mid.push({ kind: 'removed', text: midA[i++] });
    while (j < m) mid.push({ kind: 'added', text: midB[j++] });
  }

  let lines: DiffLine[] = [...head, ...mid, ...tailA];
  if (lines.length > DIFF_MAX_LINES) {
    const keep = 200;
    const omitted = lines.length - DIFF_MAX_LINES + 1;
    const marker: DiffLine = { kind: 'context', text: `… ${omitted} more lines truncated …` };
    lines = [...lines.slice(0, keep), marker, ...lines.slice(lines.length - (DIFF_MAX_LINES - keep - 1))];
  }

  return {
    filename,
    additions: lines.filter((l) => l.kind === 'added').length,
    deletions: lines.filter((l) => l.kind === 'removed').length,
    lines,
  };
}

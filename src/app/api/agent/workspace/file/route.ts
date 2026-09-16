/**
 * /api/agent/workspace/file
 *
 * GET    ?path= — file content for preview (512KB cap; text → content,
 *                 binary → dataB64, oversized blob-backed → blobUrl).
 * DELETE ?path= — delete a file (or a folder, recursively).
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import {
  readFile,
  loadIndex,
  deleteFile,
  buildTreeFromIndex,
  normalizePath,
} from '@/lib/agent/workspace';

export const dynamic = 'force-dynamic';

const PREVIEW_MAX_BYTES = 512 * 1024;

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const path = normalizePath(new URL(request.url).searchParams.get('path') || '');
    if (!path) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Missing ?path=', meta, { status: 400 });
    }
    const res = await readFile(sessionResult.session.userId, path, { maxBytes: PREVIEW_MAX_BYTES });
    if (!res) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.NOT_FOUND, `File not found: ${path}`, meta, { status: 404 });
    }
    const data = {
      path: res.meta.path,
      name: res.meta.name,
      mime: res.meta.mime,
      isText: res.meta.isText,
      size: res.meta.size,
      updatedAt: res.meta.updatedAt,
      fromResourceId: res.meta.fromResourceId,
      content: res.content,
      dataB64: res.dataB64,
      blobUrl: res.blobUrl,
      truncated: res.truncated,
    };
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/workspace/file', 'GET', 200, 'agent.workspace.file');
    return ok(data, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/workspace/file] get error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to read file.', meta, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const userId = sessionResult.session.userId;
    const target = normalizePath(new URL(request.url).searchParams.get('path') || '');
    if (!target) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'Missing ?path=', meta, { status: 400 });
    }

    // Exact file, or every file under a folder path.
    const files = await loadIndex(userId);
    const victims = files
      .filter((f) => f.path === target || f.path.startsWith(`${target}/`))
      .map((f) => f.path);
    if (victims.length === 0) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.NOT_FOUND, `Nothing to delete at: ${target}`, meta, { status: 404 });
    }
    let deleted = 0;
    for (const p of victims) {
      const res = await deleteFile(userId, p);
      if (res.ok) deleted++;
    }
    const tree = buildTreeFromIndex(await loadIndex(userId));
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/workspace/file', 'DELETE', 200, 'agent.workspace.file.delete', { deleted });
    return ok({ deleted, tree }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/workspace/file] delete error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to delete file.', meta, { status: 500 });
  }
}

/**
 * GET /api/agent/workspace — the user's agent workspace (index + tree + totals).
 *
 * Returns { files: WorkspaceFileMeta[], tree: TreeNode[], fileCount,
 * totalSizeBytes, caps: { maxFiles, maxTotalBytes } }.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { loadIndex, buildTreeFromIndex, totalSizeBytesOf, MAX_FILES, MAX_TOTAL_BYTES } from '@/lib/agent/workspace';

export const dynamic = 'force-dynamic';

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
    const files = await loadIndex(sessionResult.session.userId);
    const tree = buildTreeFromIndex(files);
    const data = {
      files,
      tree,
      fileCount: files.length,
      totalSizeBytes: totalSizeBytesOf(files),
      caps: { maxFiles: MAX_FILES, maxTotalBytes: MAX_TOTAL_BYTES },
    };
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/workspace', 'GET', 200, 'agent.workspace.index');
    return ok(data, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/workspace] error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to load workspace.', meta, { status: 500 });
  }
}

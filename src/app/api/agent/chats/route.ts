/**
 * /api/agent/chats
 *
 * GET  — list the signed-in user's agent chats (metadata only, newest first).
 * POST — create a new agent chat ({title?}).
 *
 * Standard response contract {success, data, requestId, durationMs}.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { listChats, createChat } from '@/lib/agent/sessions';

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
    const chats = await listChats(sessionResult.session.userId);
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/chats', 'GET', 200, 'agent.chats.list');
    return ok({ chats }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/chats] list error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to list chats.', meta, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : undefined;
    const chat = await createChat(sessionResult.session.userId, title);
    meta.durationMs = Date.now() - t0;
    logRequest(meta, '/api/agent/chats', 'POST', 200, 'agent.chats.create');
    return ok({ chat }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/chats] create error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to create chat.', meta, { status: 500 });
  }
}

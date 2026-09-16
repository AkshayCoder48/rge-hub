/**
 * /api/agent/chats/[id]
 *
 * GET    — full chat incl. messages.
 * PATCH  — rename ({title}).
 * DELETE — delete the chat.
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { ok, fail, ERROR_CODES, newRequestId, logRequest } from '@/lib/api-contract';
import { getChat, renameChat, deleteChat } from '@/lib/agent/sessions';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const { id } = await params;
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const chat = await getChat(sessionResult.session.userId, id);
    if (!chat) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.NOT_FOUND, 'Chat not found.', meta, { status: 404 });
    }
    meta.durationMs = Date.now() - t0;
    logRequest(meta, `/api/agent/chats/${id}`, 'GET', 200, 'agent.chats.get');
    return ok({ chat }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/chats/id] get error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to load chat.', meta, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const { id } = await params;
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.VALIDATION_ERROR, 'A non-empty title is required.', meta, { status: 400 });
    }
    const chat = await renameChat(sessionResult.session.userId, id, body.title);
    if (!chat) {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.NOT_FOUND, 'Chat not found.', meta, { status: 404 });
    }
    meta.durationMs = Date.now() - t0;
    logRequest(meta, `/api/agent/chats/${id}`, 'PATCH', 200, 'agent.chats.rename');
    return ok({ chat }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/chats/id] patch error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to rename chat.', meta, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  const t0 = Date.now();
  const meta = { requestId, durationMs: 0 };
  try {
    const { id } = await params;
    const sessionResult = await getSession();
    if (sessionResult.status !== 'ok') {
      meta.durationMs = Date.now() - t0;
      return fail(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.', meta, { status: 401 });
    }
    const deleted = await deleteChat(sessionResult.session.userId, id);
    meta.durationMs = Date.now() - t0;
    logRequest(meta, `/api/agent/chats/${id}`, 'DELETE', 200, 'agent.chats.delete', { deleted });
    return ok({ deleted: true, id }, meta);
  } catch (err) {
    meta.durationMs = Date.now() - t0;
    console.error('[agent/chats/id] delete error:', err instanceof Error ? err.message : err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Failed to delete chat.', meta, { status: 500 });
  }
}
